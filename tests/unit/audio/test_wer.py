"""Unit tests for word error rate computation."""

import time

from transcription_svc.audio.wer import aggregate_word_error_rate, word_error_rate


class TestWordErrorRate:
    def test_identical_text_has_zero_error(self):
        assert word_error_rate("the quick brown fox", "the quick brown fox") == 0.0

    def test_is_case_insensitive(self):
        assert word_error_rate("The Quick Fox", "the quick fox") == 0.0

    def test_single_substitution(self):
        # 1 error out of 4 reference words
        assert word_error_rate("the quick brown fox", "the slow brown fox") == 0.25

    def test_single_deletion(self):
        # hypothesis missing one word: 1 error out of 4 reference words
        assert word_error_rate("the quick brown fox", "the quick fox") == 0.25

    def test_single_insertion(self):
        # hypothesis has one extra word: 1 error out of 4 reference words
        assert word_error_rate("the quick brown fox", "the very quick brown fox") == 0.25

    def test_completely_different_text(self):
        assert word_error_rate("one two three", "four five six") == 1.0

    def test_empty_reference_and_hypothesis_is_zero_error(self):
        assert word_error_rate("", "") == 0.0

    def test_empty_reference_with_nonempty_hypothesis_is_full_error(self):
        assert word_error_rate("", "hello") == 1.0

    def test_empty_hypothesis_against_reference_is_full_error(self):
        assert word_error_rate("hello world", "") == 1.0

    def test_ignores_whitespace_differences(self):
        assert word_error_rate("hello   world", "hello world") == 0.0

    def test_completes_quickly_on_a_long_transcript(self):
        # Regression: word_error_rate ran an O(N*M) edit-distance matrix
        # over the *entire* transcript, which took over 30s in production
        # on a real ~14,600-word hearing. Should never be called at that
        # scale (see accuracy.py, which restricts WER to per-segment
        # pairs), but confirm this function itself stays fast at a size
        # that would previously have hung a request.
        long_text = " ".join(f"word{i}" for i in range(3000))
        start = time.monotonic()
        word_error_rate(long_text, long_text)
        assert time.monotonic() - start < 2.0


class TestAggregateWordErrorRate:
    def test_empty_pairs_is_zero_error(self):
        assert aggregate_word_error_rate([]) == 0.0

    def test_single_pair_matches_word_error_rate(self):
        pairs = [("the quick brown fox", "the slow brown fox")]
        assert aggregate_word_error_rate(pairs) == word_error_rate(*pairs[0])

    def test_weights_by_reference_word_count(self):
        pairs = [
            ("one two", "one wrong"),  # 1 error / 2 ref words
            ("a b c d e f g h", "a b c d e f g h"),  # 0 errors / 8 ref words
        ]
        # 1 total error / 10 total ref words
        assert aggregate_word_error_rate(pairs) == 0.1

    def test_stays_fast_across_many_segment_pairs(self):
        pairs = [("the quick brown fox", "the slow brown fox")] * 500
        start = time.monotonic()
        aggregate_word_error_rate(pairs)
        assert time.monotonic() - start < 2.0
