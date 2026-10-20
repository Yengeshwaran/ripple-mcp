"""HTTP layer: POST /api/voice/analyze-meeting and GET /health.

This route only orchestrates: save upload -> transcribe -> extract -> validate -> respond.
It never writes tasks to SQLite and never calls MCP; the frontend saves approved tasks via MCP.

Run: uvicorn app.main:app --port 8002 --reload   (from services/voice-service)
"""

from __future__ import annotations

import logging
import re
import uuid
from collections.abc import AsyncIterator
from datetime import date
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx
from fastapi import Depends, FastAPI, File, Form, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from . import errors
from .audio import save_upload
from .config import Settings, get_settings
from .extraction import extract_candidates
from .schemas import MeetingAnalysis
from .transcription import normalize, transcribe

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("voice")

app = FastAPI(title="Ripple voice service", version="0.1.0")


async def get_http_client() -> AsyncIterator[httpx.AsyncClient]:
    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
        yield client


@app.exception_handler(errors.VoiceServiceError)
async def _voice_error(_: Request, exc: errors.VoiceServiceError) -> JSONResponse:
    return JSONResponse(status_code=exc.status, content=exc.body())


@app.exception_handler(RequestValidationError)
async def _bad_request(_: Request, exc: RequestValidationError) -> JSONResponse:
    missing_file = any(e.get("loc", [None])[-1] == "file" for e in exc.errors())
    err = errors.missing_file() if missing_file else errors.invalid_request("The request is not valid.")
    return JSONResponse(status_code=err.status, content=err.body())


@app.exception_handler(Exception)
async def _unexpected(_: Request, exc: Exception) -> JSONResponse:
    log.error("unexpected error: %s", type(exc).__name__)
    return JSONResponse(
        status_code=500,
        content={"error": {"code": "INTERNAL_ERROR", "message": "Something went wrong.", "retryable": True}},
    )


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


def _check_context(meeting_date: str | None, timezone: str | None) -> tuple[str | None, str | None]:
    meeting_date = (meeting_date or "").strip() or None
    timezone = (timezone or "").strip() or None
    if meeting_date:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", meeting_date):
            raise errors.invalid_request("meeting_date must look like 2026-10-19.")
        try:
            date.fromisoformat(meeting_date)
        except ValueError:
            raise errors.invalid_request("meeting_date is not a real date.") from None
    if timezone:
        try:
            ZoneInfo(timezone)
        except (ZoneInfoNotFoundError, ValueError):
            raise errors.invalid_request("timezone must be an IANA name such as America/Chicago.") from None
    return meeting_date, timezone


@app.post("/api/voice/analyze-meeting", response_model=MeetingAnalysis, response_model_exclude_none=False)
async def analyze_meeting(
    file: UploadFile = File(...),
    meeting_date: str | None = Form(default=None),
    timezone: str | None = Form(default=None),
    settings: Settings = Depends(get_settings),
    client: httpx.AsyncClient = Depends(get_http_client),
) -> MeetingAnalysis:
    meeting_date, timezone = _check_context(meeting_date, timezone)
    meeting_id = f"meeting_{uuid.uuid4().hex[:12]}"

    path, fmt = await save_upload(file, settings.max_upload_bytes)
    try:
        log.info("analyze %s format=%s", meeting_id, fmt)
        transcript = await transcribe(client, settings, path)
    finally:
        path.unlink(missing_ok=True)

    speakers, segments = normalize(transcript)
    if not segments:
        raise errors.no_speech()

    candidates = await extract_candidates(client, settings, speakers, segments, meeting_date, timezone)
    result = MeetingAnalysis(
        meeting_id=meeting_id, speakers=speakers, segments=segments, candidate_tasks=candidates
    )
    log.info(
        "analyze %s done speakers=%d segments=%d candidates=%d",
        meeting_id, len(speakers), len(segments), len(candidates),
    )
    return result
