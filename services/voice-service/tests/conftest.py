"""Shared test setup. No test here calls a real (paid) provider: all HTTP goes through httpx.MockTransport."""

from __future__ import annotations

import json
import sys
from dataclasses import replace
from pathlib import Path
from typing import Callable

import httpx
import pytest
from fastapi.testclient import TestClient

SERVICE_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SERVICE_ROOT))

from app import main  # noqa: E402
from app.config import get_settings  # noqa: E402

FIXTURES = Path(__file__).resolve().parent / "fixtures"

# Minimal byte headers that pass format sniffing (content after the header is irrelevant to mocked providers).
WAV_BYTES = b"RIFF\x24\x00\x00\x00WAVEfmt " + b"\x00" * 64
MP3_BYTES = b"ID3\x04\x00\x00\x00\x00\x00\x00" + b"\x00" * 64
M4A_BYTES = b"\x00\x00\x00\x20ftypM4A " + b"\x00" * 64
WEBM_BYTES = b"\x1a\x45\xdf\xa3" + b"\x00" * 64


def load_fixture(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def openrouter_reply(payload: dict | str) -> dict:
    content = payload if isinstance(payload, str) else json.dumps(payload)
    return {"choices": [{"message": {"role": "assistant", "content": content}}]}


class FakeProviders:
    """Scriptable stand-in for AssemblyAI + OpenRouter."""

    def __init__(self) -> None:
        self.transcript: dict = load_fixture("assemblyai_transcript.json")
        self.extraction_replies: list[httpx.Response | Exception] = []
        self.assemblyai_override: Callable[[httpx.Request], httpx.Response] | None = None
        self.requests: list[httpx.Request] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        url = str(request.url)
        if "openrouter.ai" in url:
            if not self.extraction_replies:
                raise AssertionError("unexpected OpenRouter call")
            reply = self.extraction_replies.pop(0)
            if isinstance(reply, Exception):
                raise reply
            return reply
        if "assemblyai.com" in url:
            if self.assemblyai_override:
                return self.assemblyai_override(request)
            if url.endswith("/v2/upload"):
                return httpx.Response(200, json={"upload_url": "https://cdn.example/upload/abc"})
            if url.endswith("/v2/transcript") and request.method == "POST":
                return httpx.Response(200, json={"id": "tx_123", "status": "queued"})
            if "/v2/transcript/tx_123" in url:
                return httpx.Response(200, json=self.transcript)
        raise AssertionError(f"unexpected request {request.method} {url}")


@pytest.fixture
def temp_upload_dir(tmp_path, monkeypatch) -> Path:
    d = tmp_path / "uploads"
    monkeypatch.setenv("VOICE_TEMP_DIR", str(d))
    return d


@pytest.fixture
def providers() -> FakeProviders:
    return FakeProviders()


@pytest.fixture
def settings():
    base = get_settings()
    return replace(
        base,
        max_upload_bytes=1024 * 1024,
        assemblyai_api_key="test-assemblyai-key",
        assemblyai_language_code=None,
        assemblyai_speakers_expected=None,
        transcription_timeout_seconds=5,
        transcription_poll_seconds=0,
        openrouter_api_key="test-openrouter-key",
        openrouter_model="test/model",
        extraction_timeout_seconds=5,
    )


@pytest.fixture
def client(providers, settings, temp_upload_dir):
    async def fake_http_client():
        async with httpx.AsyncClient(transport=httpx.MockTransport(providers.handler)) as c:
            yield c

    main.app.dependency_overrides[main.get_http_client] = fake_http_client
    main.app.dependency_overrides[main.get_settings] = lambda: settings
    with TestClient(main.app, raise_server_exceptions=False) as c:
        yield c
    main.app.dependency_overrides.clear()
