"""Unit tests for Azure Storage utility helpers."""

from transcription_svc.audio.azure_utils import _sanitize_for_log


class TestSanitizeForLog:
    def test_passes_through_plain_values(self):
        assert _sanitize_for_log("audio-processing/uploads/file.wav") == (
            "audio-processing/uploads/file.wav"
        )

    def test_strips_newlines_that_would_forge_log_lines(self):
        malicious = "file.wav\n2026-01-01 ERROR fake log line injected"
        assert "\n" not in _sanitize_for_log(malicious)

    def test_strips_carriage_returns_and_tabs(self):
        assert _sanitize_for_log("a\r\nb\tc") == "a b c"

    def test_stringifies_non_string_values(self):
        assert _sanitize_for_log(ValueError("boom")) == "boom"
