from __future__ import annotations

import json
import logging
import math
import time
from io import BytesIO
from pathlib import Path
from uuid import UUID, uuid4

import nibabel as nib
import numpy as np
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse, Response
from PIL import Image
from starlette.concurrency import run_in_threadpool

from app.core.config import CASES_PATH, UPLOAD_DIR
from app.fracture.rib import (
    MODEL_NAME as RIB_FRACTURE_MODEL_NAME,
    MODEL_VERSION as RIB_FRACTURE_MODEL_VERSION,
    SUPPORTED_REGIONS as FRACTURE_MODEL_REGIONS,
    checkpoint_available as rib_fracture_checkpoint_available,
    segment_fractures,
)
from app.imaging.loader import analyze_nifti
from app.imaging.mesh_generation import extract_ct_intensity_surface
from app.imaging.preprocessing import preprocess_volume
from app.monai.wholebody import MODEL_REPOSITORY, MODEL_REVISION, segment_bone_anatomy

router = APIRouter(prefix="/api", tags=["upload"])
MAX_CT_BYTES = 512 * 1024 * 1024
MAX_CT_VOXELS = 128_000_000
MAX_RESAMPLED_VOXELS = 30_000_000
MONAI_TARGET_SPACING_MM = 3.0
logger = logging.getLogger(__name__)


