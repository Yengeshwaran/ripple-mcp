"""Predictable error contract: {"error": {"code", "message", "retryable"}}.

Messages are written for the end user. Provider responses, stack traces and keys are never included.
"""

from __future__ import annotations


class VoiceServiceError(Exception):
    def __init__(self, status: int, code: str, message: str, retryable: bool = False) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.retryable = retryable

    def body(self) -> dict:
        return {"error": {"code": self.code, "message": self.message, "retryable": self.retryable}}


def missing_file() -> VoiceServiceError:
    return VoiceServiceError(400, "MISSING_FILE", "Attach an audio file in the 'file' field.")


def empty_file() -> VoiceServiceError:
    return VoiceServiceError(400, "EMPTY_FILE", "The uploaded file is empty.")


def invalid_request(message: str) -> VoiceServiceError:
    return VoiceServiceError(400, "INVALID_REQUEST", message)


def file_too_large(limit_mb: int) -> VoiceServiceError:
    return VoiceServiceError(413, "FILE_TOO_LARGE", f"The file is larger than the {limit_mb} MB limit.")


def unsupported_audio() -> VoiceServiceError:
    return VoiceServiceError(415, "UNSUPPORTED_AUDIO_TYPE", "Upload a supported audio format: WAV, MP3, M4A or WebM.")


def no_speech() -> VoiceServiceError:
    return VoiceServiceError(422, "NO_SPEECH_DETECTED", "No speech was found in the recording.")


def unusable_audio() -> VoiceServiceError:
    return VoiceServiceError(422, "UNUSABLE_AUDIO", "The recording could not be transcribed. Try a clearer or different file.")


def invalid_extraction() -> VoiceServiceError:
    return VoiceServiceError(422, "INVALID_EXTRACTION_OUTPUT", "Task suggestions could not be produced in a valid format. Try again.", retryable=True)


def provider_error(stage: str) -> VoiceServiceError:
    return VoiceServiceError(502, f"{stage}_PROVIDER_ERROR", f"The {stage.lower()} provider returned an error.", retryable=True)


def provider_unavailable(stage: str) -> VoiceServiceError:
    return VoiceServiceError(503, f"{stage}_PROVIDER_UNAVAILABLE", f"The {stage.lower()} provider is busy or timed out. Try again shortly.", retryable=True)


def not_configured(what: str) -> VoiceServiceError:
    return VoiceServiceError(503, "SERVICE_NOT_CONFIGURED", f"The voice service is missing configuration: {what}.")
