from __future__ import annotations

from pathlib import Path
from typing import Any

import nibabel as nib
import numpy as np
from nibabel.orientations import aff2axcodes


def analyze_nifti(file_path: str | Path, data: np.ndarray | None = None) -> dict[str, Any]:
    image = nib.load(str(file_path))
    if data is None:
        data = image.get_fdata(dtype=np.float32)
    affine = image.affine
    header = image.header

    spacing = tuple(float(v) for v in header.get_zooms()[:3])
    voxel_spacing = spacing if len(spacing) == 3 else (1.0, 1.0, 1.0)
    shape = tuple(int(dim) for dim in image.shape)

    modality = "CT"
    body_region = "Unspecified (not encoded in NIfTI header)"
    orientation = "".join(aff2axcodes(affine))
    quality = "not assessed"

    summary = {
        "filename": Path(file_path).name,
        "modality": modality,
        "body_region": body_region,
        "slice_count": shape[2] if len(shape) > 2 else 1,
        "voxel_spacing": list(voxel_spacing),
        "scan_dimensions": list(shape),
        "orientation": orientation,
        "scan_quality": quality,
        "processing_time_ms": None,
        "intensity_range": [float(np.nanmin(data)), float(np.nanmax(data))] if data is not None else None,
        "spacing": list(voxel_spacing),
        "affine": affine.tolist(),
    }
    return summary
