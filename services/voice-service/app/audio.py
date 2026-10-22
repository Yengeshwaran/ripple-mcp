"""Upload checks and safe temporary storage.

- The upload is read in chunks and rejected as soon as it passes the size limit.
- The format is checked from the file's bytes, not trusted from its name or content type.
- Audio-only: MP4/M4A and WebM containers are opened (standard library only, no FFmpeg) and rejected
  if they contain a video track or no audio track. WAV and MP3 are audio-only by design.
- Duration: read from the container when it says (WAV, M4A, WebM with a Duration field) and checked
  before any provider call. MP3 and WebM without a Duration field are checked after transcription
  using the duration AssemblyAI reports (see main.py).
- The temp file gets a random name in a private folder; the user's filename is never used as a path.
"""

from __future__ import annotations

import os
import struct
import tempfile
import wave
from dataclasses import dataclass
from pathlib import Path

from fastapi import UploadFile

from . import errors

CHUNK = 1024 * 1024
TEMP_PREFIX = "ripple-voice-"
MAX_MOOV_BYTES = 32 * 1024 * 1024  # metadata box; real audio files are far smaller
WEBM_HEADER_BYTES = 4 * 1024 * 1024  # Info + Tracks sit before the first Cluster


@dataclass(frozen=True)
class AudioInfo:
    fmt: str
    duration_seconds: float | None  # None = container does not say; checked after transcription


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


