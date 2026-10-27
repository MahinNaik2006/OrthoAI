from __future__ import annotations

import json
import math
import re
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterator, Sequence
from uuid import uuid4

import pymysql
from pymysql.cursors import DictCursor

from app.core.config import (
    EMBEDDING_MODEL_NAME,
    MYSQL_DATABASE,
    MYSQL_HOST,
    MYSQL_PASSWORD,
    MYSQL_PORT,
    MYSQL_USER,
)

_DATABASE_IDENTIFIER = re.compile(r"^[A-Za-z0-9_]{1,64}$")


class ReportDatabaseError(RuntimeError):
    """The local MySQL report database could not complete an operation."""


def _connection_kwargs(include_database: bool = True) -> dict[str, Any]:
    if not MYSQL_PASSWORD:
        raise ReportDatabaseError("MYSQL_PASSWORD is not configured for the local report database.")
    if not _DATABASE_IDENTIFIER.fullmatch(MYSQL_DATABASE):
        raise ReportDatabaseError("MYSQL_DATABASE must contain only letters, numbers, or underscores.")
    return {
        "host": MYSQL_HOST,
        "port": MYSQL_PORT,
        "user": MYSQL_USER,
        "password": MYSQL_PASSWORD,
        "charset": "utf8mb4",
        "cursorclass": DictCursor,
        "connect_timeout": 5,
        "read_timeout": 20,
        "write_timeout": 20,
        **({"database": MYSQL_DATABASE} if include_database else {}),
    }


def _database_error(exc: Exception) -> ReportDatabaseError:
    return ReportDatabaseError(
        f"Could not connect to MySQL at {MYSQL_HOST}:{MYSQL_PORT}/{MYSQL_DATABASE}: {exc}"
    )


@contextmanager
def _connection() -> Iterator[pymysql.connections.Connection]:
    try:
        connection = pymysql.connect(**_connection_kwargs())
    except pymysql.err.OperationalError as exc:
        if exc.args[0] != 1049:
            raise _database_error(exc) from exc
        try:
            server_kwargs = _connection_kwargs(include_database=False)
            server_connection = pymysql.connect(**server_kwargs)
            try:
                with server_connection.cursor() as cursor:
                    cursor.execute(
                        f"CREATE DATABASE IF NOT EXISTS `{MYSQL_DATABASE}` "
                        "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
                    )
                server_connection.commit()
            finally:
                server_connection.close()
            connection = pymysql.connect(**_connection_kwargs())
        except (pymysql.MySQLError, ReportDatabaseError) as create_error:
            raise _database_error(create_error) from create_error
    except (pymysql.MySQLError, ReportDatabaseError) as exc:
        raise _database_error(exc) from exc

    try:
        yield connection
    except pymysql.MySQLError as exc:
        connection.rollback()
        raise _database_error(exc) from exc
    finally:
        connection.close()


def _ensure_schema() -> None:
    with _connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS medical_reports (
                    id CHAR(36) NOT NULL PRIMARY KEY,
                    patient_id VARCHAR(64) NOT NULL,
                    filename VARCHAR(180) NOT NULL,
                    mime_type VARCHAR(120) NOT NULL,
                    file_size BIGINT UNSIGNED NOT NULL,
                    report_data LONGBLOB NOT NULL,
                    extracted_text LONGTEXT NOT NULL,
                    structured_fields JSON NOT NULL,
                    embedding_status VARCHAR(32) NOT NULL DEFAULT 'pending',
                    embedding_model VARCHAR(80) NULL,
                    chunk_count INT UNSIGNED NOT NULL DEFAULT 0,
                    created_at DATETIME(6) NOT NULL,
                    INDEX idx_medical_reports_patient_created (patient_id, created_at)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                """
            )
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS medical_report_chunks (
                    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                    report_id CHAR(36) NOT NULL,
                    patient_id VARCHAR(64) NOT NULL,
                    chunk_index INT UNSIGNED NOT NULL,
                    content TEXT NOT NULL,
                    embedding_json JSON NOT NULL,
                    embedding_model VARCHAR(80) NOT NULL,
                    created_at DATETIME(6) NOT NULL,
                    UNIQUE KEY uq_medical_report_chunk (report_id, chunk_index),
                    INDEX idx_report_chunks_patient (patient_id),
                    CONSTRAINT fk_report_chunks_report
                        FOREIGN KEY (report_id) REFERENCES medical_reports(id) ON DELETE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                """
            )
        connection.commit()


