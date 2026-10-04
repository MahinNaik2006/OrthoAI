from __future__ import annotations

import numpy as np


def create_demo_segmentation(mask_shape: tuple[int, ...]) -> np.ndarray:
    volume = np.zeros(mask_shape, dtype=np.float32)
    z, y, x = mask_shape
    for zz in range(max(0, z // 4), min(z, 3 * z // 4)):
        for yy in range(max(0, y // 3), min(y, 2 * y // 3)):
            for xx in range(max(0, x // 5), min(x, 4 * x // 5)):
                value = 1.0 if (xx + yy + zz) % 7 else 0.0
                volume[zz, yy, xx] = value
    return volume


def segment_fracture(data_shape: tuple[int, ...]) -> dict[str, float | int | list[float]]:
    mask = create_demo_segmentation(data_shape)
    fracture_voxels = int(np.count_nonzero(mask > 0))
    return {
        "fracture_regions": 2,
        "fracture_volume_mm3": float(fracture_voxels * 6.4),
        "confidence": 0.94,
        "location": "Right posterior rib region",
        "fragment_count": 3,
        "estimated_displacement_mm": 4.2,
        "mask_shape": list(mask.shape),
        "fracture_probability": 0.94,
        "severity": "moderate",
    }
