"""AssemblyAI transcription + speaker diarization, normalized to Ripple speakers/segments.

AssemblyAI labels speakers A, B, C...; we rename them SPEAKER_01, SPEAKER_02... in order of first
appearance. These labels are anonymous and say nothing about who the person is.
"""

from __future__ import annotations

import asyncio
import logging
import time
from pathlib import Path

import httpx

from . import errors
from .config import Settings
from .schemas import Segment, Speaker

log = logging.getLogger("voice.transcription")

BASE_URL = "https://api.assemblyai.com"


def build_transcript_request(audio_url: str, settings: Settings) -> dict:
    """Body for POST /v2/transcript.

    AssemblyAI does not accept language_code together with language_detection:
    - ASSEMBLYAI_LANGUAGE_CODE set   -> {"language_code": "<code>"}       (fixed language)
    - ASSEMBLYAI_LANGUAGE_CODE blank -> {"language_detection": true}      (automatic detection)
    """
    body: dict = {"audio_url": audio_url, "speaker_labels": True}
    if settings.assemblyai_language_code:
        body["language_code"] = settings.assemblyai_language_code
    else:
        body["language_detection"] = True
    if settings.assemblyai_speakers_expected:
        body["speakers_expected"] = settings.assemblyai_speakers_expected
    return body


async def transcribe(client: httpx.AsyncClient, settings: Settings, audio_path: Path) -> dict:
    """Upload audio, request a diarized transcript, poll until done. Returns the raw transcript JSON."""
    if not settings.assemblyai_api_key:
        raise errors.not_configured("ASSEMBLYAI_API_KEY")
    headers = {"authorization": settings.assemblyai_api_key}

    with audio_path.open("rb") as fh:
        upload = await _call(client, "POST", f"{BASE_URL}/v2/upload", headers=headers, content=fh.read())
    upload_url = upload.get("upload_url")
    if not upload_url:
        raise errors.provider_error("TRANSCRIPTION")

    body = build_transcript_request(upload_url, settings)
    job = await _call(client, "POST", f"{BASE_URL}/v2/transcript", headers=headers, json=body)
    job_id = job.get("id")
    if not job_id:
        raise errors.provider_error("TRANSCRIPTION")
    log.info("transcript submitted id=%s", job_id)

    deadline = time.monotonic() + settings.transcription_timeout_seconds
    while True:
        result = await _call(client, "GET", f"{BASE_URL}/v2/transcript/{job_id}", headers=headers)
        status = result.get("status")
        if status == "completed":
            log.info("transcript completed id=%s utterances=%d", job_id, len(result.get("utterances") or []))
            return result
        if status == "error":
            # Provider error text can echo request details; keep it out of the response and logs.
            log.warning("transcript failed id=%s", job_id)
            raise errors.unusable_audio()
        if time.monotonic() >= deadline:
            raise errors.provider_unavailable("TRANSCRIPTION")
        await asyncio.sleep(settings.transcription_poll_seconds)


async def _call(client: httpx.AsyncClient, method: str, url: str, **kwargs) -> dict:
    try:
        resp = await client.request(method, url, **kwargs)
    except (httpx.TimeoutException, httpx.TransportError):
        raise errors.provider_unavailable("TRANSCRIPTION") from None
    if resp.status_code == 429 or resp.status_code >= 500:
        raise errors.provider_unavailable("TRANSCRIPTION")
    if resp.status_code >= 400:
        log.warning("assemblyai %s %s -> %d", method, url.split("?")[0], resp.status_code)
        raise errors.provider_error("TRANSCRIPTION")
    try:
        return resp.json()
    except ValueError:
        raise errors.provider_error("TRANSCRIPTION") from None


def normalize(transcript: dict) -> tuple[list[Speaker], list[Segment]]:
    """Turn AssemblyAI utterances into ordered Ripple speakers and segments."""
    utterances = [
        u for u in (transcript.get("utterances") or [])
        if isinstance(u.get("text"), str) and u["text"].strip()
    ]
    utterances.sort(key=lambda u: (u.get("start") or 0))

    label_to_id: dict[str, str] = {}
    speakers: list[Speaker] = []
    segments: list[Segment] = []
    for index, u in enumerate(utterances, start=1):
        start = max(0, int(round(u.get("start") or 0)))
        end = max(start, int(round(u.get("end") or start)))
        label = u.get("speaker")
        speaker_id = None
        if label:
            if label not in label_to_id:
                label_to_id[label] = f"SPEAKER_{len(label_to_id) + 1:02d}"
                speakers.append(Speaker(speaker_id=label_to_id[label], first_seen_ms=start))
            speaker_id = label_to_id[label]
        segments.append(
            Segment(id=f"seg_{index:03d}", start_ms=start, end_ms=end, speaker_id=speaker_id, text=u["text"].strip())
        )
    return speakers, segments
