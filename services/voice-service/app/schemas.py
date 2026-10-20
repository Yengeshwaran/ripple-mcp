"""Response contract for POST /api/voice/analyze-meeting (agreed snake_case shape).

The same models validate our own responses and the test fixtures.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

SPEAKER_PATTERN = r"^SPEAKER_\d{2}$"
SEGMENT_PATTERN = r"^seg_\d{3,}$"
CANDIDATE_PATTERN = r"^candidate_\d{3,}$"


def is_iso_with_offset(value: str) -> bool:
    """True for ISO 8601 date-times that carry a timezone (Z or +hh:mm)."""
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return parsed.tzinfo is not None and "T" in value


class Speaker(BaseModel):
    model_config = ConfigDict(extra="forbid")
    speaker_id: str = Field(pattern=SPEAKER_PATTERN)
    first_seen_ms: int | None = Field(default=None, ge=0)


class Segment(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=SEGMENT_PATTERN)
    start_ms: int = Field(ge=0)
    end_ms: int = Field(ge=0)
    speaker_id: str | None = Field(default=None, pattern=SPEAKER_PATTERN)
    text: str = Field(min_length=1)

    @model_validator(mode="after")
    def _end_after_start(self) -> "Segment":
        if self.end_ms < self.start_ms:
            raise ValueError("end_ms must be >= start_ms")
        return self


class CandidateTask(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=CANDIDATE_PATTERN)
    title: str = Field(min_length=1, max_length=200)
    description: str | None = None
    owner_speaker_id: str | None = Field(default=None, pattern=SPEAKER_PATTERN)
    deadline_text: str | None = None
    deadline_iso: str | None = None
    evidence_segment_ids: list[str] = Field(min_length=1)
    # Optional in the contract. Accepted when validating fixtures, never emitted: LLM self-scores are not calibrated.
    confidence: float | None = Field(default=None, ge=0, le=1, exclude=True)
    needs_review: bool = True

    @field_validator("deadline_iso")
    @classmethod
    def _iso(cls, value: str | None) -> str | None:
        if value is not None and not is_iso_with_offset(value):
            raise ValueError("deadline_iso must be ISO 8601 with a timezone offset, or null")
        return value

    @model_validator(mode="after")
    def _rules(self) -> "CandidateTask":
        if not self.needs_review:
            raise ValueError("needs_review must be true for new candidates")
        if self.deadline_iso is not None and self.deadline_text is None:
            raise ValueError("deadline_iso requires the spoken deadline_text it came from")
        return self


class MeetingAnalysis(BaseModel):
    model_config = ConfigDict(extra="forbid")
    meeting_id: str = Field(min_length=1)
    speakers: list[Speaker]
    segments: list[Segment]
    candidate_tasks: list[CandidateTask]

    @model_validator(mode="after")
    def _references(self) -> "MeetingAnalysis":
        speaker_ids = {s.speaker_id for s in self.speakers}
        segment_ids = [s.id for s in self.segments]
        if len(set(segment_ids)) != len(segment_ids):
            raise ValueError("segment ids must be unique")
        for seg in self.segments:
            if seg.speaker_id is not None and seg.speaker_id not in speaker_ids:
                raise ValueError(f"{seg.id} references unknown speaker {seg.speaker_id}")
        known = set(segment_ids)
        for cand in self.candidate_tasks:
            if cand.owner_speaker_id is not None and cand.owner_speaker_id not in speaker_ids:
                raise ValueError(f"{cand.id} owner {cand.owner_speaker_id} is not a known speaker")
            missing = [sid for sid in cand.evidence_segment_ids if sid not in known]
            if missing:
                raise ValueError(f"{cand.id} cites unknown segments {missing}")
        return self


# ---- What we ask the LLM to return (strict JSON schema, then re-validated server-side) ----

EXTRACTION_JSON_SCHEMA: dict = {
    "type": "object",
    "additionalProperties": False,
    "required": ["candidate_tasks"],
    "properties": {
        "candidate_tasks": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "title",
                    "description",
                    "owner_speaker_id",
                    "deadline_text",
                    "deadline_iso",
                    "evidence_segment_ids",
                ],
                "properties": {
                    "title": {"type": "string"},
                    "description": {"type": ["string", "null"]},
                    "owner_speaker_id": {"type": ["string", "null"]},
                    "deadline_text": {"type": ["string", "null"]},
                    "deadline_iso": {"type": ["string", "null"]},
                    "evidence_segment_ids": {"type": "array", "items": {"type": "string"}},
                },
            },
        }
    },
}


class RawCandidate(BaseModel):
    """Shape of one LLM-proposed task before server-side checks."""

    model_config = ConfigDict(extra="ignore")
    title: str
    description: str | None = None
    owner_speaker_id: str | None = None
    deadline_text: str | None = None
    deadline_iso: str | None = None
    evidence_segment_ids: list[str] = Field(default_factory=list)


class RawExtraction(BaseModel):
    model_config = ConfigDict(extra="ignore")
    candidate_tasks: list[RawCandidate]
