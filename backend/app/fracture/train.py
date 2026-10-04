from __future__ import annotations

import argparse
import csv
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

import nibabel as nib
import numpy as np
import torch
from monai.inferers import SlidingWindowInferer
from nibabel.processing import resample_from_to, resample_to_output
from torch import nn

from app.fracture.rib import (
    CHECKPOINT_PATH,
    MAX_RIBFRACTURE_VOXELS,
    ROI_SIZE,
    TARGET_SPACING_MM,
    RibFractureUNet,
    SUPPORTED_REGIONS,
    _state_digest,
)
from scipy.ndimage import binary_dilation


@dataclass(frozen=True)
class Case:
    image_path: Path
    label_path: Path
    split: str
    patient_id: str | None
    region: str


def load_manifest(path: Path) -> tuple[list[Case], list[Case]]:
    cases: list[Case] = []
    with path.open(newline="", encoding="utf-8-sig") as manifest:
        reader = csv.DictReader(manifest)
        required_columns = {"image", "label", "split", "region", "patient_id"}
        if reader.fieldnames is None or not required_columns.issubset(reader.fieldnames):
            raise ValueError("Manifest CSV must include image,label,split,region,patient_id columns.")
        for row_number, row in enumerate(reader, start=2):
            image = (path.parent / row["image"]).resolve()
            label = (path.parent / row["label"]).resolve()
            split = row["split"].strip().lower()
            if split not in {"train", "validation"}:
                raise ValueError(f"Manifest row {row_number}: split must be train or validation.")
            region = row["region"].strip().lower()
            if region not in SUPPORTED_REGIONS:
                raise ValueError(
                    f"Manifest row {row_number}: region must be one of {', '.join(SUPPORTED_REGIONS)}."
                )
            if not image.is_file() or not label.is_file():
                raise FileNotFoundError(f"Manifest row {row_number}: CT or mask file is missing.")
            patient_id = row.get("patient_id", "").strip() or None
            if patient_id is None:
                raise ValueError(f"Manifest row {row_number}: patient_id is required to prevent split leakage.")
            cases.append(Case(image, label, split, patient_id, region))
    image_paths = [case.image_path for case in cases]
    if len(image_paths) != len(set(image_paths)):
        raise ValueError("Manifest contains duplicate CT paths.")
    train_cases = [case for case in cases if case.split == "train"]
    validation_cases = [case for case in cases if case.split == "validation"]
    if not train_cases or not validation_cases:
        raise ValueError("Manifest must have separate train and validation cases.")
    if {case.region for case in train_cases} != {case.region for case in validation_cases}:
        raise ValueError("Every trained anatomical region must also appear in the validation split.")
    train_patients = {case.patient_id for case in train_cases if case.patient_id is not None}
    validation_patients = {case.patient_id for case in validation_cases if case.patient_id is not None}
    overlap = train_patients & validation_patients
    if overlap:
        raise ValueError("Manifest places a patient in both train and validation splits.")
    return train_cases, validation_cases


def load_case(case: Case) -> tuple[np.ndarray, np.ndarray]:
    image = nib.as_closest_canonical(nib.load(str(case.image_path)))
    mask_image = nib.as_closest_canonical(nib.load(str(case.label_path)))
    spacing = nib.affines.voxel_sizes(image.affine)
    estimated_shape = tuple(
        int(np.ceil(size * voxel_spacing / TARGET_SPACING_MM))
        for size, voxel_spacing in zip(image.shape, spacing, strict=True)
    )
    if int(np.prod(estimated_shape)) > MAX_RIBFRACTURE_VOXELS:
        raise ValueError(f"CT scan exceeds the training voxel limit: {case.image_path}")
    resampled_image = resample_to_output(image, voxel_sizes=(TARGET_SPACING_MM,) * 3, order=1)
    resampled_mask = resample_from_to(mask_image, (resampled_image.shape, resampled_image.affine), order=0)
    hu = np.nan_to_num(
        resampled_image.get_fdata(dtype=np.float32),
        nan=-1000.0,
        posinf=2000.0,
        neginf=-1000.0,
    )
    volume = np.clip((hu + 1000.0) / 1500.0, 0.0, 1.0).astype(np.float32)
    labels = np.asarray(resampled_mask.get_fdata(dtype=np.float32) > 0, dtype=np.float32)
    return volume, labels