@router.post("/upload-ct")
async def upload_ct(
    patient_id: str = Form("UNASSIGNED"),
    target_region: str = Form("shoulder"),
    file: UploadFile = File(...),
) -> dict:
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file selected")
    target_region = target_region.strip().lower()
    if target_region not in FRACTURE_MODEL_REGIONS:
        raise HTTPException(
            status_code=422,
            detail=f"target_region must be one of: {', '.join(FRACTURE_MODEL_REGIONS)}.",
        )

    original_name = Path(file.filename.replace("\\", "/")).name
    if not (original_name.lower().endswith(".nii") or original_name.lower().endswith(".nii.gz")):
        raise HTTPException(
            status_code=415,
            detail="This endpoint currently processes single-file NIfTI (.nii / .nii.gz). DICOM series ingestion is not enabled yet.",
        )

    case_id = str(uuid4())
    safe_patient_id = "".join(character for character in patient_id if character.isalnum() or character in "_-")[:64]
    if not safe_patient_id:
        safe_patient_id = "UNASSIGNED"
    suffix = ".nii.gz" if original_name.lower().endswith(".nii.gz") else ".nii"
    file_path = UPLOAD_DIR / f"{case_id}_{safe_patient_id}{suffix}"
    contents = await file.read(MAX_CT_BYTES + 1)
    if len(contents) > MAX_CT_BYTES:
        raise HTTPException(status_code=413, detail="CT scan exceeds the 512 MB upload limit.")
    file_path.write_bytes(contents)

    processing_started = time.perf_counter()
    try:
        image = nib.load(str(file_path))
        if len(image.shape) != 3:
            file_path.unlink(missing_ok=True)
            raise HTTPException(status_code=422, detail="Expected a 3D NIfTI volume.")
        scan_shape = tuple(int(dimension) for dimension in image.shape)
        if math.prod(scan_shape) > MAX_CT_VOXELS:
            file_path.unlink(missing_ok=True)
            raise HTTPException(
                status_code=413,
                detail="CT volume has too many voxels for the configured local CPU inference limit.",
            )
        scan_spacing = tuple(float(value) for value in image.header.get_zooms()[:3])
        if len(scan_spacing) != 3 or any(not math.isfinite(value) or value <= 0 for value in scan_spacing):
            file_path.unlink(missing_ok=True)
            raise HTTPException(status_code=422, detail="The NIfTI volume has invalid voxel spacing.")
        resampled_shape = tuple(
            math.ceil(size * spacing / MONAI_TARGET_SPACING_MM)
            for size, spacing in zip(scan_shape, scan_spacing, strict=True)
        )
        if math.prod(resampled_shape) > MAX_RESAMPLED_VOXELS:
            file_path.unlink(missing_ok=True)
            raise HTTPException(
                status_code=413,
                detail="CT physical dimensions exceed the configured local CPU segmentation limit.",
            )
        scan_data = image.get_fdata(dtype=np.float32)
        summary = analyze_nifti(file_path, scan_data)
    except HTTPException:
        raise
    except (OSError, ValueError, nib.filebasedimages.ImageFileError) as exc:
        file_path.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail="The uploaded file is not a readable NIfTI volume.") from exc

    preprocessing = preprocess_volume(scan_data)
    summary["processing_time_ms"] = round((time.perf_counter() - processing_started) * 1000)
    anatomy_path = UPLOAD_DIR / f"{case_id}_anatomy.npz"
    slice_image_path = UPLOAD_DIR / f"{case_id}_slice_image.npy"
    slice_labels_path = UPLOAD_DIR / f"{case_id}_slice_labels.npy"
    fracture_path = UPLOAD_DIR / f"{case_id}_fracture.npz"
    try:
        anatomy = await run_in_threadpool(segment_bone_anatomy, scan_data, image.affine)
    except (FileNotFoundError, MemoryError, OSError, RuntimeError, ValueError) as exc:
        logger.warning("MONAI anatomy segmentation unavailable for case %s: %s", case_id, exc)
        anatomy_status = {
            "status": "unavailable",
            "model": "MONAI Whole Body CT Segmentation (low-resolution, 3 mm)",
            "message": str(exc),
            "labels": [],
            "processing_time_ms": None,
            "slice_count": None,
            "spacing_mm": None,
        }
        anatomy = None
    else:
        anatomy_elapsed_ms = round((time.perf_counter() - processing_started) * 1000) - summary["processing_time_ms"]
        anatomy_status = {
            "status": "ready",
            "model": "MONAI Whole Body CT Segmentation (low-resolution, 3 mm)",
            "message": (
                "Anatomical labels were segmented for visualization. This model does not detect fractures "
                "or plan treatment."
            ),
            "labels": anatomy["labels"],
            "processing_time_ms": anatomy_elapsed_ms,
            "slice_count": anatomy["slice_shape"][2],
            "spacing_mm": anatomy["spacing_mm"],
        }
        with anatomy_path.open("wb") as anatomy_file:
            np.savez_compressed(
                anatomy_file,
                part_count=len(anatomy["parts"]),
                vertex_count=anatomy["vertex_count"],
                face_count=anatomy["face_count"],
                spacing_mm=anatomy["spacing_mm"],
                mesh_center_mm=anatomy["mesh_center_mm"],
                mesh_scale=anatomy["mesh_scale"],
                slice_count=anatomy["slice_shape"][2],
                **{
                    f"part_{index}_{field}": part[field]
                    for index, part in enumerate(anatomy["parts"])
                    for field in ("vertices", "faces")
                },
                **{
                    f"part_{index}_{field}": value
                    for index, part in enumerate(anatomy["parts"])
                    for field, value in (
                        ("name", part["name"]),
                        ("color", part["color"]),
                        ("voxel_count", part["voxel_count"]),
                    )
                },
            )
        np.save(slice_image_path, anatomy["slice_image"])
        np.save(slice_labels_path, anatomy["slice_labels"])

    surface_path = UPLOAD_DIR / f"{case_id}_surface.npz"
    if anatomy is not None:
        mesh_status = {
            "status": "ready",
            "kind": "monai_anatomy_surface",
            "message": "Bone anatomy surface extracted from MONAI segmentation labels; fracture detection is not included.",
            "vertex_count": anatomy["vertex_count"],
            "face_count": anatomy["face_count"],
            "threshold_percentile": None,
            "threshold_intensity": None,
        }
    else:
        try:
            surface = extract_ct_intensity_surface(scan_data, image.affine)
        except ValueError as exc:
            mesh_status = {
                "status": "unavailable",
                "kind": "intensity_isosurface",
                "message": str(exc),
                "vertex_count": 0,
                "face_count": 0,
                "threshold_percentile": None,
                "threshold_intensity": None,
            }
        else:
            with surface_path.open("wb") as surface_file:
                np.savez_compressed(
                    surface_file,
                    vertices=surface["vertices"],
                    faces=surface["faces"],
                    threshold_percentile=surface["threshold_percentile"],
                    threshold_intensity=surface["threshold_intensity"],
                    vertex_count=surface["vertex_count"],
                    face_count=surface["face_count"],
                )
            mesh_status = {
                "status": "ready",
                "kind": "intensity_isosurface",
                "message": "MONAI anatomy segmentation was unavailable; showing an intensity surface instead.",
                "vertex_count": surface["vertex_count"],
                "face_count": surface["face_count"],
                "mesh_center_mm": surface["mesh_center_mm"].tolist(),
                "mesh_scale": surface["mesh_scale"],
                "threshold_percentile": surface["threshold_percentile"],
                "threshold_intensity": surface["threshold_intensity"],
            }

    fracture_status: dict[str, object]
    if not rib_fracture_checkpoint_available():
        fracture_status = {
            "status": "not_trained",
            "model": RIB_FRACTURE_MODEL_NAME,
            "version": RIB_FRACTURE_MODEL_VERSION,
            "message": (
                "No trained checkpoint is installed. From the backend directory, train with "
                "`python -m app.fracture.train --manifest <csv>` using paired labeled CT/mask NIfTIs "
                "and region values rib or shoulder, "
                "then restart the API. See app/fracture/README.md for the manifest and data requirements."
            ),
            "target_region": target_region,
            "supported_regions": [],
            "voxel_count": None,
            "threshold": 0.5,
        }
    elif anatomy is None and mesh_status["status"] != "ready":
        fracture_status = {
            "status": "unavailable",
            "model": RIB_FRACTURE_MODEL_NAME,
            "version": RIB_FRACTURE_MODEL_VERSION,
            "message": "Fracture inference is unavailable because a usable 3D scan surface could not be generated.",
            "target_region": target_region,
            "supported_regions": [],
            "voxel_count": None,
            "threshold": 0.5,
        }
    else:
        try:
            if anatomy is not None:
                mesh_center_mm = anatomy["mesh_center_mm"]
                mesh_scale = anatomy["mesh_scale"]
            else:
                mesh_center_mm = surface["mesh_center_mm"]
                mesh_scale = surface["mesh_scale"]
            fracture = await run_in_threadpool(
                segment_fractures,
                scan_data,
                image.affine,
                target_region,
                mesh_center_mm,
                mesh_scale,
            )
        except (FileNotFoundError, MemoryError, OSError, RuntimeError, ValueError) as exc:
            logger.exception("Rib-fracture candidate inference failed for case %s", case_id)
            fracture_status = {
                "status": "failed",
                "model": RIB_FRACTURE_MODEL_NAME,
                "version": RIB_FRACTURE_MODEL_VERSION,
                "message": f"Fracture model inference failed: {exc}",
                "target_region": target_region,
                "supported_regions": [],
                "voxel_count": None,
                "threshold": 0.5,
            }
        else:
            fracture_status = {
                key: fracture[key]
                for key in (
                    "status",
                    "message",
                    "model",
                    "version",
                    "target_region",
                    "supported_regions",
                    "voxel_count",
                    "threshold",
                )
            }
            if fracture["part"] is not None:
                fracture_part = fracture["part"]
                np.savez_compressed(
                    fracture_path,
                    name=fracture_part["name"],
                    color=fracture_part["color"],
                    voxel_count=fracture_part["voxel_count"],
                    vertices=fracture_part["vertices"],
                    faces=fracture_part["faces"],
                )

    case_summary = {
        "id": case_id,
        "patient_id": safe_patient_id,
        "filename": original_name,
        "analysis": {
            "scan": summary,
            "preprocessing": preprocessing,
            "fracture": {
                **fracture_status,
            },
            "anatomy": anatomy_status,
            "model": {
                "repository": MODEL_REPOSITORY,
                "revision": MODEL_REVISION,
                "source": "Hugging Face MONAI whole-body CT bundle",
                "license": "Apache-2.0 model bundle; cited TotalSegmentator dataset is CC-BY-4.0",
            },
            "mesh": {
                **mesh_status,
            },
        },
        "disclaimer": (
            "MONAI anatomy segmentation is an anatomical visualization, not fracture detection. "
            "When unavailable, the display falls back to a raw-intensity isosurface. "
            "No diagnosis or surgical recommendation is provided; clinician review is required."
        ),
    }

    if CASES_PATH.exists():
        cases = json.loads(CASES_PATH.read_text(encoding="utf-8")) if CASES_PATH.read_text(encoding="utf-8") else []
    else:
        cases = []
    cases.append(case_summary)
    CASES_PATH.write_text(json.dumps(cases, indent=2), encoding="utf-8")

    return {
        "status": "success",
        "case": case_summary,
        "visualization": {
            "mode": "monai_anatomy_and_optional_fracture_candidates",
            "anatomy_segmentation_available": anatomy is not None,
            "fracture_segmentation_available": fracture_status["status"] == "candidates",
            "fracture_segmentation_is_experimental": True,
            "postoperative_simulation": True,
        },
    }


