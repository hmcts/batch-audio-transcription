"""Unit tests for accuracy/needs-review computation."""

from transcription_svc.audio.accuracy import DEFAULT_CONFIDENCE_THRESHOLD, compute_accuracy
from transcription_svc.database.models import DialogueEntry


def _entry(speaker="0", text="hello world", start=0.0, end=1.0, confidence=None, corrected=None):
    return DialogueEntry(
        speaker=speaker,
        text=text,
        start_time=start,
        end_time=end,
        confidence=confidence,
        corrected_text=corrected,
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

    def test_empty_entries(self):
        summary = compute_accuracy([])
        assert summary.confidence_score == 0.0
        assert summary.words_transcribed == 0
        assert summary.needs_review == []
        assert summary.has_corrections is False

    # DIAAT-235: the default threshold was lowered from 0.85 to reduce how
    # many merely-common-but-correct words get flagged for review.
    def test_default_threshold_is_lowered_to_reduce_review_noise(self):
        assert DEFAULT_CONFIDENCE_THRESHOLD == 0.65

    def test_word_above_new_default_threshold_is_not_flagged(self):
        # 0.75 sits above the new 0.65 default but below the old 0.85 one —
        # this is exactly the "correct common word, imperfect confidence"
        # case the lowered threshold should stop flagging.
        entries = [_entry(speaker="Judge", start=0.0, confidence=0.75)]
        summary = compute_accuracy(entries)
        assert summary.low_confidence_count == 0
        assert summary.needs_review == []

    def test_word_below_new_default_threshold_is_still_flagged(self):
        entries = [_entry(speaker="Judge", start=0.0, confidence=0.5)]
        summary = compute_accuracy(entries)
        assert summary.low_confidence_count == 1
        assert len(summary.needs_review) == 1
        assert summary.needs_review[0].speaker == "Judge"
