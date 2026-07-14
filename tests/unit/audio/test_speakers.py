"""Unit tests for speaker grouping/normalisation/labelling.

Regression coverage: these transforms reconstruct DialogueEntry objects and
previously dropped confidence/words entirely, silently breaking word-level
confidence highlighting for every real transcription (only ever caught by
manually seeding a database with synthetic data, which bypassed this code
path).
"""

from transcription_svc.audio.speakers import (
    add_speaker_labels,
    group_dialogue_entries_by_speaker,
    normalize_speaker_labels,
    process_speakers,
)
from transcription_svc.database.models import DialogueEntry, WordInfo


def _entry(speaker: str, text: str, confidence: float | None = None, words=None) -> DialogueEntry:
    return DialogueEntry(
        speaker=speaker,
        text=text,
        start_time=0.0,
        end_time=1.0,
        confidence=confidence,
        words=words,
    )


def _words(*texts: str) -> list[WordInfo]:
    return [
        WordInfo(text=t, start_time=float(i), end_time=float(i) + 1, confidence=0.9)
        for i, t in enumerate(texts)
    ]


class TestGroupDialogueEntriesBySpeaker:
    def test_preserves_confidence_and_words_for_a_single_entry(self):
        entries = [_entry("0", "hello", confidence=0.8, words=_words("hello"))]
        result = group_dialogue_entries_by_speaker(entries)
        assert result[0].confidence == 0.8
        assert result[0].words == _words("hello")

    def test_concatenates_words_across_merged_entries(self):
        entries = [
            _entry("0", "the quick", confidence=0.9, words=_words("the", "quick")),
            _entry("0", "brown fox", confidence=0.9, words=_words("brown", "fox")),
        ]
        result = group_dialogue_entries_by_speaker(entries)
        assert len(result) == 1
        assert [w.text for w in result[0].words] == ["the", "quick", "brown", "fox"]

    def test_weights_merged_confidence_by_word_count(self):
        entries = [
            _entry("0", "one two", confidence=1.0),  # 2 words
            _entry("0", "three", confidence=0.0),  # 1 word
        ]
        result = group_dialogue_entries_by_speaker(entries)
        assert len(result) == 1
        # (1.0*2 + 0.0*1) / 3 = 0.666...
        assert abs(result[0].confidence - (2 / 3)) < 1e-9

    def test_unscored_entry_does_not_drag_down_a_scored_merge(self):
        # A merged-in phrase with no confidence at all must not count as a
        # 0.0-confidence phrase — it should simply not contribute to the
        # weighting, leaving the scored phrase's own confidence intact.
        entries = [
            _entry("0", "one two", confidence=0.8),  # 2 words, scored
            _entry("0", "three four", confidence=None),  # 2 words, unscored
        ]
        result = group_dialogue_entries_by_speaker(entries)
        assert len(result) == 1
        assert result[0].confidence == 0.8

    def test_does_not_merge_across_different_speakers(self):
        entries = [
            _entry("0", "hello", confidence=0.9, words=_words("hello")),
            _entry("1", "hi there", confidence=0.8, words=_words("hi", "there")),
        ]
        result = group_dialogue_entries_by_speaker(entries)
        assert len(result) == 2
        assert result[0].confidence == 0.9
        assert result[1].confidence == 0.8

    def test_handles_missing_confidence_and_words_gracefully(self):
        entries = [_entry("0", "hello"), _entry("0", "world")]
        result = group_dialogue_entries_by_speaker(entries)
        assert len(result) == 1
        assert result[0].confidence is None
        assert result[0].words is None


class TestNormalizeSpeakerLabels:
    def test_preserves_confidence_and_words(self):
        entries = [_entry("2", "hello", confidence=0.75, words=_words("hello"))]
        result = normalize_speaker_labels(entries)
        assert result[0].confidence == 0.75
        assert result[0].words == _words("hello")

    def test_relabels_speakers_to_sequential_ids(self):
        entries = [_entry("guid-b", "hi"), _entry("guid-a", "there")]
        result = normalize_speaker_labels(entries)
        assert result[0].speaker == "0"
        assert result[1].speaker == "1"


class TestAddSpeakerLabels:
    def test_preserves_confidence_and_words(self):
        entries = [_entry("0", "hello", confidence=0.65, words=_words("hello"))]
        result = add_speaker_labels(entries)
        assert result[0].confidence == 0.65
        assert result[0].words == _words("hello")

    def test_prefixes_speaker_label(self):
        entries = [_entry("0", "hello")]
        result = add_speaker_labels(entries)
        assert result[0].speaker == "Speaker 0"


class TestProcessSpeakers:
    def test_confidence_and_words_survive_the_full_pipeline(self):
        entries = [
            _entry("0", "the quick", confidence=0.9, words=_words("the", "quick")),
            _entry("0", "brown fox", confidence=0.7, words=_words("brown", "fox")),
        ]
        result = process_speakers(entries)
        assert len(result) == 1
        assert result[0].speaker == "Speaker 0"
        assert result[0].confidence is not None
        assert [w.text for w in result[0].words] == ["the", "quick", "brown", "fox"]
