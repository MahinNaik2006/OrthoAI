from __future__ import annotations

import zipfile
import logging
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
import fitz

from app.core.config import EMBEDDING_MODEL_NAME, MODEL_NAME, TEMP_DIR
from app.llm.ollama_client import (
    analyze_preoperative_context,
    analyze_report_text,
    answer_report_question,
    create_embeddings,
)
from app.reports.mysql_store import (
    ReportDatabaseError,
    list_reports,
    mark_embedding_status,
    retrieve_relevant_chunks,
    store_embeddings,
    store_report,
)
from app.reports.parser import extract_text_from_report, parse_clinical_fields
from app.reports.chunking import split_report_into_chunks, validate_patient_id

router = APIRouter(prefix="/api", tags=["reports"])
MAX_REPORT_BYTES = 15 * 1024 * 1024
logger = logging.getLogger("ortho_ai.reports")
ALLOWED_INGESTION_FORMATS = {".txt", ".pdf", ".docx"}


class ReportQuestion(BaseModel):
    question: str = Field(min_length=3, max_length=500)


def _validate_patient_id(patient_id: str) -> str:
    try:
        return validate_patient_id(patient_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


async def _persist_report(patient_id: str, file: UploadFile) -> dict:
    _validate_patient_id(patient_id)
    if not file.filename:
        raise HTTPException(status_code=400, detail="No report file uploaded")

    suffix = Path(file.filename.replace("\\", "/")).suffix.lower()
    if suffix not in ALLOWED_INGESTION_FORMATS:
        raise HTTPException(
            status_code=415,
            detail="Report ingestion supports searchable PDF, DOCX, and TXT files. Image OCR is not configured.",
        )

    contents = await file.read(MAX_REPORT_BYTES + 1)
    if len(contents) > MAX_REPORT_BYTES:
        raise HTTPException(status_code=413, detail="Report exceeds the 15 MB upload limit.")

    safe_filename = Path(file.filename.replace("\\", "/")).name[:180]
    temp_path = TEMP_DIR / f"report_{uuid4()}{suffix}"
    try:
        temp_path.write_bytes(contents)
        try:
            report_text = extract_text_from_report(temp_path)
        except (OSError, ValueError, RuntimeError, zipfile.BadZipFile, fitz.FileDataError) as exc:
            raise HTTPException(status_code=422, detail="Could not extract text from this report.") from exc
    finally:
        temp_path.unlink(missing_ok=True)

    chunks = split_report_into_chunks(report_text)
    if not chunks:
        raise HTTPException(
            status_code=422,
            detail="No searchable text was found. Scanned PDFs need OCR before ingestion.",
        )

    structured_fields = parse_clinical_fields(report_text)
    try:
        report = store_report(
            patient_id=patient_id,
            filename=safe_filename,
            mime_type=file.content_type or "application/octet-stream",
            report_data=contents,
            extracted_text=report_text,
            structured_fields=structured_fields,
        )
    except ReportDatabaseError as exc:
        logger.error("MySQL report persistence failed: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    try:
        embeddings = create_embeddings(chunks)
        store_embeddings(
            report_id=report["id"],
            patient_id=patient_id,
            chunks=chunks,
            embeddings=embeddings,
        )
        report["chunk_count"] = len(chunks)
        report["embedding_status"] = "ready"
    except (RuntimeError, ReportDatabaseError) as exc:
        logger.warning("Report %s stored, but vector indexing failed: %s", report["id"], exc)
        try:
            mark_embedding_status(report["id"], "unavailable")
        except ReportDatabaseError as status_error:
            logger.error("Could not update embedding status for report %s: %s", report["id"], status_error)
        report["embedding_status"] = "unavailable"

    return {
        "report": report,
        "structured": structured_fields,
        "storage": "MySQL",
        "embedding_model": EMBEDDING_MODEL_NAME if report["embedding_status"] == "ready" else None,
        "_report_text": report_text,
    }


def _database_http_error(exc: ReportDatabaseError) -> HTTPException:
    logger.error("MySQL report database request failed: %s", exc)
    return HTTPException(status_code=503, detail=str(exc))


@router.get("/patients/{patient_id}/reports")
async def get_patient_reports(patient_id: str) -> dict:
    _validate_patient_id(patient_id)
    try:
        reports = list_reports(patient_id=patient_id)
    except ReportDatabaseError as exc:
        raise _database_http_error(exc) from exc
    return {"patient_id": patient_id, "reports": reports}


@router.get("/reports")
async def get_reports(patient_id: str | None = None, limit: int = 100) -> dict:
    if patient_id:
        _validate_patient_id(patient_id)
    try:
        reports = list_reports(patient_id=patient_id, limit=limit)
    except ReportDatabaseError as exc:
        raise _database_http_error(exc) from exc
    return {"reports": reports, "count": len(reports)}


@router.post("/reports/ingest")
async def ingest_report(
    patient_id: str = Form(...),
    file: UploadFile = File(...),
) -> dict:
    result = await _persist_report(patient_id, file)
    result.pop("_report_text")
    return {
        "status": "stored",
        **result,
        "message": "Original report, extracted text, and patient metadata were stored in MySQL.",
    }


@router.post("/patients/{patient_id}/preoperative-review")
async def preoperative_review(patient_id: str) -> dict:
    _validate_patient_id(patient_id)
    try:
        reports = list_reports(patient_id=patient_id)
    except ReportDatabaseError as exc:
        raise _database_http_error(exc) from exc
    if not reports:
        raise HTTPException(status_code=404, detail="No reports have been ingested for this patient.")

    query = (
        "preoperative surgery review medical history comorbidities medications allergies "
        "anticoagulation bleeding infection cardiovascular respiratory renal anesthesia "
        "laboratory results missing information"
    )
    try:
        query_embedding = create_embeddings([query])[0]
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    try:
        relevant_chunks = retrieve_relevant_chunks(
            patient_id=patient_id,
            query_embedding=query_embedding,
            embedding_model=EMBEDDING_MODEL_NAME,
        )
    except ReportDatabaseError as exc:
        raise _database_http_error(exc) from exc
    if not relevant_chunks:
        raise HTTPException(
            status_code=409,
            detail="No compatible report vectors were found. Re-ingest reports with the configured local embedding model.",
        )
    try:
        analysis = analyze_preoperative_context(relevant_chunks)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return {
        "status": "review_required",
        "patient_id": patient_id,
        "model": "llama3.2",
        "embedding_model": EMBEDDING_MODEL_NAME,
        "reports_included": len(reports),
        "retrieved_chunks": [
            {
                "filename": chunk["filename"],
                "similarity": round(float(chunk["similarity"]), 3),
            }
            for chunk in relevant_chunks
        ],
        "analysis": analysis,
        "disclaimer": "Decision support only. A qualified clinician must review the source reports and findings; this is not surgical clearance.",
    }


@router.post("/patients/{patient_id}/report-chat")
async def report_chat(patient_id: str, payload: ReportQuestion) -> dict:
    _validate_patient_id(patient_id)
    question = payload.question.strip()
    if len(question) < 3:
        raise HTTPException(status_code=422, detail="Question is too short.")

    try:
        reports = list_reports(patient_id=patient_id)
    except ReportDatabaseError as exc:
        raise _database_http_error(exc) from exc
    if not reports:
        raise HTTPException(status_code=404, detail="No reports have been ingested for this patient.")

    try:
        query_embedding = create_embeddings([question])[0]
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    try:
        relevant_chunks = retrieve_relevant_chunks(
            patient_id=patient_id,
            query_embedding=query_embedding,
            embedding_model=EMBEDDING_MODEL_NAME,
            limit=6,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ReportDatabaseError as exc:
        raise _database_http_error(exc) from exc
    if not relevant_chunks:
        raise HTTPException(
            status_code=409,
            detail="No compatible report vectors were found. Re-ingest reports with the configured local embedding model.",
        )

    try:
        answer = answer_report_question(question, relevant_chunks)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return {
        "status": "answered",
        "patient_id": patient_id,
        "model": MODEL_NAME,
        "embedding_model": EMBEDDING_MODEL_NAME,
        "question": question,
        "answer": answer,
        "reports_included": len(reports),
        "sources": [
            {
                "filename": chunk["filename"],
                "similarity": round(float(chunk["similarity"]), 3),
                "excerpt": chunk["content"][:280],
            }
            for chunk in relevant_chunks
        ],
        "disclaimer": (
            "Decision support only. Answers are derived from ingested report excerpts and may be "
            "incomplete. A qualified clinician must verify the original reports; this is not surgical clearance."
        ),
    }


@router.post("/analyze-report")
async def analyze_report(
    patient_id: str = Form("UNASSIGNED"),
    file: UploadFile = File(...),
) -> dict:
    stored = await _persist_report(patient_id, file)
    inference = analyze_report_text(stored["_report_text"])
    stored.pop("_report_text")

    return {
        "status": "stored",
        "report": stored["report"],
        "storage": stored["storage"],
        "structured": stored["structured"],
        "ai_summary": inference,
        "patient": {
            "name": stored["structured"].get("patient_name", "Not provided"),
            "urgency": inference.get("urgency", "review_required"),
        },
    }
