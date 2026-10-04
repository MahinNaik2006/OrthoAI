from __future__ import annotations

import math

import numpy as np
from skimage.measure import marching_cubes


MAX_SURFACE_DIMENSION = 96
SURFACE_PERCENTILE = 85.0


def extract_ct_intensity_surface(data: np.ndarray, affine: np.ndarray) -> dict[str, np.ndarray | float | int]:
    if data.ndim != 3:
        raise ValueError("A 3D CT volume is required to extract a surface.")

    steps = tuple(max(1, math.ceil(size / MAX_SURFACE_DIMENSION)) for size in data.shape)
    sampled = np.asarray(data[::steps[0], ::steps[1], ::steps[2]], dtype=np.float32)
    sampled = np.nan_to_num(sampled, nan=0.0, posinf=0.0, neginf=0.0)
    if any(size < 2 for size in sampled.shape):
        raise ValueError("The CT volume is too small to create a 3D surface.")

    threshold = float(np.percentile(sampled, SURFACE_PERCENTILE))
    if not float(np.min(sampled)) < threshold < float(np.max(sampled)):
        raise ValueError("The CT volume does not contain enough intensity variation for a surface.")

    vertices, faces, _, _ = marching_cubes(
        sampled,
        level=threshold,
        spacing=tuple(float(step) for step in steps),
        step_size=2,
        allow_degenerate=False,
    )
    homogeneous_vertices = np.column_stack((vertices, np.ones(len(vertices), dtype=np.float32)))
    world_vertices = (np.asarray(affine, dtype=np.float64) @ homogeneous_vertices.T).T[:, :3]
    mesh_center_mm = world_vertices.mean(axis=0).copy()
    world_vertices -= mesh_center_mm
    span = float(np.max(np.ptp(world_vertices, axis=0)))
    if not math.isfinite(span) or span <= 0:
        raise ValueError("The CT volume did not produce a usable 3D surface.")

    mesh_scale = 3.4 / span
    world_vertices *= mesh_scale
    if np.linalg.det(np.asarray(affine, dtype=np.float64)[:3, :3]) < 0:
        faces = faces[:, [0, 2, 1]]

    return {
        "vertices": world_vertices.astype(np.float32),
        "faces": faces.astype(np.uint32),
        "threshold_percentile": SURFACE_PERCENTILE,
        "threshold_intensity": threshold,
        "vertex_count": int(len(vertices)),
        "face_count": int(len(faces)),
        "mesh_center_mm": mesh_center_mm.astype(np.float64),
        "mesh_scale": mesh_scale,
    }


def generate_mesh_summary(shape: tuple[int, ...]) -> dict[str, float | int]:
    volume = shape[0] * shape[1] * shape[2]
    return {
        "vertices": max(1200, int(volume / 150)),
        "faces": max(2400, int(volume / 80)),
        "surface_area_mm2": float(volume * 0.032),
        "wireframe": False,
        "mesh_quality": "demo",
    }


def create_measurements() -> list[dict[str, float | str]]:
    return [
        {"label": "Fracture displacement", "value": 4.2, "unit": "mm"},
        {"label": "Approx fracture length", "value": 58.1, "unit": "mm"},
        {"label": "Bone involvement", "value": "Posterior rib", "unit": "anatomy"},
    ]
