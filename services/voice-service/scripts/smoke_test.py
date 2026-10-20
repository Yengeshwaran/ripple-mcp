"""Optional LIVE smoke test: sends a real recording to the running voice service.

This calls AssemblyAI and OpenRouter (costs a little, needs keys in .env). Use only a short,
consented recording. Do not commit the recording or the output.

Usage (from services/voice-service, with the service running on port 8002):
    python scripts/smoke_test.py path/to/sample.m4a --meeting-date 2026-10-20 --timezone America/Chicago
    python scripts/smoke_test.py path/to/sample.m4a --out smoke-result.json   # save full JSON for review
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.schemas import MeetingAnalysis  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("audio", type=Path)
    parser.add_argument("--url", default="http://localhost:8002/api/voice/analyze-meeting")
    parser.add_argument("--meeting-date")
    parser.add_argument("--timezone")
    parser.add_argument("--out", type=Path, help="write the full JSON response here (do not commit it)")
    args = parser.parse_args()

    data = {k: v for k, v in {"meeting_date": args.meeting_date, "timezone": args.timezone}.items() if v}
    started = time.monotonic()
    with args.audio.open("rb") as fh:
        resp = httpx.post(args.url, files={"file": (args.audio.name, fh)}, data=data, timeout=300)
    elapsed = time.monotonic() - started

    print(f"HTTP {resp.status_code} in {elapsed:.1f}s")
    body = resp.json()
    if resp.status_code != 200:
        print(json.dumps(body, indent=2))
        return 1

    MeetingAnalysis.model_validate(body)
    print("Response matches the contract.")
    print(f"speakers={len(body['speakers'])} segments={len(body['segments'])} candidates={len(body['candidate_tasks'])}")
    for c in body["candidate_tasks"]:
        print(f"- {c['title']} | owner={c['owner_speaker_id']} | deadline_text={c['deadline_text']} | deadline_iso={c['deadline_iso']} | evidence={c['evidence_segment_ids']}")
    if args.out:
        args.out.write_text(json.dumps(body, indent=2), encoding="utf-8")
        print(f"Full response written to {args.out} (contains transcript text: keep it private).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
