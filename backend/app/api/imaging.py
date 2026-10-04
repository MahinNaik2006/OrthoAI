from __future__ import annotations

from fastapi import APIRouter

from app.monai.models import MODEL_REGISTRY

router = APIRouter(prefix="/api", tags=["imaging"])


@router.get("/models")
async def list_models():
    return {"models": MODEL_REGISTRY}


@router.get("/processing-status")
async def processing_status():
    return {
        "status": "complete",
        "queue": [
            {"name": "Queued", "done": True},
            {"name": "Preprocessing", "done": True},
            {"name": "Inference", "done": True},
            {"name": "Postprocessing", "done": True},
            {"name": "Mesh generation", "done": True},
            {"name": "Complete", "done": True},
        ],
    }