@router.get("/cases/{case_id}/slices/{slice_index}")
async def get_ct_slice(case_id: str, slice_index: int, overlay: bool = True) -> Response:
    try:
        normalized_case_id = str(UUID(case_id))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid case ID.") from exc

    anatomy_path = UPLOAD_DIR / f"{normalized_case_id}_anatomy.npz"
    slice_image_path = UPLOAD_DIR / f"{normalized_case_id}_slice_image.npy"
    slice_labels_path = UPLOAD_DIR / f"{normalized_case_id}_slice_labels.npy"
    if not anatomy_path.is_file() or not slice_image_path.is_file() or not slice_labels_path.is_file():
        raise HTTPException(status_code=404, detail="MONAI slice segmentation is unavailable for this case.")

    slice_image = np.load(slice_image_path, mmap_mode="r", allow_pickle=False)
    slice_labels = np.load(slice_labels_path, mmap_mode="r", allow_pickle=False)
    slice_count = int(slice_image.shape[2])
    if not 0 <= slice_index < slice_count:
        raise HTTPException(status_code=404, detail=f"Slice index must be between 0 and {slice_count - 1}.")
    ct_slice = np.flipud(slice_image[:, :, slice_index].T)
    label_slice = np.flipud(slice_labels[:, :, slice_index].T)

    rgb = np.repeat(ct_slice[:, :, None], 3, axis=2)
    if overlay:
        colors = (
            (70, 200, 240),
            (220, 229, 239),
            (165, 139, 250),
        )
        for label, color in enumerate(colors, start=1):
            mask = label_slice == label
            if np.any(mask):
                rgb[mask] = (0.45 * rgb[mask] + 0.55 * np.asarray(color)).astype(np.uint8)

    output = BytesIO()
    Image.fromarray(rgb).save(output, format="PNG")
    return Response(content=output.getvalue(), media_type="image/png", headers={"Cache-Control": "no-store"})