def store_report(
    *,
    patient_id: str,
    filename: str,
    mime_type: str,
    report_data: bytes,
    extracted_text: str,
    structured_fields: dict[str, Any],
) -> dict[str, Any]:
    report_id = str(uuid4())
    created_at = datetime.now(timezone.utc).replace(tzinfo=None)
    try:
        _ensure_schema()
        with _connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO medical_reports (
                        id, patient_id, filename, mime_type, file_size,
                        report_data, extracted_text, structured_fields,
                        embedding_status, created_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'pending', %s)
                    """,
                    (
                        report_id,
                        patient_id,
                        filename,
                        mime_type,
                        len(report_data),
                        report_data,
                        extracted_text,
                        json.dumps(structured_fields, ensure_ascii=False),
                        created_at,
                    ),
                )
            connection.commit()
    except (pymysql.MySQLError, ReportDatabaseError) as exc:
        if isinstance(exc, ReportDatabaseError):
            raise
        raise _database_error(exc) from exc
    return {
        "id": report_id,
        "patient_id": patient_id,
        "filename": filename,
        "mime_type": mime_type,
        "file_size": len(report_data),
        "char_count": len(extracted_text),
        "chunk_count": 0,
        "embedding_status": "pending",
        "created_at": created_at.replace(tzinfo=timezone.utc).isoformat(),
    }


def store_embeddings(
    report_id: str,
    patient_id: str,
    chunks: Sequence[str],
    embeddings: Sequence[Sequence[float]],
    embedding_model: str = EMBEDDING_MODEL_NAME,
) -> int:
    if not chunks or len(chunks) != len(embeddings):
        raise ValueError("Report chunks and embeddings must both be present and have matching lengths.")
    try:
        _ensure_schema()
        with _connection() as connection:
            with connection.cursor() as cursor:
                cursor.executemany(
                    """
                    INSERT INTO medical_report_chunks (
                        report_id, patient_id, chunk_index, content, embedding_json,
                        embedding_model, created_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, UTC_TIMESTAMP(6))
                    """,
                    [
                        (
                            report_id,
                            patient_id,
                            index,
                            chunk,
                            json.dumps(list(embedding)),
                            embedding_model,
                        )
                        for index, (chunk, embedding) in enumerate(zip(chunks, embeddings))
                    ],
                )
                cursor.execute(
                    """
                    UPDATE medical_reports
                    SET embedding_status = 'ready', embedding_model = %s, chunk_count = %s
                    WHERE id = %s AND patient_id = %s
                    """,
                    (embedding_model, len(chunks), report_id, patient_id),
                )
                if cursor.rowcount != 1:
                    raise ReportDatabaseError("The report record was not found for embedding storage.")
            connection.commit()
    except (pymysql.MySQLError, ReportDatabaseError) as exc:
        if isinstance(exc, ReportDatabaseError):
            raise
        raise _database_error(exc) from exc
    return len(chunks)


def mark_embedding_status(report_id: str, status: str) -> None:
    if status not in {"unavailable", "failed"}:
        raise ValueError("Unsupported embedding status.")
    try:
        _ensure_schema()
        with _connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "UPDATE medical_reports SET embedding_status = %s WHERE id = %s",
                    (status, report_id),
                )
            connection.commit()
    except (pymysql.MySQLError, ReportDatabaseError) as exc:
        if isinstance(exc, ReportDatabaseError):
            raise
        raise _database_error(exc) from exc


def list_reports(patient_id: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
    safe_limit = min(max(int(limit), 1), 500)
    try:
        _ensure_schema()
        with _connection() as connection:
            with connection.cursor() as cursor:
                if patient_id:
                    cursor.execute(
                        """
                        SELECT id, patient_id, filename, mime_type, file_size,
                               CHAR_LENGTH(extracted_text) AS char_count,
                               chunk_count, embedding_status, embedding_model, created_at
                        FROM medical_reports
                        WHERE patient_id = %s
                        ORDER BY created_at DESC
                        LIMIT %s
                        """,
                        (patient_id, safe_limit),
                    )
                else:
                    cursor.execute(
                        """
                        SELECT id, patient_id, filename, mime_type, file_size,
                               CHAR_LENGTH(extracted_text) AS char_count,
                               chunk_count, embedding_status, embedding_model, created_at
                        FROM medical_reports
                        ORDER BY created_at DESC
                        LIMIT %s
                        """,
                        (safe_limit,),
                    )
                rows = cursor.fetchall()
    except (pymysql.MySQLError, ReportDatabaseError) as exc:
        if isinstance(exc, ReportDatabaseError):
            raise
        raise _database_error(exc) from exc

    for row in rows:
        created_at = row["created_at"]
        row["created_at"] = created_at.replace(tzinfo=timezone.utc).isoformat() if created_at else None
    return rows


def get_report_dashboard_summary() -> dict[str, Any]:
    try:
        _ensure_schema()
        with _connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT COUNT(*) AS total_count,
                           COALESCE(SUM(embedding_status = 'ready'), 0) AS embedding_ready,
                           COALESCE(SUM(embedding_status = 'failed'), 0) AS embedding_failed,
                           COALESCE(SUM(embedding_status NOT IN ('ready', 'failed')), 0) AS embedding_pending,
                           MAX(created_at) AS latest_created_at
                    FROM medical_reports
                    """
                )
                row = cursor.fetchone()
    except (pymysql.MySQLError, ReportDatabaseError) as exc:
        if isinstance(exc, ReportDatabaseError):
            raise
        raise _database_error(exc) from exc

    if row is None:
        raise ReportDatabaseError("The report summary query returned no result.")
    latest_created_at = row["latest_created_at"]
    return {
        "count": int(row["total_count"]),
        "embedding_ready": int(row["embedding_ready"]),
        "embedding_failed": int(row["embedding_failed"]),
        "embedding_pending": int(row["embedding_pending"]),
        "latest_created_at": (
            latest_created_at.replace(tzinfo=timezone.utc).isoformat()
            if latest_created_at
            else None
        ),
    }


