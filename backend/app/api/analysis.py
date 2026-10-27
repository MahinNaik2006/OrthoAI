from __future__ import annotations

import json
import logging
from collections import Counter
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException

from app.core.config import CASES_PATH
from app.llm.ollama_client import analyze_report_text, ollama_available
from app.monai.models import MODEL_REGISTRY
from app.reports.mysql_store import ReportDatabaseError, get_report_dashboard_summary

router = APIRouter(prefix="/api", tags=["analysis"])
logger = logging.getLogger(__name__)
RECENT_CASE_LIMIT = 8


def _read_cases() -> list[dict[str, Any]]:
    if not CASES_PATH.exists():
        return []
    try:
        content = CASES_PATH.read_text(encoding="utf-8")
        cases = json.loads(content) if content else []
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        logger.exception("Could not read the saved case index.")
        raise HTTPException(status_code=500, detail="The saved case index could not be read.") from exc
    if not isinstance(cases, list) or any(not isinstance(case, dict) for case in cases):
        raise HTTPException(status_code=500, detail="The saved case index has an invalid format.")
    return cases


def _count_values(values: Counter[str]) -> list[dict[str, Any]]:
    return [
        {"name": name, "count": count}
        for name, count in sorted(values.items(), key=lambda item: (-item[1], item[0]))
    ]


def _parse_datetime(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed


@router.get("/dashboard")
async def dashboard() -> dict[str, Any]:
    cases = _read_cases()
    regions: Counter[str] = Counter()
    fracture_statuses: Counter[str] = Counter()
    anatomy_statuses: Counter[str] = Counter()
    mesh_statuses: Counter[str] = Counter()
    processing_times: list[float] = []
    dimension_count = 0
    spacing_count = 0
    dated_case_count = 0
    unassigned_patient_count = 0
    recent_cases: list[dict[str, Any]] = []

    for case in cases:
        analysis = case.get("analysis")
        analysis = analysis if isinstance(analysis, dict) else {}
        scan = analysis.get("scan")
        scan = scan if isinstance(scan, dict) else {}
        fracture = analysis.get("fracture")
        fracture = fracture if isinstance(fracture, dict) else {}
        anatomy = analysis.get("anatomy")
        anatomy = anatomy if isinstance(anatomy, dict) else {}
        mesh = analysis.get("mesh")
        mesh = mesh if isinstance(mesh, dict) else {}

        region = fracture.get("target_region") or scan.get("body_region") or "Not recorded"
        regions[str(region)] += 1
        fracture_status = str(fracture.get("status") or "unknown")
        anatomy_status = str(anatomy.get("status") or "unknown")
        mesh_status = str(mesh.get("status") or "unknown")
        fracture_statuses[fracture_status] += 1
        anatomy_statuses[anatomy_status] += 1
        mesh_statuses[mesh_status] += 1

        processing_time = scan.get("processing_time_ms")
        if (
            isinstance(processing_time, (int, float))
            and not isinstance(processing_time, bool)
            and processing_time >= 0
        ):
            processing_times.append(float(processing_time))
        dimensions = scan.get("scan_dimensions")
        spacing = scan.get("voxel_spacing")
        dimension_count += int(isinstance(dimensions, list) and bool(dimensions))
        spacing_count += int(isinstance(spacing, list) and bool(spacing))
        unassigned_patient_count += int(
            not case.get("patient_id") or case.get("patient_id") == "UNASSIGNED"
        )

        created_at = _parse_datetime(case.get("created_at"))
        dated_case_count += int(created_at is not None)
        recent_cases.append(
            {
                "id": str(case.get("id") or "Unknown case"),
                "created_at": created_at.isoformat() if created_at else None,
                "region": str(region),
                "slice_count": scan.get("slice_count"),
                "scan_dimensions": dimensions if isinstance(dimensions, list) else [],
                "voxel_spacing": spacing if isinstance(spacing, list) else [],
                "processing_time_ms": (
                    processing_time
                    if isinstance(processing_time, (int, float)) and not isinstance(processing_time, bool)
                    else None
                ),
                "fracture_status": fracture_status,
                "anatomy_status": anatomy_status,
                "mesh_status": mesh_status,
            }
        )

    recent_cases.reverse()
    report_summary: dict[str, Any] = {
        "available": False,
        "count": None,
        "embedding_ready": None,
        "embedding_failed": None,
        "embedding_pending": None,
        "latest_created_at": None,
        "error": None,
    }
    try:
        report_summary.update(get_report_dashboard_summary())
    except ReportDatabaseError as exc:
        report_summary["error"] = str(exc)
    else:
        report_summary["available"] = True

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "cases": {
            "total": len(cases),
            "fracture_candidates": fracture_statuses["candidates"],
            "anatomy_ready": anatomy_statuses["ready"],
            "fracture_statuses": _count_values(fracture_statuses),
            "anatomy_statuses": _count_values(anatomy_statuses),
            "mesh_statuses": _count_values(mesh_statuses),
            "regions": _count_values(regions),
            "processing_time_ms": {
                "sample_count": len(processing_times),
                "average": sum(processing_times) / len(processing_times) if processing_times else None,
                "minimum": min(processing_times) if processing_times else None,
                "maximum": max(processing_times) if processing_times else None,
            },
            "metadata": {
                "with_scan_dimensions": dimension_count,
                "with_voxel_spacing": spacing_count,
                "with_upload_time": dated_case_count,
                "without_upload_time": len(cases) - dated_case_count,
                "unassigned_patient": unassigned_patient_count,
            },
            "recent": recent_cases[:RECENT_CASE_LIMIT],
        },
        "reports": report_summary,
        "services": {
            "ollama_available": ollama_available(),
            "report_database_available": report_summary["available"],
        },
        "models": MODEL_REGISTRY,
        "counts_include_legacy_records": True,
        "clinical_notice": (
            "Counts describe records saved in this workspace. Experimental fracture candidate outputs "
            "are not diagnoses; MONAI provides anatomy segmentation only. No surgical recommendation "
            "is generated, and all clinical decisions require qualified clinician review."
        ),
    }


@router.post("/clinical-summary")
async def clinical_summary(payload: dict[str, Any]) -> dict[str, Any]:
    report_text = payload.get("report_text", "")
    findings = analyze_report_text(report_text)
    return {"clinical_summary": findings}
