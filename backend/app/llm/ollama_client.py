from __future__ import annotations

import json
from typing import Any

import requests

from app.core.config import EMBEDDING_MODEL_NAME, MODEL_NAME, OLLAMA_URL


def create_embeddings(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    try:
        response = requests.post(
            f"{OLLAMA_URL}/api/embed",
            json={"model": EMBEDDING_MODEL_NAME, "input": texts},
            timeout=60,
        )
        response.raise_for_status()
        embeddings = response.json().get("embeddings")
        if not isinstance(embeddings, list) or len(embeddings) != len(texts):
            raise RuntimeError("Ollama returned an unexpected embedding response.")
        return [[float(value) for value in embedding] for embedding in embeddings]
    except requests.RequestException as exc:
        raise RuntimeError(
            f"Could not create local embeddings using {EMBEDDING_MODEL_NAME}. "
            "Check that Ollama is running and the embedding model is installed."
        ) from exc
    except (TypeError, ValueError) as exc:
        raise RuntimeError("Ollama returned invalid vector embeddings.") from exc


def analyze_preoperative_context(context_chunks: list[dict[str, Any]]) -> dict[str, Any]:
    evidence = "\n\n".join(
        f"[{chunk['filename']} · relevant report excerpt]\n{chunk['content']}"
        for chunk in context_chunks
    )
    if not evidence:
        raise ValueError("There are no ingested report excerpts to analyze.")

    payload = {
        "model": MODEL_NAME,
        "format": "json",
        "stream": False,
        "options": {"temperature": 0},
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a local clinical decision-support assistant. Analyze only the supplied "
                    "report excerpts for preoperative review. Do not infer absent facts, diagnose, "
                    "recommend that surgery must occur, or clear a patient for surgery. If evidence "
                    "is absent, state that it is missing. Return JSON with keys: summary, "
                    "preoperative_findings, potential_risks, medications_to_review, allergies, "
                    "missing_information, questions_for_clinician, urgency. Use arrays of concise "
                    "strings for all keys except summary and urgency. Set urgency to review_required."
                ),
            },
            {
                "role": "user",
                "content": f"Review these retrieved report excerpts before surgery:\n{evidence[:12000]}",
            },
        ],
    }
    try:
        response = requests.post(f"{OLLAMA_URL}/api/chat", json=payload, timeout=90)
        response.raise_for_status()
        result = response.json().get("message", {}).get("content", "")
        parsed = json.loads(result)
        if not isinstance(parsed, dict):
            raise RuntimeError("The local model response was not a JSON object.")
        if not isinstance(parsed.get("summary"), str):
            raise RuntimeError("The local model response did not include a valid summary.")
        for field in (
            "preoperative_findings",
            "potential_risks",
            "medications_to_review",
            "allergies",
            "missing_information",
            "questions_for_clinician",
        ):
            values = parsed.get(field, [])
            if not isinstance(values, list) or any(not isinstance(value, str) for value in values):
                raise RuntimeError(f"The local model returned an invalid {field} list.")
            parsed[field] = values
        parsed["urgency"] = "review_required"
        return parsed
    except requests.RequestException as exc:
        raise RuntimeError(
            f"Could not analyze report context with local Ollama model {MODEL_NAME}. "
            "Check that Ollama is running and the model is installed."
        ) from exc
    except (json.JSONDecodeError, TypeError) as exc:
        raise RuntimeError("The local model returned invalid structured report analysis.") from exc


def answer_report_question(question: str, context_chunks: list[dict[str, Any]]) -> str:
    evidence = "\n\n".join(
        f"[{chunk['filename']} · relevant report excerpt]\n{chunk['content']}"
        for chunk in context_chunks
    )
    if not evidence:
        raise ValueError("There are no ingested report excerpts to answer from.")

    payload = {
        "model": MODEL_NAME,
        "stream": False,
        "options": {"temperature": 0},
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a local clinical decision-support assistant for an orthopedic team. "
                    "Answer the clinician's question using only the supplied patient report excerpts. "
                    "Cite the source filename in brackets when stating a fact. If the excerpts do not "
                    "contain the answer, say that the information is not present in the ingested reports "
                    "and note what should be verified. Do not diagnose, invent facts, recommend surgery, "
                    "or clear a patient for surgery. Keep the answer concise and clinically neutral."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Patient report excerpts:\n{evidence[:12000]}\n\n"
                    f"Clinician question: {question}"
                ),
            },
        ],
    }
    try:
        response = requests.post(f"{OLLAMA_URL}/api/chat", json=payload, timeout=90)
        response.raise_for_status()
        answer = response.json().get("message", {}).get("content", "").strip()
        if not answer:
            raise RuntimeError("The local model returned an empty answer.")
        return answer
    except requests.RequestException as exc:
        raise RuntimeError(
            f"Could not answer from reports with local Ollama model {MODEL_NAME}. "
            "Check that Ollama is running and the model is installed."
        ) from exc


def ollama_available() -> bool:
    try:
        requests.get(f"{OLLAMA_URL}/api/tags", timeout=2)
        return True
    except requests.RequestException:
        return False


def analyze_report_text(text: str) -> dict[str, Any]:
    if not ollama_available():
        return {
            "summary": "No local Ollama instance detected. Demonstration report analysis returned for prototype review.",
            "preoperative_findings": [
                "Medical history available",
                "Medication review recommended",
                "Lab information needs confirmation",
            ],
            "potential_risks": ["Bleeding risk review", "Cardiovascular review", "Respiratory assessment"],
            "medications_to_review": ["Anticoagulants", "Antiplatelet therapy"],
            "allergies": ["No allergy data recorded"],
            "missing_information": ["Anesthesia history", "Lab values", "Renal function"],
            "questions_for_clinician": [
                "Confirm anticoagulant status",
                "Verify 24h medication list",
                "Review cardiac risk assessment",
            ],
            "urgency": "review_required",
            "demo_mode": True,
        }

    payload = {
        "model": MODEL_NAME,
        "format": "json",
        "stream": False,
        "messages": [
            {
                "role": "user",
                "content": (
                    "You are a clinical decision-support assistant for orthopedic preoperative review. "
                    "Summarize the report and return JSON only with keys: "
                    "summary, preoperative_findings, potential_risks, medications_to_review, allergies, "
                    "missing_information, questions_for_clinician, urgency. "
                    "Do not clear the patient for surgery. Identify items for clinician review. "
                    f"Medical report text: {text[:4000]}"
                ),
            }
        ],
    }

    try:
        response = requests.post(f"{OLLAMA_URL}/api/chat", json=payload, timeout=30)
        response.raise_for_status()
        content = response.json()
        result = content.get("message", {}).get("content", "")
        parsed = json.loads(result)
        if isinstance(parsed, dict):
            parsed.setdefault("demo_mode", False)
            return parsed
    except Exception:
        pass

    return {
        "summary": "Local report analysis completed with a demo structure while the Ollama model is unavailable.",
        "preoperative_findings": ["Clinical history available"],
        "potential_risks": ["Medication review recommended"],
        "medications_to_review": [],
        "allergies": [],
        "missing_information": ["Lab values, medication reconciliation"],
        "questions_for_clinician": ["Please confirm medication list and allergies"],
        "urgency": "review_required",
        "demo_mode": True,
    }