def retrieve_relevant_chunks(
    *,
    patient_id: str,
    query_embedding: Sequence[float],
    embedding_model: str = EMBEDDING_MODEL_NAME,
    limit: int = 8,
) -> list[dict[str, Any]]:
    query_norm = math.sqrt(sum(value * value for value in query_embedding))
    if not query_norm:
        raise ValueError("The query embedding is empty.")
    try:
        _ensure_schema()
        with _connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT c.content, c.embedding_json, c.embedding_model,
                           c.chunk_index, r.filename, r.id AS report_id
                    FROM medical_report_chunks AS c
                    JOIN medical_reports AS r ON r.id = c.report_id
                    WHERE c.patient_id = %s AND c.embedding_model = %s
                    """,
                    (patient_id, embedding_model),
                )
                rows = cursor.fetchall()
    except (pymysql.MySQLError, ReportDatabaseError) as exc:
        if isinstance(exc, ReportDatabaseError):
            raise
        raise _database_error(exc) from exc

    scored: list[dict[str, Any]] = []
    for row in rows:
        vector = json.loads(row["embedding_json"])
        if len(vector) != len(query_embedding):
            continue
        vector_norm = math.sqrt(sum(value * value for value in vector))
        if not vector_norm:
            continue
        similarity = sum(left * right for left, right in zip(query_embedding, vector)) / (
            query_norm * vector_norm
        )
        scored.append(
            {
                "content": row["content"],
                "filename": row["filename"],
                "chunk_index": row["chunk_index"],
                "report_id": row["report_id"],
                "similarity": similarity,
            }
        )
    scored.sort(key=lambda result: float(result["similarity"]), reverse=True)
    return scored[:limit]
