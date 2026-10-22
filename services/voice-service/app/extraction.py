"""Task-candidate extraction with an OpenRouter LLM, then strict server-side checks.

The model only sees transcript text with segment IDs, timestamps and anonymous speaker labels.
Whatever it returns is re-validated here; nothing is saved anywhere.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import httpx
from pydantic import ValidationError

from . import errors
from .config import Settings
from .schemas import (
    EXTRACTION_JSON_SCHEMA,
    CandidateTask,
    RawExtraction,
    Segment,
    Speaker,
    is_iso_with_offset,
)

log = logging.getLogger("voice.extraction")

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
MAX_ATTEMPTS = 2  # one retry if the model returns malformed JSON

SYSTEM_PROMPT = """You extract action items from a meeting transcript.

Rules:
- Return only concrete action items someone committed to or was clearly asked to do. No summaries.
- A suggestion or idea ("maybe we could...", "not sure yet") is NOT a task. Leave it out.
- title: short and imperative, e.g. "Send the deck".
- description: one plain sentence, or null.
- owner_speaker_id: the SPEAKER_xx label only when the transcript explicitly shows who will do it
  (e.g. that speaker says "I'll..."). Otherwise null. Never guess. Never use a person's name.
- deadline_text: the deadline words exactly as spoken, e.g. "by Friday". null if none was said.
- deadline_iso: an ISO 8601 date-time WITH timezone offset ONLY if the deadline is unambiguous using
  the meeting date and timezone given below. If either is unknown, or the deadline is vague
  ("next week", "soon"), use null. Never invent a date or time.
