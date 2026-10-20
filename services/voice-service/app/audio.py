"""Upload checks and safe temporary storage.

- The upload is read in chunks and rejected as soon as it passes the size limit.
- The format is checked from the file's first bytes, not trusted from its name or content type.
- The temp file gets a random name in a private folder; the user's filename is never used as a path.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

from fastapi import UploadFile

from . import errors

CHUNK = 1024 * 1024
TEMP_PREFIX = "ripple-voice-"


def sniff_audio_format(head: bytes) -> str | None:
    """Return 'wav', 'mp3', 'm4a' or 'webm' from magic bytes, else None."""
    if len(head) >= 12 and head[:4] == b"RIFF" and head[8:12] == b"WAVE":
        return "wav"
    if head[:3] == b"ID3" or (len(head) >= 2 and head[0] == 0xFF and (head[1] & 0xE0) == 0xE0):
        return "mp3"
    if len(head) >= 12 and head[4:8] == b"ftyp":
        return "m4a"
    if head[:4] == b"\x1a\x45\xdf\xa3":
        return "webm"
    return None


def temp_dir() -> Path:
    """Private folder for in-flight uploads (overridable in tests)."""
    path = Path(os.getenv("VOICE_TEMP_DIR") or Path(tempfile.gettempdir()) / "ripple-voice")
    path.mkdir(parents=True, exist_ok=True)
    return path


async def save_upload(upload: UploadFile, max_bytes: int) -> tuple[Path, str]:
    """Stream the upload to a random temp file. Returns (path, detected_format).

    The caller must delete the path in a finally block.
    """
    fd, name = tempfile.mkstemp(prefix=TEMP_PREFIX, suffix=".upload", dir=temp_dir())
    path = Path(name)
    size = 0
    head = b""
    try:
        with os.fdopen(fd, "wb") as out:
            while True:
                chunk = await upload.read(CHUNK)
                if not chunk:
                    break
                size += len(chunk)
                if size > max_bytes:
                    raise errors.file_too_large(max_bytes // (1024 * 1024))
                if len(head) < 16:
                    head += chunk[: 16 - len(head)]
                out.write(chunk)
        if size == 0:
            raise errors.empty_file()
        fmt = sniff_audio_format(head)
        if fmt is None:
            raise errors.unsupported_audio()
        return path, fmt
    except BaseException:
        path.unlink(missing_ok=True)
        raise
