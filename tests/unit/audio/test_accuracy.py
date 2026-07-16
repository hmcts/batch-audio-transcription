"""Unit tests for accuracy/needs-review computation."""

from transcription_svc.audio.accuracy import compute_accuracy
from transcription_svc.database.models import DialogueEntry


def _entry(
    speaker="0",
    text="hello world",
    start=0.0,
    end=1.0,
    confidence=None,
    corrected=None,
    accepted=False,
):
    return DialogueEntry(
        speaker=speaker,
        text=text,
        start_time=start,
        end_time=end,
        confidence=confidence,
        corrected_text=corrected,
        accepted=accepted,
    )


class TestComputeAccuracy:
    def test_confidence_score_is_word_count_weighted_average(self):
        entries = [
            _entry(text="one two", confidence=1.0),
            _entry(text="three four five six", confidence=0.5),
        ]
        summary = compute_accuracy(entries)
        # (2*1.0 + 4*0.5) / 6 = 4/6 = 0.6667 -> 66.67%
        assert round(summary.confidence_score, 2) == 66.67

    def test_words_transcribed_counts_all_entries(self):
        entries = [_entry(text="one two three"), _entry(text="four five")]
        assert compute_accuracy(entries).words_transcribed == 5

    def test_no_corrections_means_no_wer(self):
        entries = [_entry(confidence=0.9)]
        summary = compute_accuracy(entries)
        assert summary.has_corrections is False
        assert summary.word_error_rate is None
        assert summary.corrected_percent is None

    def test_correction_enables_wer_computation(self):
        entries = [_entry(text="the quick brown fox", corrected="the slow brown fox")]
        summary = compute_accuracy(entries)
        assert summary.has_corrections is True
        assert summary.word_error_rate == 25.0
        assert summary.corrected_percent == 100.0

    def test_partial_corrections_report_correct_percent(self):
        entries = [
            _entry(text="hello world", corrected="hello there"),
            _entry(text="goodbye now"),
        ]
        summary = compute_accuracy(entries)
        assert summary.corrected_percent == 50.0

    def test_low_confidence_segments_appear_in_needs_review(self):
        entries = [
            _entry(speaker="Judge", start=0.0, confidence=0.5),
            _entry(speaker="Counsel", start=5.0, confidence=0.95),
        ]
        summary = compute_accuracy(entries, confidence_threshold=0.85)
        assert summary.low_confidence_count == 1
        assert len(summary.needs_review) == 1
        assert summary.needs_review[0].speaker == "Judge"

    def test_corrected_segments_are_excluded_from_needs_review(self):
        entries = [_entry(confidence=0.5, corrected="fixed text")]
        summary = compute_accuracy(entries, confidence_threshold=0.85)
        assert summary.low_confidence_count == 0
        assert summary.needs_review == []

    def test_entries_with_no_confidence_are_excluded_from_needs_review(self):
        entries = [_entry(confidence=None)]
        summary = compute_accuracy(entries)
        assert summary.needs_review == []

    def test_accepted_segments_are_excluded_from_needs_review(self):
        entries = [_entry(confidence=0.5, accepted=True)]
        summary = compute_accuracy(entries, confidence_threshold=0.85)
        assert summary.low_confidence_count == 0
        assert summary.needs_review == []

    def test_accepting_a_segment_does_not_count_as_a_correction(self):
        """Accept-all is distinct from a real correction: it must not
        contribute to has_corrections()/word_error_rate — there is no
        actual reference text to compare against."""
        entries = [_entry(text="the quick brown fox", confidence=0.5, accepted=True)]
        summary = compute_accuracy(entries, confidence_threshold=0.85)
        assert summary.has_corrections is False
        assert summary.word_error_rate is None
        assert summary.corrected_percent is None

    def test_empty_entries(self):
        summary = compute_accuracy([])
        assert summary.confidence_score == 0.0
        assert summary.words_transcribed == 0
        assert summary.needs_review == []
        assert summary.has_corrections is False
