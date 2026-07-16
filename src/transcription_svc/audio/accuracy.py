"""Accuracy/needs-review computation for a completed transcription job.

Two distinct things get surfaced to the frontend, and they must not be
conflated:
- Confidence: Azure's own per-phrase confidence score. Always available,
  but not a measurement of correctness — nothing has verified it against
  ground truth.
- Word error rate: only meaningful once a clerk has corrected at least one
  segment, since that's the first point a real reference transcript exists
  to measure the original auto-generated wording against (see wer.py).
"""

from __future__ import annotations

from dataclasses import dataclass

from transcription_svc.audio.wer import aggregate_word_error_rate
from transcription_svc.database.models import DialogueEntry

# Azure's per-word confidence often sits in the high 70s/low 80s for
# correctly-recognised but short/common words (e.g. "the", "this") purely
# because of acoustic/language-model uncertainty in that instant, not because
# the word is wrong. At 0.85 that noise dominates the needs-review list and
# overwhelms reviewers. Genuinely uncertain recognitions (unclear audio,
# real mishears) tend to fall well below that, so 0.65 keeps flagging
# meaningful for review while cutting out the common-word noise (see
# DIAAT-235).
DEFAULT_CONFIDENCE_THRESHOLD = 0.65


@dataclass(frozen=True)
class NeedsReviewItem:
    speaker: str
    start_time: float
    confidence: float


@dataclass(frozen=True)
class AccuracySummary:
    confidence_score: float  # 0-100, word-count-weighted average
    words_transcribed: int
    low_confidence_count: int
    confidence_threshold: float  # 0-100
    has_corrections: bool
    word_error_rate: float | None  # 0-100+, only set once a segment is corrected
    corrected_percent: float | None  # % of segments corrected so far
    needs_review: list[NeedsReviewItem]


def compute_accuracy(
    entries: list[DialogueEntry],
    confidence_threshold: float = DEFAULT_CONFIDENCE_THRESHOLD,
) -> AccuracySummary:
    scored = [e for e in entries if e.confidence is not None]
    total_words = sum(len(e.text.split()) for e in entries)

    weighted_words = sum(len(e.text.split()) for e in scored)
    confidence_score = (
        sum(e.confidence * len(e.text.split()) for e in scored) / weighted_words
        if weighted_words
        else 0.0
    )

    has_corrections = any(e.has_corrections() for e in entries)

    needs_review = [
        NeedsReviewItem(speaker=e.speaker, start_time=e.start_time, confidence=e.confidence)
        for e in entries
        if e.confidence is not None
        and e.confidence < confidence_threshold
        and not e.has_corrections()
    ]

    wer = None
    corrected_percent = None
    if has_corrections:
        # Only segments a clerk has actually corrected have a real
        # reference to measure against — restricting to those keeps the
        # edit-distance computation cheap (short segments, not the whole
        # transcript) and the metric honest (uncorrected segments would
        # otherwise contribute zero error and dilute the result).
        corrected = [e for e in entries if e.has_corrections()]
        pairs = [(e.effective_text(), e.text) for e in corrected]
        wer = aggregate_word_error_rate(pairs) * 100
        corrected_percent = (len(corrected) / len(entries)) * 100 if entries else 0.0

    return AccuracySummary(
        confidence_score=confidence_score * 100,
        words_transcribed=total_words,
        low_confidence_count=len(needs_review),
        confidence_threshold=confidence_threshold * 100,
        has_corrections=has_corrections,
        word_error_rate=wer,
        corrected_percent=corrected_percent,
        needs_review=needs_review,
    )
