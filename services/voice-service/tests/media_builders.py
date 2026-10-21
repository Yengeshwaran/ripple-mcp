"""Build tiny, structurally valid media files for tests (no real audio content, no recordings committed)."""

from __future__ import annotations

import io
import struct
import wave


def wav_bytes(seconds: float, rate: int = 1000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(1)
        w.setframerate(rate)
        w.writeframes(b"\x80" * int(seconds * rate))
    return buf.getvalue()


# ---------------- MP4 / M4A

def _box(box_type: bytes, payload: bytes) -> bytes:
    return struct.pack(">I4s", 8 + len(payload), box_type) + payload


def _mvhd(duration_seconds: float, timescale: int = 1000, version: int = 0) -> bytes:
    duration = int(duration_seconds * timescale)
    if version == 1:
        body = bytes([1, 0, 0, 0]) + struct.pack(">QQIQ", 0, 0, timescale, duration)
    else:
        body = bytes([0, 0, 0, 0]) + struct.pack(">IIII", 0, 0, timescale, duration)
    return _box(b"mvhd", body + b"\x00" * 80)


def _trak(handler: bytes) -> bytes:
    hdlr = _box(b"hdlr", b"\x00\x00\x00\x00" + b"\x00\x00\x00\x00" + handler + b"\x00" * 12 + b"Handler\x00")
    return _box(b"trak", _box(b"tkhd", b"\x00" * 84) + _box(b"mdia", _box(b"mdhd", b"\x00" * 24) + hdlr))


def mp4_bytes(
    handlers: list[bytes],
    duration_seconds: float = 10,
    moov_at_end: bool = False,
    include_moov: bool = True,
    mvhd_version: int = 0,
    brand: bytes = b"M4A ",
) -> bytes:
    ftyp = _box(b"ftyp", brand + b"\x00\x00\x00\x00" + brand + b"isom")
    moov = _box(b"moov", _mvhd(duration_seconds, version=mvhd_version) + b"".join(_trak(h) for h in handlers))
    mdat = _box(b"mdat", b"\x00" * 256)
    if not include_moov:
        return ftyp + mdat
    return ftyp + (mdat + moov if moov_at_end else moov + mdat)


# ---------------- WebM (EBML)

def _size(n: int) -> bytes:
    if n < 0x7F:
        return bytes([0x80 | n])
    return bytes([0x01]) + n.to_bytes(7, "big")


def _el(el_id: int, payload: bytes) -> bytes:
    id_bytes = el_id.to_bytes((el_id.bit_length() + 7) // 8, "big")
    return id_bytes + _size(len(payload)) + payload


UNKNOWN_SIZE = bytes([0x01]) + b"\xff" * 7


def webm_bytes(track_types: list[int], duration_ms: float | None = 10_000, include_tracks: bool = True) -> bytes:
    header = _el(0x1A45DFA3, _el(0x4286, b"\x01") + _el(0x4282, b"webm"))
    info = _el(0x2AD7B1, (1_000_000).to_bytes(3, "big"))
    if duration_ms is not None:
        info += _el(0x4489, struct.pack(">d", duration_ms))
    body = _el(0x1549A966, info)
    if include_tracks:
        entries = b"".join(_el(0xAE, _el(0xD7, bytes([i + 1])) + _el(0x83, bytes([t]))) for i, t in enumerate(track_types))
        body += _el(0x1654AE6B, entries)
    body += _el(0x1F43B675, _el(0xE7, b"\x00") + b"\x00" * 64)
    # Segment with unknown size, as browser MediaRecorder writes it
    return header + (0x18538067).to_bytes(4, "big") + UNKNOWN_SIZE + body
