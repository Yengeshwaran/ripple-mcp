"""Regression tests for PR #9 review: language detection, audio-only validation, duration policy."""

import json
from dataclasses import replace

import httpx
import pytest

from app import main
from app.audio import inspect_audio, sniff_audio_format
from app.errors import VoiceServiceError
from app.transcription import build_transcript_request
from conftest import MP3_BYTES, openrouter_reply
from media_builders import mp4_bytes, wav_bytes, webm_bytes

URL = "/api/voice/analyze-meeting"
NO_TASKS = {"candidate_tasks": []}


def post(client, data, name, ctype="application/octet-stream"):
    return client.post(URL, files={"file": (name, data, ctype)})


def transcript_request_body(providers) -> dict:
    [req] = [r for r in providers.requests if r.method == "POST" and str(r.url).endswith("/v2/transcript")]
    return json.loads(req.content)


def use_settings(settings, **changes):
    main.app.dependency_overrides[main.get_settings] = lambda: replace(settings, **changes)


# ---------------------------------------------------------------- 1. language detection

def test_blank_language_code_enables_automatic_detection(settings):
    body = build_transcript_request("https://cdn.example/a", replace(settings, assemblyai_language_code=None))
    assert body["language_detection"] is True
    assert "language_code" not in body
    assert body["speaker_labels"] is True


def test_configured_language_code_is_used_without_detection(settings):
    body = build_transcript_request("https://cdn.example/a", replace(settings, assemblyai_language_code="en"))
    assert body["language_code"] == "en"
    assert "language_detection" not in body  # AssemblyAI rejects both together


def test_api_sends_language_detection_when_blank(client, providers):
    providers.extraction_replies = [httpx.Response(200, json=openrouter_reply(NO_TASKS))]
    assert post(client, wav_bytes(1), "a.wav").status_code == 200
    body = transcript_request_body(providers)
    assert body["language_detection"] is True and "language_code" not in body


def test_api_sends_language_code_when_configured(client, providers, settings):
    use_settings(settings, assemblyai_language_code="ta")
    providers.extraction_replies = [httpx.Response(200, json=openrouter_reply(NO_TASKS))]
    assert post(client, wav_bytes(1), "a.wav").status_code == 200
    body = transcript_request_body(providers)
    assert body["language_code"] == "ta" and "language_detection" not in body


def test_speakers_expected_passed_through(settings):
    body = build_transcript_request("u", replace(settings, assemblyai_speakers_expected=2))
    assert body["speakers_expected"] == 2


def test_env_blank_language_code_reads_as_none(monkeypatch):
    from app.config import get_settings
    monkeypatch.setenv("ASSEMBLYAI_LANGUAGE_CODE", "   ")
    assert get_settings().assemblyai_language_code is None
    monkeypatch.setenv("ASSEMBLYAI_LANGUAGE_CODE", "en")
    assert get_settings().assemblyai_language_code == "en"


# ---------------------------------------------------------------- 2. audio-only validation

def _inspect(tmp_path, data: bytes):
    p = tmp_path / "f.bin"
    p.write_bytes(data)
    fmt = sniff_audio_format(data[:16])
    return inspect_audio(p, fmt)


@pytest.mark.parametrize(
    "data",
    [
        mp4_bytes([b"soun"]),
        mp4_bytes([b"soun"], moov_at_end=True),  # "fast start" off: moov after media data
        mp4_bytes([b"soun"], mvhd_version=1),
        mp4_bytes([b"soun"], brand=b"mp42"),  # generic MP4 brand but audio-only content
        webm_bytes([2]),
        webm_bytes([2], duration_ms=None),  # browser MediaRecorder output often has no Duration
    ],
)
def test_audio_only_containers_accepted(tmp_path, data):
    info = _inspect(tmp_path, data)
    assert info.fmt in {"m4a", "webm"}


@pytest.mark.parametrize(
    "data, expected_message_word",
    [
        (mp4_bytes([b"vide", b"soun"]), "video"),  # normal phone/screen video with sound
        (mp4_bytes([b"vide"]), "video"),
        (webm_bytes([1, 2]), "video"),
        (webm_bytes([1]), "video"),
        (mp4_bytes([]), "supported"),  # no audio track
        (mp4_bytes([b"soun"], include_moov=False), "supported"),  # unreadable container
        (webm_bytes([2], include_tracks=False), "supported"),  # cannot confirm audio-only
        (webm_bytes([]), "supported"),
    ],
)
def test_video_or_unverifiable_containers_rejected(tmp_path, data, expected_message_word):
    with pytest.raises(VoiceServiceError) as exc:
        _inspect(tmp_path, data)
    assert exc.value.status == 415
    assert exc.value.code == "UNSUPPORTED_AUDIO_TYPE"
    assert expected_message_word in exc.value.message.lower()


