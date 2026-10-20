"""Environment-based configuration. Keys stay server-side and are never logged."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

# Load services/voice-service/.env if present (does not override real environment variables).
load_dotenv(Path(__file__).resolve().parent.parent / ".env", override=False)


def _int(name: str, default: int | None) -> int | None:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be a whole number") from exc


@dataclass(frozen=True)
class Settings:
    max_upload_bytes: int
    assemblyai_api_key: str
    assemblyai_language_code: str | None
    assemblyai_speakers_expected: int | None
    transcription_timeout_seconds: int
    transcription_poll_seconds: float
    openrouter_api_key: str
    openrouter_model: str
    extraction_timeout_seconds: int


def get_settings() -> Settings:
    return Settings(
        max_upload_bytes=(_int("MAX_UPLOAD_MB", 25) or 25) * 1024 * 1024,
        assemblyai_api_key=os.getenv("ASSEMBLYAI_API_KEY", "").strip(),
        assemblyai_language_code=os.getenv("ASSEMBLYAI_LANGUAGE_CODE", "").strip() or None,
        assemblyai_speakers_expected=_int("ASSEMBLYAI_SPEAKERS_EXPECTED", None),
        transcription_timeout_seconds=_int("TRANSCRIPTION_TIMEOUT_SECONDS", 180) or 180,
        transcription_poll_seconds=float(os.getenv("TRANSCRIPTION_POLL_SECONDS", "3") or 3),
        openrouter_api_key=os.getenv("OPENROUTER_API_KEY", "").strip(),
        openrouter_model=os.getenv("OPENROUTER_MODEL", "").strip(),
        extraction_timeout_seconds=_int("EXTRACTION_TIMEOUT_SECONDS", 60) or 60,
    )