async def save_upload(upload: UploadFile, max_bytes: int) -> tuple[Path, AudioInfo]:
    """Stream the upload to a random temp file and check it. Returns (path, info).

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
        return path, inspect_audio(path, fmt)
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def inspect_audio(path: Path, fmt: str) -> AudioInfo:
    if fmt == "wav":
        return AudioInfo(fmt, _wav_duration(path))
    if fmt == "m4a":
        has_audio, has_video, duration = _mp4_tracks(path)
    elif fmt == "webm":
        has_audio, has_video, duration = _webm_tracks(path)
    else:  # mp3: audio-only format; duration checked after transcription
        return AudioInfo(fmt, None)
    if has_video:
        raise errors.video_not_supported()
    if not has_audio:
        raise errors.unsupported_audio()
    return AudioInfo(fmt, duration)


# ---------------------------------------------------------------- WAV

def _wav_duration(path: Path) -> float | None:
    try:
        with wave.open(str(path), "rb") as w:
            rate = w.getframerate()
            return w.getnframes() / rate if rate else None
    except (wave.Error, EOFError, struct.error):
        # Non-PCM WAV (e.g. compressed) is still audio; let the provider decide and report its duration.
        return None


# ---------------------------------------------------------------- MP4 / M4A

def _mp4_tracks(path: Path) -> tuple[bool, bool, float | None]:
    """Find the moov box and report (has_audio, has_video, duration_seconds)."""
    moov = _find_top_level_box(path, b"moov")
    if moov is None:
        raise errors.unsupported_audio()
    handlers: list[bytes] = []
    duration: float | None = None
    for box_type, payload in _iter_boxes(moov):
        if box_type == b"mvhd":
            duration = _mvhd_duration(payload)
        elif box_type == b"trak":
            for t_type, t_payload in _iter_boxes(payload):
                if t_type == b"mdia":
                    for m_type, m_payload in _iter_boxes(t_payload):
                        if m_type == b"hdlr" and len(m_payload) >= 12:
                            handlers.append(m_payload[8:12])
    return b"soun" in handlers, b"vide" in handlers, duration


def _find_top_level_box(path: Path, wanted: bytes) -> bytes | None:
    file_size = path.stat().st_size
    with path.open("rb") as fh:
        pos = 0
        while pos + 8 <= file_size:
            fh.seek(pos)
            header = fh.read(8)
            size, box_type = struct.unpack(">I4s", header)
            header_len = 8
            if size == 1:
                large = fh.read(8)
                if len(large) < 8:
                    return None
                size = struct.unpack(">Q", large)[0]
                header_len = 16
            elif size == 0:
                size = file_size - pos
            if size < header_len:
                return None
            if box_type == wanted:
                if size - header_len > MAX_MOOV_BYTES:
                    return None
                return fh.read(size - header_len)
            pos += size
    return None


def _iter_boxes(data: bytes):
    pos = 0
    while pos + 8 <= len(data):
        size, box_type = struct.unpack(">I4s", data[pos : pos + 8])
        header_len = 8
        if size == 1:
            if pos + 16 > len(data):
                return
            size = struct.unpack(">Q", data[pos + 8 : pos + 16])[0]
            header_len = 16
        elif size == 0:
            size = len(data) - pos
        if size < header_len or pos + size > len(data):
            return
        yield box_type, data[pos + header_len : pos + size]
        pos += size


def _mvhd_duration(payload: bytes) -> float | None:
    try:
        version = payload[0]
        if version == 1:
            timescale, duration = struct.unpack(">IQ", payload[20:32])
        else:
            timescale, duration = struct.unpack(">II", payload[12:20])
    except (IndexError, struct.error):
        return None
    if not timescale or duration in (0, 0xFFFFFFFF, 0xFFFFFFFFFFFFFFFF):
        return None
    return duration / timescale


# ---------------------------------------------------------------- WebM / Matroska (EBML)

EBML_HEADER = 0x1A45DFA3
SEGMENT = 0x18538067
INFO = 0x1549A966
TIMECODE_SCALE = 0x2AD7B1
DURATION = 0x4489
TRACKS = 0x1654AE6B
TRACK_ENTRY = 0xAE
TRACK_TYPE = 0x83
CLUSTER = 0x1F43B675
TRACK_VIDEO, TRACK_AUDIO = 1, 2


def _read_vint(data: bytes, pos: int, keep_marker: bool) -> tuple[int, int, bool]:
    """Read an EBML variable-length integer. Returns (value, new_pos, is_unknown_size)."""
    if pos >= len(data):
        raise ValueError("truncated")
    first = data[pos]
    length = 1
    mask = 0x80
    while length <= 8 and not (first & mask):
        mask >>= 1
        length += 1
    if length > 8 or pos + length > len(data):
        raise ValueError("bad vint")
    value = first if keep_marker else first & (mask - 1)
    for b in data[pos + 1 : pos + length]:
        value = (value << 8) | b
    unknown = not keep_marker and value == (1 << (7 * length)) - 1
    return value, pos + length, unknown


def _iter_ebml(data: bytes, start: int, end: int):
    pos = start
    while pos < end:
        try:
            el_id, pos2, _ = _read_vint(data, pos, keep_marker=True)
            size, pos3, unknown = _read_vint(data, pos2, keep_marker=False)
        except ValueError:
            return
        body_end = end if unknown else min(end, pos3 + size)
        yield el_id, pos3, body_end
        if unknown:
            return
        pos = pos3 + size


def _webm_tracks(path: Path) -> tuple[bool, bool, float | None]:
    with path.open("rb") as fh:
        data = fh.read(WEBM_HEADER_BYTES)
    track_types: list[int] = []
    found_tracks = False
    timecode_scale = 1_000_000  # default: 1 ms
    raw_duration: float | None = None
    for el_id, body, body_end in _iter_ebml(data, 0, len(data)):
        if el_id != SEGMENT:
            continue
        for child, c_body, c_end in _iter_ebml(data, body, body_end):
            if child == INFO:
                for info_el, i_body, i_end in _iter_ebml(data, c_body, c_end):
                    raw = data[i_body:i_end]
                    if info_el == TIMECODE_SCALE and raw:
                        timecode_scale = int.from_bytes(raw, "big") or timecode_scale
                    elif info_el == DURATION and len(raw) in (4, 8):
                        raw_duration = struct.unpack(">f" if len(raw) == 4 else ">d", raw)[0]
            elif child == TRACKS:
                found_tracks = True
                for entry, e_body, e_end in _iter_ebml(data, c_body, c_end):
                    if entry != TRACK_ENTRY:
                        continue
                    for field, f_body, f_end in _iter_ebml(data, e_body, e_end):
                        if field == TRACK_TYPE:
                            track_types.append(int.from_bytes(data[f_body:f_end], "big"))
            elif child == CLUSTER:
                break
        break
    if not found_tracks:
        # Cannot confirm the file is audio-only.
        raise errors.unsupported_audio()
    duration = raw_duration * timecode_scale / 1e9 if raw_duration else None
    return TRACK_AUDIO in track_types, TRACK_VIDEO in track_types, duration