- evidence_segment_ids: the segment id(s) where the task was said. Use only ids from the transcript.
- Do not invent tasks, owners, deadlines or decisions that are not in the transcript.
Return JSON that matches the provided schema."""


WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
CALENDAR_DAYS = 14


def _date_context(meeting_date: str | None, timezone: str | None) -> list[str]:
    """Spell out weekdays and dates so the model does not have to do calendar arithmetic."""
    if not (meeting_date and timezone):
        return [f"Meeting date: {meeting_date or 'unknown'}", f"Timezone: {timezone or 'unknown'}"]
    day = date.fromisoformat(meeting_date)
    zone = ZoneInfo(timezone)

    def offset(d: date) -> str:
        raw = datetime(d.year, d.month, d.day, 12, tzinfo=zone).strftime("%z")
        return f"UTC{raw[:3]}:{raw[3:]}"

    lines = [
        f"Meeting date: {WEEKDAYS[day.weekday()].title()} {day.isoformat()} ({offset(day)})",
        f"Timezone: {timezone}",
        f"Calendar for the next {CALENDAR_DAYS} days. Use it to resolve weekday names ('Thursday' means the next",
        "Thursday after the meeting date) and use the offset shown for that day in deadline_iso:",
    ]
    for i in range(1, CALENDAR_DAYS + 1):
        d = day + timedelta(days=i)
        lines.append(f"  {WEEKDAYS[d.weekday()].title()} {d.isoformat()} ({offset(d)})" + ("  tomorrow" if i == 1 else ""))
    return lines


def _transcript_payload(segments: list[Segment], meeting_date: str | None, timezone: str | None) -> str:
    lines = _date_context(meeting_date, timezone) + [
        "",
        "Transcript (one segment per line: id | speaker | start_ms-end_ms | text):",
    ]
    for s in segments:
        lines.append(f"{s.id} | {s.speaker_id or 'UNKNOWN'} | {s.start_ms}-{s.end_ms} | {s.text}")
    return "\n".join(lines)


async def extract_candidates(
    client: httpx.AsyncClient,
    settings: Settings,
    speakers: list[Speaker],
    segments: list[Segment],
    meeting_date: str | None = None,
    timezone: str | None = None,
) -> list[CandidateTask]:
    if not segments:
        return []
    if not settings.openrouter_api_key:
        raise errors.not_configured("OPENROUTER_API_KEY")
    if not settings.openrouter_model:
        raise errors.not_configured("OPENROUTER_MODEL")

    body = {
        "model": settings.openrouter_model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": _transcript_payload(segments, meeting_date, timezone)},
        ],
        "response_format": {
            "type": "json_schema",
            "json_schema": {"name": "meeting_tasks", "strict": True, "schema": EXTRACTION_JSON_SCHEMA},
        },
        "provider": {"require_parameters": True},
    }
    headers = {
        "Authorization": f"Bearer {settings.openrouter_api_key}",
        "Content-Type": "application/json",
        "X-Title": "Ripple voice service",
    }

    for attempt in range(1, MAX_ATTEMPTS + 1):
        content = await _call(client, body, headers, settings.extraction_timeout_seconds)
        try:
            raw = RawExtraction.model_validate(json.loads(content))
        except (ValueError, ValidationError):
            log.warning("extraction output malformed (attempt %d/%d)", attempt, MAX_ATTEMPTS)
            continue
        return sanitize(raw, speakers, segments, meeting_date=meeting_date, timezone=timezone)
    raise errors.invalid_extraction()


async def _call(client: httpx.AsyncClient, body: dict, headers: dict, timeout: int) -> str:
    try:
        resp = await client.post(OPENROUTER_URL, json=body, headers=headers, timeout=timeout)
    except (httpx.TimeoutException, httpx.TransportError):
        raise errors.provider_unavailable("EXTRACTION") from None
    if resp.status_code == 429 or resp.status_code >= 500:
        raise errors.provider_unavailable("EXTRACTION")
    if resp.status_code >= 400:
        log.warning("openrouter -> %d", resp.status_code)
        raise errors.provider_error("EXTRACTION")
    try:
        data = resp.json()
        content = data["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError):
        raise errors.provider_error("EXTRACTION") from None
    if not isinstance(content, str):
        raise errors.provider_error("EXTRACTION")
    return content


def sanitize(
    raw: RawExtraction,
    speakers: list[Speaker],
    segments: list[Segment],
    meeting_date: str | None = None,
    timezone: str | None = None,
) -> list[CandidateTask]:
    """Apply the contract rules regardless of what the model returned.

    - evidence must point at real segments; a candidate with no valid evidence is dropped
    - owner must be a known speaker label, else null
    - deadline_iso only with a timezone offset, only when spoken deadline text exists,
      only when the request supplied meeting date + timezone, and only if it passes the
      calendar checks in deadline_is_consistent(); else null
    - needs_review is always true; confidence is not set (LLM self-scores are not calibrated)
    - ids are assigned here, in order
    """
    speaker_ids = {s.speaker_id for s in speakers}
    segment_ids = {s.id for s in segments}
    out: list[CandidateTask] = []
    dropped = 0
    for cand in raw.candidate_tasks:
        title = (cand.title or "").strip()
        evidence = [sid for sid in dict.fromkeys(cand.evidence_segment_ids) if sid in segment_ids]
        if not title or not evidence:
            dropped += 1
            continue
        deadline_text = (cand.deadline_text or "").strip() or None
        deadline_iso = (cand.deadline_iso or "").strip() or None
        if not deadline_is_consistent(deadline_text, deadline_iso, meeting_date, timezone):
            deadline_iso = None
        owner = cand.owner_speaker_id if cand.owner_speaker_id in speaker_ids else None
        description = (cand.description or "").strip() or None
        out.append(
            CandidateTask(
                id=f"candidate_{len(out) + 1:03d}",
                title=title[:200],
                description=description,
                owner_speaker_id=owner,
                deadline_text=deadline_text,
                deadline_iso=deadline_iso,
                evidence_segment_ids=evidence,
                needs_review=True,
            )
        )
    if dropped:
        log.info("dropped %d candidate(s) without valid evidence", dropped)
    return out


def deadline_is_consistent(
    deadline_text: str | None, deadline_iso: str | None, meeting_date: str | None, timezone: str | None
) -> bool:
    """Server-side checks on a model-resolved deadline. Any doubt -> False (the caller sets null).

    - needs spoken deadline text, a meeting date and a timezone
    - ISO 8601 with an offset that matches the meeting timezone at that moment
    - not before the meeting date, and within a year of it
    - a weekday named in the spoken text must match the resolved date's weekday
    - "today"/"tonight" must resolve to the meeting date, "tomorrow" to the next day
    """
    if not (deadline_text and deadline_iso and meeting_date and timezone):
        return False
    if not is_iso_with_offset(deadline_iso):
        return False
    try:
        parsed = datetime.fromisoformat(deadline_iso.replace("Z", "+00:00"))
        zone = ZoneInfo(timezone)
        meeting = date.fromisoformat(meeting_date)
    except (ValueError, KeyError):
        return False
    local = parsed.astimezone(zone)
    if parsed.utcoffset() != local.utcoffset():
        return False  # offset does not belong to the meeting timezone
    resolved = local.date()
    if resolved < meeting or resolved > meeting + timedelta(days=366):
        return False
    text = deadline_text.lower()
    named = [i for i, name in enumerate(WEEKDAYS) if re.search(rf"\b{name}\b", text)]
    if len(named) > 1 or (named and resolved.weekday() != named[0]):
        return False
    if re.search(r"\b(today|tonight)\b", text) and resolved != meeting:
        return False
    if re.search(r"\btomorrow\b", text) and resolved != meeting + timedelta(days=1):
        return False
    return True
