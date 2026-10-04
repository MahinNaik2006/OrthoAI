from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.analysis import router as analysis_router
from app.api.imaging import router as imaging_router
from app.api.reports import router as reports_router
from app.api.surgery import router as surgery_router
from app.api.upload import router as upload_router

app = FastAPI(title="ORTHO_AI API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(upload_router)
app.include_router(imaging_router)
app.include_router(analysis_router)
app.include_router(reports_router)
app.include_router(surgery_router)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": "ORTHO_AI"}
