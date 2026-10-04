from __future__ import annotations

from fastapi import APIRouter

from app.surgery.planner import generate_surgical_plan

router = APIRouter(prefix="/api", tags=["surgery"])


@router.post("/surgical-plan")
async def surgical_plan(payload: dict):
    fracture_summary = payload.get("fracture_summary", {})
    plan = generate_surgical_plan(fracture_summary)
    return {"plan": plan}
