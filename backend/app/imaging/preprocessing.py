from __future__ import annotations

import numpy as np


def normalize_scan(data: np.ndarray) -> np.ndarray:
    data = np.asarray(data, dtype=np.float32)
    data = np.nan_to_num(data, nan=0.0, posinf=0.0, neginf=0.0)
    min_v = float(np.percentile(data, 1))
    max_v = float(np.percentile(data, 99))
    if max_v <= min_v:
        return data
    normalized = (data - min_v) / (max_v - min_v)
    return np.clip(normalized, 0.0, 1.0)


def preprocess_volume(data: np.ndarray) -> dict[str, float | int | list[int]]:
    normalized = normalize_scan(data)
    return {
        "volume_shape": list(normalized.shape),
        "mean_intensity": float(np.mean(normalized)),
        "std_intensity": float(np.std(normalized)),
        "min_intensity": float(np.min(normalized)),
        "max_intensity": float(np.max(normalized)),
        "step": 3,
        "orientation": "RAS",
    }
