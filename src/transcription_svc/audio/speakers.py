from __future__ import annotations

import logging

from transcription_svc.database.models import DialogueEntry

logger = logging.getLogger(__name__)


def _merged_confidence(
    existing_text: str,
    existing_confidence: float | None,
    new_text: str,
    new_confidence: float | None,
) -> float | None:
    """Word-count-weighted average, matching how accuracy.py aggregates confidence."""
    if existing_confidence is None and new_confidence is None:
        return None
    existing_words = len(existing_text.split())
    new_words = len(new_text.split())
    total_words = existing_words + new_words
    if total_words == 0:
        return existing_confidence if existing_confidence is not None else new_confidence
    return (
        (existing_confidence or 0.0) * existing_words + (new_confidence or 0.0) * new_words
    ) / total_words


def group_dialogue_entries_by_speaker(
    entries: list[DialogueEntry],
) -> list[DialogueEntry]:
    grouped: list[DialogueEntry] = []
    current_speaker: str | None = None
    current_entry: DialogueEntry | None = None

    for entry in entries:
        if entry.speaker != current_speaker:
            if current_entry:
                grouped.append(current_entry)
            current_speaker = entry.speaker
            current_entry = DialogueEntry(
                speaker=current_speaker,
                text=entry.text,
                start_time=entry.start_time,
                end_time=entry.end_time,
                confidence=entry.confidence,
                words=entry.words,
            )
        elif current_entry:
            current_entry.confidence = _merged_confidence(
                current_entry.text, current_entry.confidence, entry.text, entry.confidence
            )
            if current_entry.words is not None or entry.words is not None:
                current_entry.words = (current_entry.words or []) + (entry.words or [])
            current_entry.text += f" {entry.text}"
            current_entry.end_time = entry.end_time

    if current_entry:
        grouped.append(current_entry)

    return grouped


def normalize_speaker_labels(entries: list[DialogueEntry]) -> list[DialogueEntry]:
    speaker_map: dict[str, str] = {}
    counter = 0
    result = []

    for entry in entries:
        if entry.speaker not in speaker_map:
            speaker_map[entry.speaker] = str(counter)
            counter += 1
        result.append(
            DialogueEntry(
                speaker=speaker_map[entry.speaker],
                text=entry.text,
                start_time=entry.start_time,
                end_time=entry.end_time,
                confidence=entry.confidence,
                words=entry.words,
            )
        )

    return result


def add_speaker_labels(entries: list[DialogueEntry]) -> list[DialogueEntry]:
    return [
        DialogueEntry(
            speaker=f"Speaker {entry.speaker}",
            text=entry.text,
            start_time=entry.start_time,
            end_time=entry.end_time,
            confidence=entry.confidence,
            words=entry.words,
        )
        for entry in entries
    ]


def process_speakers(entries: list[DialogueEntry]) -> list[DialogueEntry]:
    """Group, normalise, and label speaker entries.

    Each step degrades gracefully: on failure the previous step's output
    is returned rather than raising.
    """
    try:
        grouped = group_dialogue_entries_by_speaker(entries)
    except Exception:
        logger.exception("Speaker grouping failed; returning original entries")
        return entries

    try:
        normalised = normalize_speaker_labels(grouped)
    except Exception:
        logger.exception("Speaker normalisation failed; returning grouped entries")
        return grouped

    try:
        return add_speaker_labels(normalised)
    except Exception:
        logger.exception("Speaker labelling failed; returning normalised entries")
        return normalised
