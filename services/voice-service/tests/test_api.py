"""End-to-end tests of POST /api/voice/analyze-meeting with mocked AssemblyAI and OpenRouter."""

import json

import httpx
import pytest

from app.schemas import MeetingAnalysis
from conftest import M4A_BYTES, MP3_BYTES, WAV_BYTES, WEBM_BYTES, openrouter_reply

URL = "/api/voice/analyze-meeting"

GOOD_EXTRACTION = {
    "candidate_tasks": [
        {"title": "Prepare the demo", "description": None, "owner_speaker_id": None,
         "deadline_text": "by Friday", "deadline_iso": None, "evidence_segment_ids": ["seg_001"]},
        {"title": "Finish the dashboard filters", "description": "Finish the dashboard filters.",
         "owner_speaker_id": "SPEAKER_02", "deadline_text": "by 5 PM Central on October 21st",
         "deadline_iso": "2026-10-21T17:00:00-05:00", "evidence_segment_ids": ["seg_002"]},
        {"title": "Write the README setup section", "description": None, "owner_speaker_id": "SPEAKER_01",
         "deadline_text": None, "deadline_iso": None, "evidence_segment_ids": ["seg_003"]},
    ]
}


def upload(client, data=WAV_BYTES, name="meeting.wav", ctype="audio/wav", form=None):
    return client.post(URL, files={"file": (name, data, ctype)}, data=form or {})


def assert_error(resp, status, code, retryable=None):
    assert resp.status_code == status, resp.text
    body = resp.json()
    assert set(body) == {"error"}
    assert body["error"]["code"] == code
    assert isinstance(body["error"]["message"], str) and body["error"]["message"]
    if retryable is not None:
        assert body["error"]["retryable"] is retryable
    text = resp.text.lower()
    assert "test-assemblyai-key" not in text and "test-openrouter-key" not in text
    assert "traceback" not in text


# ---------- happy path ----------

