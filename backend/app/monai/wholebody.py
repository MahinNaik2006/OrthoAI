from __future__ import annotations

import math
import hashlib
import threading
from typing import Any

import numpy as np
import torch
from monai.data import MetaTensor
from monai.inferers import SlidingWindowInferer
from monai.networks.nets import SegResNet
from monai.transforms import (
    Compose,
    EnsureChannelFirstd,
    EnsureTyped,
    NormalizeIntensityd,
    Orientationd,
    ScaleIntensityd,
    Spacingd,
)
from skimage.measure import marching_cubes

from app.core.config import MODEL_CACHE_DIR

MODEL_REPOSITORY = "MONAI/wholeBody_ct_segmentation"
MODEL_REVISION = "13f6d33ae9de6664571d935ee647039f477c3fad"
CHECKPOINT_SHA256 = "c3ab55eb979785fdcb30690872c210bbeee73d79a170c32fdaa1eca117779f90"
CHECKPOINT_PATH = MODEL_CACHE_DIR / "wholeBody_ct_segmentation" / "model_lowres.pt"
TARGET_SPACING_MM = 3.0
ROI_SIZE = (96, 96, 96)
MAX_SURFACE_DIMENSION = 128

ANATOMY_GROUPS: tuple[dict[str, Any], ...] = (
    {
        "name": "Ribs",
        "label_ids": tuple(range(58, 82)),
        "color": "#46c8f0",
    },
    {
        "name": "Vertebrae and sacrum",
        "label_ids": (*range(18, 42), 92),
        "color": "#dce5ef",
    },
    {
        "name": "Other modeled bones",
        "label_ids": (*range(82, 92), 93),
        "color": "#a58bfa",
    },
)

_model: SegResNet | None = None
_model_lock = threading.Lock()
_inference_lock = threading.Lock()


def _build_model() -> SegResNet:
    if not CHECKPOINT_PATH.is_file():
        raise FileNotFoundError(
            f"MONAI anatomy checkpoint is not installed at {CHECKPOINT_PATH}. "
            f"Download models/model_lowres.pt from {MODEL_REPOSITORY} at revision {MODEL_REVISION}."
        )
    hasher = hashlib.sha256()
    with CHECKPOINT_PATH.open("rb") as checkpoint_file:
        for chunk in iter(lambda: checkpoint_file.read(1024 * 1024), b""):
            hasher.update(chunk)
    digest = hasher.hexdigest()
    if digest != CHECKPOINT_SHA256:
        raise ValueError("The cached MONAI low-resolution checkpoint failed SHA-256 verification.")

    network = SegResNet(
        spatial_dims=3,
        in_channels=1,
        out_channels=105,
        init_filters=32,
        blocks_down=(1, 2, 2, 4),
        blocks_up=(1, 1, 1),
        dropout_prob=0.2,
    )
    state = torch.load(CHECKPOINT_PATH, map_location="cpu", weights_only=True)
    network.load_state_dict(state, strict=True)
    network.eval()
    return network


def _get_model() -> SegResNet:
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:
                _model = _build_model()
    return _model


def _bone_group_masks(class_map: torch.Tensor) -> torch.Tensor:
    masks = []
    for group in ANATOMY_GROUPS:
        label_ids = torch.tensor(group["label_ids"], dtype=class_map.dtype, device=class_map.device)
        masks.append(torch.isin(class_map, label_ids))
    return torch.stack(masks, dim=1).to(dtype=torch.float32)


def _surface_for_mask(
    mask: np.ndarray,
    affine: np.ndarray,
) -> tuple[np.ndarray, np.ndarray] | None:
    if not np.any(mask) or np.all(mask):
        return None

    strides = tuple(max(1, math.ceil(size / MAX_SURFACE_DIMENSION)) for size in mask.shape)
    sampled = mask[:: strides[0], :: strides[1], :: strides[2]].astype(np.uint8, copy=False)
    if not np.any(sampled) or np.all(sampled):
        return None

    vertices, faces, _, _ = marching_cubes(
        sampled,
        level=0.5,
        spacing=tuple(float(stride) for stride in strides),
        step_size=2,
        allow_degenerate=False,
    )
    homogeneous = np.column_stack((vertices, np.ones(len(vertices), dtype=np.float32)))
    world_vertices = (np.asarray(affine, dtype=np.float64) @ homogeneous.T).T[:, :3]
    if np.linalg.det(np.asarray(affine, dtype=np.float64)[:3, :3]) < 0:
        faces = faces[:, [0, 2, 1]]
    return world_vertices, faces.astype(np.uint32)


