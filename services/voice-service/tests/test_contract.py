"""The shared fixtures (used by the frontend) must match the response contract exactly."""

import pytest
from pydantic import ValidationError

from app.schemas import MeetingAnalysis
from conftest import load_fixture


@pytest.mark.parametrize("name", ["meeting_demo_001.json", "meeting_edge_cases.json"])
def test_fixtures_match_contract(name):
    MeetingAnalysis.model_validate(load_fixture(name))


def test_playbook_example_matches_contract():
    # Verbatim example from the team playbook (includes the optional confidence field).
    MeetingAnalysis.model_validate(
        {
            "meeting_id": "meeting_demo_001",
            "speakers": [
                {"speaker_id": "SPEAKER_01", "first_seen_ms": 0},
                {"speaker_id": "SPEAKER_02", "first_seen_ms": 4200},
            ],
            "segments": [
                {"id": "seg_001", "start_ms": 0, "end_ms": 2400, "speaker_id": "SPEAKER_01",
                 "text": "We need to prepare the demo by Friday."}
            ],
            "candidate_tasks": [
                {"id": "candidate_001", "title": "Prepare the demo", "description": "Prepare the demo for submission.",
                 "owner_speaker_id": "SPEAKER_01", "deadline_text": "by Friday", "deadline_iso": None,
                 "evidence_segment_ids": ["seg_001"], "confidence": 0.88, "needs_review": True}
            ],
        }
    )


def _base():
    return load_fixture("meeting_demo_001.json")


@pytest.mark.parametrize(
    "mutate, why",
    [
        (lambda d: d["candidate_tasks"][0].update(evidence_segment_ids=["seg_999"]), "unknown evidence"),
        (lambda d: d["candidate_tasks"][0].update(evidence_segment_ids=[]), "no evidence"),
        (lambda d: d["candidate_tasks"][0].update(owner_speaker_id="SPEAKER_09"), "unknown owner"),
        (lambda d: d["candidate_tasks"][0].update(needs_review=False), "not flagged for review"),
        (lambda d: d["candidate_tasks"][1].update(deadline_iso="2026-10-21T17:00:00"), "no timezone"),
        (lambda d: d["candidate_tasks"][1].update(deadline_text=None), "iso without spoken text"),
        (lambda d: d["segments"][0].update(end_ms=-1), "negative time"),
        (lambda d: d["segments"][1].update(start_ms=9999, end_ms=10), "end before start"),
        (lambda d: d["segments"][0].update(speaker_id="SPEAKER_09"), "unknown speaker"),
        (lambda d: d["segments"][1].update(id="seg_001"), "duplicate segment id"),
        (lambda d: d.update(extra_field=1), "unexpected field"),
    ],
)
def test_contract_rejects_bad_data(mutate, why):
    data = _base()
    mutate(data)
    with pytest.raises(ValidationError):
        MeetingAnalysis.model_validate(data)


def test_null_speaker_on_segment_is_allowed():
    data = _base()
    data["segments"][4]["speaker_id"] = None
    MeetingAnalysis.model_validate(data)
