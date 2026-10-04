from __future__ import annotations

import hashlib
import math
import threading
from pathlib import Path
from typing import Any

import nibabel as nib
import numpy as np
import torch
from monai.inferers import SlidingWindowInferer
from nibabel.processing import resample_from_to, resample_to_output
from skimage.measure import marching_cubes
from torch import nn

from app.core.config import MODEL_CACHE_DIR

MODEL_NAME = "ORTHO_AI experimental 3D fracture segmentation CNN"
MODEL_VERSION = "0.2.0"
SUPPORTED_REGIONS = ("rib", "shoulder")
TARGET_SPACING_MM = 2.0
ROI_SIZE = (64, 64, 64)
FRACTURE_COLOR = "#ff334f"
MAX_RIBFRACTURE_VOXELS = 20_000_000
CHECKPOINT_PATH = MODEL_CACHE_DIR / "fracture_segmentation" / "model.pt"
MAX_SURFACE_DIMENSION = 160

_model: RibFractureUNet | None = None
_model_regions: tuple[str, ...] = ()
_model_lock = threading.Lock()
_inference_lock = threading.Lock()


class ConvBlock(nn.Module):
    def __init__(self, in_channels: int, out_channels: int) -> None:
        super().__init__()
        self.layers = nn.Sequential(
            nn.Conv3d(in_channels, out_channels, kernel_size=3, padding=1, bias=False),
            nn.InstanceNorm3d(out_channels, affine=True),
            nn.LeakyReLU(negative_slope=0.01, inplace=True),
            nn.Conv3d(out_channels, out_channels, kernel_size=3, padding=1, bias=False),
            nn.InstanceNorm3d(out_channels, affine=True),
            nn.LeakyReLU(negative_slope=0.01, inplace=True),
        )

    def forward(self, value: torch.Tensor) -> torch.Tensor:
        return self.layers(value)


class RibFractureUNet(nn.Module):
    def __init__(self, base_channels: int = 8) -> None:
        super().__init__()
        channels = (base_channels, base_channels * 2, base_channels * 4, base_channels * 8)
        self.enc1 = ConvBlock(1, channels[0])
        self.enc2 = ConvBlock(channels[0], channels[1])
        self.enc3 = ConvBlock(channels[1], channels[2])
        self.bottleneck = ConvBlock(channels[2], channels[3])
        self.pool = nn.MaxPool3d(kernel_size=2)
        self.up3 = nn.ConvTranspose3d(channels[3], channels[2], kernel_size=2, stride=2)
        self.dec3 = ConvBlock(channels[2] * 2, channels[2])
        self.up2 = nn.ConvTranspose3d(channels[2], channels[1], kernel_size=2, stride=2)
        self.dec2 = ConvBlock(channels[1] * 2, channels[1])
        self.up1 = nn.ConvTranspose3d(channels[1], channels[0], kernel_size=2, stride=2)
        self.dec1 = ConvBlock(channels[0] * 2, channels[0])
        self.output = nn.Conv3d(channels[0], 1, kernel_size=1)

    def forward(self, value: torch.Tensor) -> torch.Tensor:
        first = self.enc1(value)
        second = self.enc2(self.pool(first))
        third = self.enc3(self.pool(second))
        center = self.bottleneck(self.pool(third))
        decoded = self.dec3(torch.cat((self.up3(center), third), dim=1))
        decoded = self.dec2(torch.cat((self.up2(decoded), second), dim=1))
        decoded = self.dec1(torch.cat((self.up1(decoded), first), dim=1))
        return self.output(decoded)


def _load_model() -> tuple[RibFractureUNet, tuple[str, ...]]:
    if not CHECKPOINT_PATH.is_file():
        raise FileNotFoundError(f"Rib-fracture model checkpoint is not installed at {CHECKPOINT_PATH}.")
    checkpoint = torch.load(CHECKPOINT_PATH, map_location="cpu", weights_only=True)
    if not isinstance(checkpoint, dict):
        raise ValueError("The rib-fracture checkpoint is not a supported checkpoint object.")
    if checkpoint.get("architecture") != "fracture-unet3d-v2":
        raise ValueError("The fracture checkpoint has an unsupported architecture.")
    if tuple(checkpoint.get("roi_size", ())) != ROI_SIZE:
        raise ValueError("The fracture checkpoint ROI size does not match this inference pipeline.")
    expected_digest = checkpoint.get("state_sha256")
    state = checkpoint.get("state_dict")
    if not isinstance(state, dict) or expected_digest != _state_digest(state):
        raise ValueError("The fracture checkpoint failed its state integrity check.")
    regions = tuple(sorted(set(checkpoint.get("regions", ()))))
    if not regions or not set(regions).issubset(SUPPORTED_REGIONS):
        raise ValueError("The fracture checkpoint has unsupported or missing anatomical region metadata.")
    if checkpoint.get("target_spacing_mm") != TARGET_SPACING_MM:
        raise ValueError("The fracture checkpoint spacing does not match this inference pipeline.")
    model = RibFractureUNet(base_channels=int(checkpoint.get("base_channels", 8)))
    model.load_state_dict(state, strict=True)
    model.eval()
    return model, regions


def _state_digest(state: dict[str, Any]) -> str:
    hasher = hashlib.sha256()
    for name in sorted(state):
        tensor = state[name].detach().cpu().contiguous()
        hasher.update(name.encode("utf-8"))
        hasher.update(tensor.numpy().tobytes())
    return hasher.hexdigest()


def checkpoint_available() -> bool:
    return CHECKPOINT_PATH.is_file()