def segment_bone_anatomy(
    data: np.ndarray,
    affine: np.ndarray,
) -> dict[str, Any]:
    if data.ndim != 3:
        raise ValueError("A 3D CT volume is required for MONAI anatomy segmentation.")

    transforms = Compose(
        [
            EnsureChannelFirstd(keys="image", channel_dim="no_channel"),
            Orientationd(keys="image", axcodes="RAS"),
            Spacingd(keys="image", pixdim=(TARGET_SPACING_MM,) * 3, mode="bilinear"),
            NormalizeIntensityd(keys="image", nonzero=True),
            ScaleIntensityd(keys="image", minv=-1.0, maxv=1.0),
            EnsureTyped(keys="image", dtype=torch.float32),
        ]
    )
    image = transforms(
        {"image": MetaTensor(np.asarray(data, dtype=np.float32), affine=np.asarray(affine, dtype=np.float64))}
    )["image"]
    model_input = image.unsqueeze(0)
    model = _get_model()
    inferer = SlidingWindowInferer(
        roi_size=ROI_SIZE,
        sw_batch_size=1,
        overlap=0.25,
        padding_mode="replicate",
        mode="gaussian",
        sw_device="cpu",
        device="cpu",
    )

    with _inference_lock, torch.inference_mode():
        group_votes = inferer(model_input, lambda patch: _bone_group_masks(model(patch).argmax(dim=1)))

    predicted_masks = group_votes[0].numpy() >= 0.5
    label_map = np.zeros(predicted_masks.shape[1:], dtype=np.uint8)
    for label, mask in enumerate(predicted_masks, start=1):
        label_map[mask] = label
    model_image = image.as_tensor().squeeze(0).detach().cpu().numpy()
    slice_image = np.clip((model_image + 1.0) * 127.5, 0, 255).astype(np.uint8)
    model_affine = image.affine.detach().cpu().numpy()
    raw_parts: list[dict[str, Any]] = []
    all_vertices: list[np.ndarray] = []

    for group, mask in zip(ANATOMY_GROUPS, predicted_masks, strict=True):
        voxel_count = int(np.count_nonzero(mask))
        mesh = _surface_for_mask(mask, model_affine)
        if mesh is None:
            continue
        vertices, faces = mesh
        all_vertices.append(vertices)
        raw_parts.append(
            {
                "name": group["name"],
                "color": group["color"],
                "voxel_count": voxel_count,
                "vertices": vertices,
                "faces": faces,
            }
        )

    if not raw_parts:
        raise ValueError("MONAI returned no meshable modeled bone labels for this scan.")

    all_world_vertices = np.concatenate(all_vertices, axis=0)
    center = all_world_vertices.mean(axis=0)
    all_world_vertices -= center
    span = float(np.max(np.ptp(all_world_vertices, axis=0)))
    if not math.isfinite(span) or span <= 0:
        raise ValueError("MONAI segmentation did not produce a usable 3D bone surface.")

    scale = 3.4 / span
    for part in raw_parts:
        part["vertices"] = ((part["vertices"] - center) * scale).astype(np.float32)

    return {
        "parts": raw_parts,
        "spacing_mm": TARGET_SPACING_MM,
        "mesh_center_mm": center.astype(np.float64),
        "mesh_scale": scale,
        "slice_image": slice_image,
        "slice_labels": label_map,
        "slice_shape": tuple(int(size) for size in label_map.shape),
        "labels": [part["name"] for part in raw_parts],
        "vertex_count": sum(len(part["vertices"]) for part in raw_parts),
        "face_count": sum(len(part["faces"]) for part in raw_parts),
    }