def test_valid_audio_returns_contract_json(client, providers, temp_upload_dir):
    providers.extraction_replies = [httpx.Response(200, json=openrouter_reply(GOOD_EXTRACTION))]
    resp = upload(client, form={"meeting_date": "2026-10-19", "timezone": "America/Chicago"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    MeetingAnalysis.model_validate(body)  # exact contract, no extra fields
    assert set(body) == {"meeting_id", "speakers", "segments", "candidate_tasks"}
    assert body["meeting_id"].startswith("meeting_")

    assert [s["speaker_id"] for s in body["speakers"]] == ["SPEAKER_01", "SPEAKER_02"]
    assert body["speakers"][1]["first_seen_ms"] == 4200
    assert [s["id"] for s in body["segments"]] == ["seg_001", "seg_002", "seg_003", "seg_004"]
    starts = [s["start_ms"] for s in body["segments"]]
    assert starts == sorted(starts)
    for s in body["segments"]:
        assert isinstance(s["start_ms"], int) and s["start_ms"] >= 0 and s["end_ms"] >= s["start_ms"]

    cands = body["candidate_tasks"]
    assert [c["id"] for c in cands] == ["candidate_001", "candidate_002", "candidate_003"]
    assert all(c["needs_review"] is True for c in cands)
    assert all("confidence" not in c for c in cands)
    assert cands[1]["deadline_iso"] == "2026-10-21T17:00:00-05:00"
    assert cands[0]["owner_speaker_id"] is None and cands[0]["deadline_iso"] is None
    # optional fields are present as null, not missing
    assert "description" in cands[0] and cands[0]["description"] is None

    assert list(temp_upload_dir.iterdir()) == []  # temp audio cleaned up


@pytest.mark.parametrize(
    "data,name,ctype",
    [(MP3_BYTES, "a.mp3", "audio/mpeg"), (M4A_BYTES, "a.m4a", "audio/mp4"), (WEBM_BYTES, "a.webm", "audio/webm")],
)
def test_other_supported_formats(client, providers, data, name, ctype):
    providers.extraction_replies = [httpx.Response(200, json=openrouter_reply({"candidate_tasks": []}))]
    assert upload(client, data, name, ctype).status_code == 200


def test_llm_only_sees_text_not_audio(client, providers):
    providers.extraction_replies = [httpx.Response(200, json=openrouter_reply(GOOD_EXTRACTION))]
    upload(client)
    llm_calls = [r for r in providers.requests if "openrouter.ai" in str(r.url)]
    assert len(llm_calls) == 1
    sent = json.loads(llm_calls[0].content)
    assert sent["response_format"]["type"] == "json_schema"
    user_msg = sent["messages"][1]["content"]
    assert "seg_001 | SPEAKER_01 | 0-3900 |" in user_msg
    assert b"RIFF" not in llm_calls[0].content


# ---------- deadline / owner safety ----------

def test_deadline_iso_dropped_without_meeting_context(client, providers):
    providers.extraction_replies = [httpx.Response(200, json=openrouter_reply(GOOD_EXTRACTION))]
    body = upload(client).json()  # no meeting_date / timezone supplied
    assert all(c["deadline_iso"] is None for c in body["candidate_tasks"])
    assert body["candidate_tasks"][1]["deadline_text"] == "by 5 PM Central on October 21st"


def test_model_guesses_are_cleaned(client, providers):
    risky = {"candidate_tasks": [
        {"title": "  Ship it  ", "description": "", "owner_speaker_id": "SPEAKER_07",
         "deadline_text": None, "deadline_iso": "2026-10-23T12:00:00-07:00", "evidence_segment_ids": ["seg_002", "seg_002"]},
        {"title": "Invented task", "description": None, "owner_speaker_id": None,
         "deadline_text": None, "deadline_iso": None, "evidence_segment_ids": ["seg_042"]},
        {"title": "Bad date", "description": None, "owner_speaker_id": "SPEAKER_01",
         "deadline_text": "Friday", "deadline_iso": "Friday", "evidence_segment_ids": ["seg_001"]},
    ]}
    providers.extraction_replies = [httpx.Response(200, json=openrouter_reply(risky))]
    body = upload(client, form={"meeting_date": "2026-10-19", "timezone": "America/Chicago"}).json()
    cands = body["candidate_tasks"]
    assert len(cands) == 2  # task citing a non-existent segment is dropped
    first, second = cands
    assert first["title"] == "Ship it"
    assert first["owner_speaker_id"] is None  # unknown speaker -> null
    assert first["deadline_iso"] is None  # no spoken deadline -> no date
    assert first["description"] is None
    assert first["evidence_segment_ids"] == ["seg_002"]
    assert second["deadline_iso"] is None  # not a valid ISO timestamp
    MeetingAnalysis.model_validate(body)


def test_no_tasks_is_a_valid_result(client, providers):
    providers.extraction_replies = [httpx.Response(200, json=openrouter_reply({"candidate_tasks": []}))]
    resp = upload(client)
    assert resp.status_code == 200
    assert resp.json()["candidate_tasks"] == []


# ---------- bad uploads ----------

def test_missing_file(client):
    assert_error(client.post(URL, data={}), 400, "MISSING_FILE", retryable=False)


def test_empty_file(client, temp_upload_dir):
    assert_error(upload(client, b""), 400, "EMPTY_FILE")
    assert list(temp_upload_dir.iterdir()) == []


def test_unsupported_type(client, providers, temp_upload_dir):
    resp = upload(client, b"%PDF-1.7 not audio" + b"\x00" * 32, "notes.mp3", "audio/mpeg")
    assert_error(resp, 415, "UNSUPPORTED_AUDIO_TYPE", retryable=False)
    assert providers.requests == []  # nothing sent to providers
    assert list(temp_upload_dir.iterdir()) == []


def test_oversized_file(client, settings, providers, temp_upload_dir):
    big = WAV_BYTES + b"\x00" * settings.max_upload_bytes
    assert_error(upload(client, big), 413, "FILE_TOO_LARGE", retryable=False)
    assert providers.requests == []
    assert list(temp_upload_dir.iterdir()) == []


@pytest.mark.parametrize("form", [{"meeting_date": "19/10/2026"}, {"meeting_date": "2026-02-30"}, {"timezone": "Mars/Base"}])
def test_bad_meeting_context(client, form):
    assert_error(upload(client, form=form), 400, "INVALID_REQUEST")


# ---------- provider failures ----------

def test_transcription_rate_limited(client, providers, temp_upload_dir):
    providers.assemblyai_override = lambda r: httpx.Response(429, json={"error": "secret detail"})
    resp = upload(client)
    assert_error(resp, 503, "TRANSCRIPTION_PROVIDER_UNAVAILABLE", retryable=True)
    assert "secret detail" not in resp.text
    assert list(temp_upload_dir.iterdir()) == []


def test_transcription_auth_error_not_leaked(client, providers):
    providers.assemblyai_override = lambda r: httpx.Response(401, json={"error": "Invalid API key test-assemblyai-key"})
    assert_error(upload(client), 502, "TRANSCRIPTION_PROVIDER_ERROR")


def test_transcription_network_timeout(client, providers, temp_upload_dir):
    def boom(request):
        raise httpx.ReadTimeout("timed out", request=request)
    providers.assemblyai_override = boom
    assert_error(upload(client), 503, "TRANSCRIPTION_PROVIDER_UNAVAILABLE", retryable=True)
    assert list(temp_upload_dir.iterdir()) == []


def test_transcript_job_error(client, providers):
    providers.transcript = {"id": "tx_123", "status": "error", "error": "file does not appear to contain audio"}
    assert_error(upload(client), 422, "UNUSABLE_AUDIO")


def test_transcript_never_finishes(client, providers, settings):
    providers.transcript = {"id": "tx_123", "status": "processing"}
    settings_timeout = settings.transcription_timeout_seconds
    assert settings_timeout <= 5
    # poll interval is 0 in tests; timeout is enforced by elapsed time
    import app.transcription as t
    original = t.time.monotonic
    ticks = iter(range(0, 10_000, 10))
    t.time.monotonic = lambda: next(ticks)
    try:
        assert_error(upload(client), 503, "TRANSCRIPTION_PROVIDER_UNAVAILABLE")
    finally:
        t.time.monotonic = original


def test_no_speech(client, providers):
    providers.transcript = {"id": "tx_123", "status": "completed", "utterances": []}
    assert_error(upload(client), 422, "NO_SPEECH_DETECTED")
    assert not any("openrouter.ai" in str(r.url) for r in providers.requests)


def test_extraction_rate_limited(client, providers):
    providers.extraction_replies = [httpx.Response(429, json={"error": {"message": "rate limited"}})]
    assert_error(upload(client), 503, "EXTRACTION_PROVIDER_UNAVAILABLE", retryable=True)


def test_extraction_timeout(client, providers):
    providers.extraction_replies = [httpx.ReadTimeout("slow")]
    assert_error(upload(client), 503, "EXTRACTION_PROVIDER_UNAVAILABLE", retryable=True)


def test_malformed_ai_output_is_retried_once_then_rejected(client, providers):
    providers.extraction_replies = [
        httpx.Response(200, json=openrouter_reply("not json at all")),
        httpx.Response(200, json=openrouter_reply({"tasks": "wrong shape"})),
    ]
    assert_error(upload(client), 422, "INVALID_EXTRACTION_OUTPUT", retryable=True)
    assert providers.extraction_replies == []  # exactly two attempts


def test_malformed_then_valid_succeeds(client, providers):
    providers.extraction_replies = [
        httpx.Response(200, json=openrouter_reply("{oops")),
        httpx.Response(200, json=openrouter_reply(GOOD_EXTRACTION)),
    ]
    resp = upload(client)
    assert resp.status_code == 200
    assert len(resp.json()["candidate_tasks"]) == 3


def test_missing_keys_reported_clearly(client, providers, settings):
    from dataclasses import replace
    from app import main
    main.app.dependency_overrides[main.get_settings] = lambda: replace(settings, assemblyai_api_key="")
    assert_error(upload(client), 503, "SERVICE_NOT_CONFIGURED")
    assert providers.requests == []


def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}