def _get_model() -> RibFractureUNet:
    global _model, _model_regions
    if _model is None:
        with _model_lock:
            if _model is None:
                _model, _model_regions = _load_model()
    return _model


def prepare_ct(data: np.ndarray, affine: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    if data.ndim != 3 or not np.isfinite(data).all():
        raise ValueError("A finite, 3D CT volume is required for fracture segmentation.")
    image = nib.Nifti1Image(np.asarray(data, dtype=np.float32), np.asarray(affine, dtype=np.float64))
    canonical = nib.as_closest_canonical(image)
    spacing = nib.affines.voxel_sizes(canonical.affine)
    estimated_shape = tuple(
        math.ceil(size * voxel_spacing / TARGET_SPACING_MM)
        for size, voxel_spacing in zip(canonical.shape, spacing, strict=True)
    )
    if math.prod(estimated_shape) > MAX_RIBFRACTURE_VOXELS:
        raise ValueError("CT volume exceeds the local fracture inference voxel limit.")
    resampled = resample_to_output(canonical, voxel_sizes=(TARGET_SPACING_MM,) * 3, order=1)
    if math.prod(resampled.shape) > MAX_RIBFRACTURE_VOXELS:
        raise ValueError("CT volume exceeds the local fracture inference voxel limit.")
    hu = np.nan_to_num(resampled.get_fdata(dtype=np.float32), nan=-1000.0, posinf=2000.0, neginf=-1000.0)
    normalized = np.clip((hu + 1000.0) / 1500.0, 0.0, 1.0)
    return normalized.astype(np.float32), np.asarray(resampled.affine, dtype=np.float64)


def _mesh_for_mask(mask: np.ndarray, affine: np.ndarray) -> tuple[np.ndarray, np.ndarray] | None:
    if not np.any(mask) or np.all(mask):
        return None
    strides = tuple(max(1, math.ceil(size / MAX_SURFACE_DIMENSION)) for size in mask.shape)
    sampled = mask[::strides[0], ::strides[1], ::strides[2]].astype(np.uint8, copy=False)
    if not np.any(sampled) or np.all(sampled):
        return None
    vertices, faces, _, _ = marching_cubes(
        sampled,
        level=0.5,
        spacing=tuple(float(stride) for stride in strides),
        step_size=1,
        allow_degenerate=False,
    )
    homogeneous = np.column_stack((vertices, np.ones(len(vertices), dtype=np.float32)))
    world = (np.asarray(affine, dtype=np.float64) @ homogeneous.T).T[:, :3]
    if np.linalg.det(np.asarray(affine, dtype=np.float64)[:3, :3]) < 0:
        faces = faces[:, [0, 2, 1]]
    return world, faces.astype(np.uint32)


def segment_rib_fractures(
    data: np.ndarray,
    affine: np.ndarray,
    target_region: str,
    mesh_center_mm: np.ndarray,
    mesh_scale: float,
) -> dict[str, Any]:
    if target_region not in SUPPORTED_REGIONS:
        raise ValueError(f"Unsupported fracture target region: {target_region}")
    model = _get_model()
    if target_region not in _model_regions:
        return {
            "status": "scope_unavailable",
            "message": (
                f"This checkpoint was trained for {', '.join(_model_regions)}; "
                f"it does not cover the selected {target_region} region."
            ),
            "model": MODEL_NAME,
            "version": MODEL_VERSION,
            "supported_regions": list(_model_regions),
            "threshold": 0.5,
            "voxel_count": None,
            "part": None,
        }
    volume, volume_affine = prepare_ct(data, affine)
    inferer = SlidingWindowInferer(
        roi_size=ROI_SIZE,
        sw_batch_size=1,
        overlap=0.5,
        mode="gaussian",
        padding_mode="replicate",
        sw_device="cpu",
        device="cpu",
    )
    input_tensor = torch.from_numpy(volume[None, None])
    with _inference_lock, torch.inference_mode():
        logits = inferer(input_tensor, model)
    mask = logits[0, 0].numpy() >= 0.0
    voxel_count = int(np.count_nonzero(mask))
    mesh = _mesh_for_mask(mask, volume_affine)
    part = None
    if mesh is not None:
        vertices, faces = mesh
        normalized_vertices = ((vertices - mesh_center_mm) * mesh_scale).astype(np.float32)
        part = {
            "name": f"Predicted {target_region} fracture candidates",
            "color": FRACTURE_COLOR,
            "voxel_count": voxel_count,
            "vertices": normalized_vertices,
            "faces": faces,
        }
    status = "no_candidates" if voxel_count == 0 else "candidates" if part is not None else "unavailable"
    message = {
        "candidates": "The experimental model marked candidate voxels; these are unverified predictions, not a diagnosis.",
        "no_candidates": "The model produced no candidate voxels above its fixed threshold; this does not rule out fracture.",
        "unavailable": "The model returned voxels but could not produce a usable candidate surface.",
    }[status]
    return {
        "status": status,
        "message": message,
        "model": MODEL_NAME,
        "version": MODEL_VERSION,
        "supported_regions": list(_model_regions),
        "threshold": 0.5,
        "voxel_count": voxel_count,
        "part": part,
    }


segment_fractures = segment_rib_fractures


def resample_label_to_image(label_path: Path, image: nib.spatialimages.SpatialImage) -> np.ndarray:
    label = nib.load(str(label_path))
    aligned = nib.as_closest_canonical(label)
    target = (image.shape, image.affine)
    return np.asarray(resample_from_to(aligned, target, order=0).get_fdata(dtype=np.float32) > 0, dtype=np.uint8)