def sample_patch(
    volume: np.ndarray,
    labels: np.ndarray,
    rng: np.random.Generator,
    sampling_coordinates: tuple[np.ndarray, np.ndarray] | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    patch_size = np.asarray(ROI_SIZE)
    required = np.maximum(np.asarray(volume.shape), patch_size)
    pad_before = np.maximum((required - volume.shape) // 2, 0)
    pad_after = required - np.asarray(volume.shape) - pad_before
    padding = tuple((int(before), int(after)) for before, after in zip(pad_before, pad_after, strict=True))
    volume = np.pad(volume, padding, mode="edge")
    labels = np.pad(labels, padding, mode="constant")

    if sampling_coordinates is None:
        foreground = labels > 0
        perilesional = binary_dilation(foreground, iterations=6) & ~foreground
        sampling_coordinates = (np.argwhere(foreground), np.argwhere(perilesional))
    positive_voxels, hard_negative_voxels = sampling_coordinates
    if np.any(pad_before):
        positive_voxels = positive_voxels + pad_before
        hard_negative_voxels = hard_negative_voxels + pad_before
    sample_kind = rng.random()
    if len(positive_voxels) and sample_kind < 0.55:
        center = positive_voxels[int(rng.integers(len(positive_voxels)))]
    elif len(hard_negative_voxels) and sample_kind < 0.8:
        center = hard_negative_voxels[int(rng.integers(len(hard_negative_voxels)))]
    else:
        center = np.asarray([rng.integers(size) for size in labels.shape])
    maximum_start = np.asarray(labels.shape) - patch_size
    start = np.clip(center - patch_size // 2, 0, maximum_start)
    slices = tuple(slice(int(offset), int(offset + size)) for offset, size in zip(start, patch_size, strict=True))
    image_patch = volume[slices].copy()
    label_patch = labels[slices].copy()

    for axis in range(3):
        if rng.random() < 0.5:
            image_patch = np.flip(image_patch, axis=axis)
            label_patch = np.flip(label_patch, axis=axis)
    rotation_axes = tuple(rng.choice(3, size=2, replace=False).tolist())
    rotation = int(rng.integers(4))
    image_patch = np.rot90(image_patch, rotation, axes=rotation_axes)
    label_patch = np.rot90(label_patch, rotation, axes=rotation_axes)
    gain = float(rng.uniform(0.9, 1.1))
    offset = float(rng.uniform(-0.04, 0.04))
    image_patch = np.clip(image_patch * gain + offset, 0.0, 1.0)
    if rng.random() < 0.5:
        image_patch += rng.normal(0.0, 0.015, size=image_patch.shape).astype(np.float32)
        image_patch = np.clip(image_patch, 0.0, 1.0)
    return np.ascontiguousarray(image_patch), np.ascontiguousarray(label_patch)


def dice_loss(logits: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
    probabilities = torch.sigmoid(logits)
    intersection = torch.sum(probabilities * target)
    denominator = torch.sum(probabilities) + torch.sum(target)
    return 1.0 - (2.0 * intersection + 1e-5) / (denominator + 1e-5)


def patch_dice(logits: torch.Tensor, target: torch.Tensor) -> float:
    prediction = logits >= 0
    truth = target >= 0.5
    intersection = torch.count_nonzero(prediction & truth).item()
    total = torch.count_nonzero(prediction).item() + torch.count_nonzero(truth).item()
    return 1.0 if total == 0 else 2.0 * intersection / total


def evaluate(
    model: RibFractureUNet,
    cases: Sequence[Case],
    device: torch.device,
) -> dict[str, float | dict[str, float]]:
    model.eval()
    inferer = SlidingWindowInferer(
        roi_size=ROI_SIZE,
        sw_batch_size=1,
        overlap=0.5,
        mode="gaussian",
        padding_mode="replicate",
        sw_device=device,
        device=device,
    )
    total_intersection = total_predicted = total_target = 0
    case_dice_scores: list[float] = []
    positive_case_scores: list[float] = []
    negative_case_false_positives: list[bool] = []
    region_positive_scores: dict[str, list[float]] = {}
    with torch.inference_mode():
        for case in cases:
            volume, labels = load_case(case)
            logits = inferer(torch.from_numpy(volume[None, None]).to(device), model)
            prediction = logits[0, 0] >= 0.0
            target = torch.from_numpy(labels).to(device) >= 0.5
            intersection = int(torch.count_nonzero(prediction & target).item())
            predicted = int(torch.count_nonzero(prediction).item())
            target_count = int(torch.count_nonzero(target).item())
            total_intersection += intersection
            total_predicted += predicted
            total_target += target_count
            denominator = predicted + target_count
            case_score = 1.0 if denominator == 0 else 2.0 * intersection / denominator
            case_dice_scores.append(case_score)
            if target_count:
                positive_case_scores.append(case_score)
                region_positive_scores.setdefault(case.region, []).append(case_score)
            else:
                negative_case_false_positives.append(predicted > 0)
    micro_denominator = total_predicted + total_target
    return {
        "micro_dice": 1.0 if micro_denominator == 0 else 2.0 * total_intersection / micro_denominator,
        "mean_case_dice": float(np.mean(case_dice_scores)),
        "positive_case_dice": float(np.mean(positive_case_scores)) if positive_case_scores else 0.0,
        "negative_case_false_positive_rate": (
            float(np.mean(negative_case_false_positives)) if negative_case_false_positives else 0.0
        ),
        "region_positive_case_dice": {
            region: float(np.mean(scores))
            for region, scores in sorted(region_positive_scores.items())
        },
    }


def train(args: argparse.Namespace) -> None:
    train_cases, validation_cases = load_manifest(args.manifest)
    training_regions = sorted({case.region for case in train_cases})
    validation_regions = sorted({case.region for case in validation_cases})
    device_name = "cuda" if args.device == "auto" and torch.cuda.is_available() else args.device
    if device_name == "auto":
        device_name = "cpu"
    device = torch.device(device_name)
    random.seed(args.seed)
    torch.manual_seed(args.seed)
    rng = np.random.default_rng(args.seed)
    if device.type == "cuda":
        torch.cuda.manual_seed_all(args.seed)
    model = RibFractureUNet(base_channels=args.base_channels).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate, weight_decay=1e-5)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
        optimizer,
        mode="max",
        factor=0.5,
        patience=max(2, args.patience // 3),
        min_lr=args.minimum_learning_rate,
    )
    best_dice = -1.0
    epochs_without_improvement = 0
    cases_by_region = {
        region: [case for case in train_cases if case.region == region]
        for region in training_regions
    }
    cases_per_region = max(len(cases) for cases in cases_by_region.values())
    for epoch in range(1, args.epochs + 1):
        model.train()
        epoch_losses: list[float] = []
        cases = [
            random.choice(cases_by_region[region])
            for region in training_regions
            for _ in range(cases_per_region)
        ]
        random.shuffle(cases)
        for case in cases:
            volume, labels = load_case(case)
            foreground = labels > 0
            sampling_coordinates = (
                np.argwhere(foreground),
                np.argwhere(binary_dilation(foreground, iterations=6) & ~foreground),
            )
            for _ in range(args.patches_per_volume):
                image_patch, label_patch = sample_patch(volume, labels, rng, sampling_coordinates)
                image_tensor = torch.from_numpy(image_patch[None, None]).to(device)
                label_tensor = torch.from_numpy(label_patch[None, None]).to(device)
                optimizer.zero_grad(set_to_none=True)
                logits = model(image_tensor)
                positive_count = torch.sum(label_tensor)
                negative_count = label_tensor.numel() - positive_count
                positive_weight = torch.clamp(
                    torch.sqrt((negative_count + 1) / (positive_count + 1)),
                    min=1.0,
                    max=args.maximum_positive_weight,
                )
                weighted_bce = nn.functional.binary_cross_entropy_with_logits(
                    logits,
                    label_tensor,
                    pos_weight=positive_weight,
                )
                loss = weighted_bce + dice_loss(logits, label_tensor)
                loss.backward()
                optimizer.step()
                epoch_losses.append(float(loss.detach().cpu()))

        validation_dice = evaluate(
            model,
            validation_cases,
            device,
        )
        mean_loss = float(np.mean(epoch_losses))
        region_scores = validation_dice["region_positive_case_dice"]
        if set(region_scores) != set(validation_regions):
            missing_regions = sorted(set(validation_regions) - set(region_scores))
            raise ValueError(
                "The validation split needs at least one fracture-positive mask for each region: "
                f"{', '.join(missing_regions)}."
            )
        region_macro_dice = float(np.mean([region_scores[region] for region in validation_regions]))
        scheduler.step(region_macro_dice)
        print(
            f"epoch={epoch}/{args.epochs} loss={mean_loss:.4f} "
            f"validation_volume_micro_dice={validation_dice['micro_dice']:.4f} "
            f"validation_mean_positive_case_dice={validation_dice['positive_case_dice']:.4f} "
            f"validation_region_macro_dice={region_macro_dice:.4f} "
            f"validation_negative_case_fp_rate={validation_dice['negative_case_false_positive_rate']:.4f} "
            f"lr={optimizer.param_groups[0]['lr']:.2e}",
            flush=True,
        )
        if region_macro_dice > best_dice:
            best_dice = region_macro_dice
            epochs_without_improvement = 0
            state = {name: tensor.detach().cpu() for name, tensor in model.state_dict().items()}
            temporary_output = args.output.with_suffix(args.output.suffix + ".tmp")
            torch.save(
                {
                    "architecture": "fracture-unet3d-v2",
                    "base_channels": args.base_channels,
                    "target_spacing_mm": TARGET_SPACING_MM,
                    "roi_size": ROI_SIZE,
                    "threshold": 0.5,
                    "regions": training_regions,
                    "state_sha256": _state_digest(state),
                    "state_dict": state,
                    "validation_volume_micro_dice": validation_dice["micro_dice"],
                    "validation_mean_positive_case_dice": validation_dice["positive_case_dice"],
                    "validation_negative_case_false_positive_rate": validation_dice[
                        "negative_case_false_positive_rate"
                    ],
                    "validation_region_macro_dice": best_dice,
                    "epoch": epoch,
                    "dataset_manifest": str(args.manifest.resolve()),
                },
                temporary_output,
            )
            temporary_output.replace(args.output)
        else:
            epochs_without_improvement += 1
            if epochs_without_improvement >= args.patience:
                print(f"early_stopping=validation_mean_case_dice_no_improvement_{args.patience}_epochs", flush=True)
                break
    print(f"best_validation_region_macro_dice={best_dice:.4f} checkpoint={args.output}", flush=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train the experimental 3D fracture segmentation CNN.")
    parser.add_argument(
        "--manifest",
        type=Path,
        required=True,
        help="CSV with image,label,split,region,patient_id columns.",
    )
    parser.add_argument("--output", type=Path, default=CHECKPOINT_PATH)
    parser.add_argument("--epochs", type=int, default=50)
    parser.add_argument("--patches-per-volume", type=int, default=4)
    parser.add_argument("--base-channels", type=int, default=8)
    parser.add_argument("--learning-rate", type=float, default=1e-3)
    parser.add_argument("--minimum-learning-rate", type=float, default=1e-5)
    parser.add_argument("--maximum-positive-weight", type=float, default=20.0)
    parser.add_argument("--patience", type=int, default=8)
    parser.add_argument("--device", choices=("auto", "cpu", "cuda"), default="auto")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    if args.epochs < 1 or args.patches_per_volume < 1 or args.patience < 1:
        parser.error("epoch, patch, and patience counts must be positive.")
    if args.base_channels < 1 or args.learning_rate <= 0 or args.minimum_learning_rate <= 0:
        parser.error("base channels and learning rates must be positive.")
    if args.maximum_positive_weight < 1:
        parser.error("maximum positive weight must be at least one.")
    if args.device == "cuda" and not torch.cuda.is_available():
        parser.error("CUDA was requested but is not available in this PyTorch environment.")
    return args


if __name__ == "__main__":
    train(parse_args())
