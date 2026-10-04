from __future__ import annotations

import re

PATIENT_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
CHUNK_SIZE = 900
CHUNK_OVERLAP = 100


def validate_patient_id(patient_id: str) -> str:
    if not PATIENT_ID_PATTERN.fullmatch(patient_id):
        raise ValueError("Patient ID must contain only letters, numbers, underscores, or hyphens.")
    return patient_id


def split_report_into_chunks(text: str) -> list[str]:
    normalized = " ".join(text.split())
    if not normalized:
        return []

    chunks: list[str] = []
    start = 0
    while start < len(normalized):
        end = min(start + CHUNK_SIZE, len(normalized))
        if end < len(normalized):
            boundary = normalized.rfind(" ", start + CHUNK_SIZE // 2, end)
            if boundary > start:
                end = boundary
        chunk = normalized[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end == len(normalized):
            break
        start = max(end - CHUNK_OVERLAP, start + 1)
    return chunks