def test_video_upload_rejected_before_any_provider_call(client, providers, temp_upload_dir):
    resp = post(client, mp4_bytes([b"vide", b"soun"]), "meeting.mp4", "video/mp4")
    assert resp.status_code == 415
    assert resp.json()["error"]["code"] == "UNSUPPORTED_AUDIO_TYPE"
    assert "video" in resp.json()["error"]["message"].lower()
    assert providers.requests == []
    assert list(temp_upload_dir.iterdir()) == []


def test_renamed_video_still_rejected(client, providers):
    # A video saved with an audio extension and content type is judged by its bytes.
    resp = post(client, webm_bytes([1, 2]), "voice.m4a", "audio/mp4")
    assert resp.status_code == 415
    assert providers.requests == []


def test_container_durations_read_correctly(tmp_path):
    assert _inspect(tmp_path, mp4_bytes([b"soun"], duration_seconds=95)).duration_seconds == pytest.approx(95)
    assert _inspect(tmp_path, mp4_bytes([b"soun"], duration_seconds=95, mvhd_version=1)).duration_seconds == pytest.approx(95)
    assert _inspect(tmp_path, webm_bytes([2], duration_ms=95_500)).duration_seconds == pytest.approx(95.5)
    assert _inspect(tmp_path, webm_bytes([2], duration_ms=None)).duration_seconds is None
    assert _inspect(tmp_path, wav_bytes(3)).duration_seconds == pytest.approx(3)
    assert _inspect(tmp_path, MP3_BYTES).duration_seconds is None


# ---------------------------------------------------------------- 3. duration policy (default 180 s)

@pytest.mark.parametrize(
    "data, name",
    [
        (wav_bytes(200), "long.wav"),
        (mp4_bytes([b"soun"], duration_seconds=200), "long.m4a"),
        (webm_bytes([2], duration_ms=200_000), "long.webm"),
    ],
)
def test_long_recording_rejected_before_upload_to_provider(client, providers, temp_upload_dir, data, name):
    resp = post(client, data, name)
    assert resp.status_code == 413
    body = resp.json()
    assert body["error"]["code"] == "AUDIO_TOO_LONG" and body["error"]["retryable"] is False
    assert "3 minutes" in body["error"]["message"]
    assert providers.requests == []  # no AssemblyAI cost
    assert list(temp_upload_dir.iterdir()) == []


@pytest.mark.parametrize("data, name", [(MP3_BYTES, "long.mp3"), (webm_bytes([2], duration_ms=None), "rec.webm")])
def test_long_recording_without_container_duration_rejected_after_transcription(client, providers, temp_upload_dir, data, name):
    providers.transcript = {**providers.transcript, "audio_duration": 240}
    resp = post(client, data, name)
    assert resp.status_code == 413
    assert resp.json()["error"]["code"] == "AUDIO_TOO_LONG"
    assert not any("openrouter.ai" in str(r.url) for r in providers.requests)  # no LLM call, no suggestions
    assert list(temp_upload_dir.iterdir()) == []


@pytest.mark.parametrize("seconds", [179, 180, 180.6])
def test_recordings_at_or_just_under_limit_accepted(client, providers, seconds):
    providers.transcript = {**providers.transcript, "audio_duration": seconds}
    providers.extraction_replies = [httpx.Response(200, json=openrouter_reply(NO_TASKS))]
    assert post(client, mp4_bytes([b"soun"], duration_seconds=seconds), "ok.m4a").status_code == 200


def test_duration_limit_can_be_disabled(client, providers, settings):
    use_settings(settings, max_audio_seconds=0)
    providers.transcript = {**providers.transcript, "audio_duration": 900}
    providers.extraction_replies = [httpx.Response(200, json=openrouter_reply(NO_TASKS))]
    assert post(client, mp4_bytes([b"soun"], duration_seconds=900), "long.m4a").status_code == 200


def test_default_limits_from_environment(monkeypatch):
    from app.config import get_settings
    monkeypatch.delenv("MAX_UPLOAD_MB", raising=False)
    monkeypatch.delenv("MAX_AUDIO_SECONDS", raising=False)
    s = get_settings()
    assert s.max_upload_bytes == 25 * 1024 * 1024
    assert s.max_audio_seconds == 180
