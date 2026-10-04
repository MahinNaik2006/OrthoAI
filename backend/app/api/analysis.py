from __future__ import annotations

from fastapi import APIRouter

from app.llm.ollama_client import analyze_report_text

router = APIRouter(prefix="/api", tags=["analysis"])


@router.get("/dashboard")
async def dashboard():
    return {
        "data_mode": "demo",
        "total_cases": 42,
        "cases_analyzed": 33,
        "fractures_detected": 18,
        "reports_analyzed": 24,
        "pending_reviews": 7,
        "high_priority_findings": 4,
        "average_processing_time": "6.8 min",
        "cases_over_time": [
            {"month": "May", "cases": 12},
            {"month": "Jun", "cases": 18},
            {"month": "Jul", "cases": 24},
            {"month": "Aug", "cases": 29},
            {"month": "Sep", "cases": 35},
            {"month": "Oct", "cases": 42},
        ],
        "fracture_distribution": [
            {"name": "Rib / thoracic", "count": 11},
            {"name": "Other bone", "count": 5},
            {"name": "Unspecified", "count": 2},
        ],
        "review_queue": [
            {"label": "AI findings to review", "count": 7, "level": "Review"},
            {"label": "High-priority items", "count": 4, "level": "High priority"},
            {"label": "Missing report information", "count": 3, "level": "Missing"},
        ],
        "recent_cases": [
            {"id": "DEMO-042", "region": "Rib / thoracic", "study": "CT chest · RibFrac", "updated": "Today", "status": "Review required"},
            {"id": "DEMO-041", "region": "Rib / thoracic", "study": "CT chest · NIfTI", "updated": "Yesterday", "status": "Complete"},
            {"id": "DEMO-040", "region": "Thoracic", "study": "Report + CT study", "updated": "2 days ago", "status": "Processing"},
        ],
        "model_status": [
            {"name": "Rib fracture pipeline", "status": "Demo mode", "detail": "Ground-truth/demo workflow · not a clinical prediction"},
            {"name": "Ollama · llama3.2", "status": "Configured", "detail": "Local endpoint · report text remains on this machine"},
            {"name": "Soft-tissue models", "status": "Unavailable", "detail": "No validated model configured for this anatomy"},
        ],
    }


@router.post("/clinical-summary")
async def clinical_summary(payload: dict):
    report_text = payload.get("report_text", "")
    findings = analyze_report_text(report_text)
    return {"clinical_summary": findings}