@router.get("/cases/{case_id}/surface")
async def get_ct_surface(case_id: str) -> JSONResponse:
    try:
        normalized_case_id = str(UUID(case_id))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid case ID.") from exc

    anatomy_path = UPLOAD_DIR / f"{normalized_case_id}_anatomy.npz"
    fracture_path = UPLOAD_DIR / f"{normalized_case_id}_fracture.npz"
    if anatomy_path.is_file():
        with np.load(anatomy_path, allow_pickle=False) as anatomy:
            parts = []
            for index in range(int(anatomy["part_count"])):
                parts.append(
                    {
                        "name": str(anatomy[f"part_{index}_name"].item()),
                        "color": str(anatomy[f"part_{index}_color"].item()),
                        "voxel_count": int(anatomy[f"part_{index}_voxel_count"]),
                        "vertices": anatomy[f"part_{index}_vertices"].reshape(-1).tolist(),
                        "faces": anatomy[f"part_{index}_faces"].reshape(-1).tolist(),
                    }
                )
            fracture_part = None
            if fracture_path.is_file():
                with np.load(fracture_path, allow_pickle=False) as fracture:
                    fracture_part = {
                        "name": str(fracture["name"].item()),
                        "color": str(fracture["color"].item()),
                        "voxel_count": int(fracture["voxel_count"]),
                        "vertices": fracture["vertices"].reshape(-1).tolist(),
                        "faces": fracture["faces"].reshape(-1).tolist(),
                    }
            return JSONResponse(
                {
                    "source": "monai_anatomy_segmentation",
                    "parts": parts,
                    "fracture_part": fracture_part,
                    "spacing_mm": float(anatomy["spacing_mm"]),
                    "vertex_count": int(anatomy["vertex_count"]),
                    "face_count": int(anatomy["face_count"]),
                }
            )

    surface_path = UPLOAD_DIR / f"{normalized_case_id}_surface.npz"
    if not surface_path.is_file():
        raise HTTPException(status_code=404, detail="No CT-derived surface is available for this case.")

    with np.load(surface_path, allow_pickle=False) as surface:
        fracture_part = None
        if fracture_path.is_file():
            with np.load(fracture_path, allow_pickle=False) as fracture:
                fracture_part = {
                    "name": str(fracture["name"].item()),
                    "color": str(fracture["color"].item()),
                    "voxel_count": int(fracture["voxel_count"]),
                    "vertices": fracture["vertices"].reshape(-1).tolist(),
                    "faces": fracture["faces"].reshape(-1).tolist(),
                }
        return JSONResponse(
            {
                "source": "intensity_isosurface",
                "fracture_part": fracture_part,
                "vertices": surface["vertices"].reshape(-1).tolist(),
                "faces": surface["faces"].reshape(-1).tolist(),
                "threshold_percentile": float(surface["threshold_percentile"]),
                "threshold_intensity": float(surface["threshold_intensity"]),
                "vertex_count": int(surface["vertex_count"]),
                "face_count": int(surface["face_count"]),
            }
        )
