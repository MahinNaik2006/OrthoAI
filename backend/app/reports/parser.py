from __future__ import annotations

import re
from pathlib import Path

import fitz
from docx import Document
from PIL import Image


def extract_text_from_report(file_path: str | Path) -> str:
    path = Path(file_path)
    suffix = path.suffix.lower()

    if suffix == ".txt":
        return path.read_text(encoding="utf-8", errors="ignore")

    if suffix == ".pdf":
        document = fitz.open(str(path))
        chunks = [page.get_text("text") for page in document]
        return "\n".join(filter(None, chunks))

    if suffix == ".docx":
        doc = Document(str(path))
        return "\n".join(paragraph.text for paragraph in doc.paragraphs if paragraph.text.strip())

    if suffix in {".png", ".jpg", ".jpeg", ".bmp"}:
        image = Image.open(path)
        return f"OCR unavailable for image file {path.name}. Metadata: {image.size}"

    return "Unable to extract text from uploaded report."


def parse_clinical_fields(text: str) -> dict[str, list[str] | str]:
    patient_match = re.search(r"Patient\s*[:\-]?\s*(.+)", text, flags=re.IGNORECASE)
    meds = re.findall(r"Medication[s]?\s*[:\-]?\s*([A-Za-z0-9, /-]+)", text, flags=re.IGNORECASE)
    allergies = re.findall(r"Allerg(?:y|ies)\s*[:\-]?\s*([A-Za-z0-9, /-]+)", text, flags=re.IGNORECASE)

    return {
        "patient_name": patient_match.group(1).strip() if patient_match else "Patient details not provided",
        "medications": meds or ["No medication list captured"],
        "allergies": allergies or ["No allergy data recorded"],
        "raw_text_excerpt": text[:500],
    }
