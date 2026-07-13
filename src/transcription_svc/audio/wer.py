"""Word error rate: only meaningful once a human has corrected a segment.

Azure's own per-phrase confidence score is not an accuracy measurement —
there's nothing to compare it against. A real WER needs a reference
transcript, which only exists once a clerk has corrected the
auto-generated wording (see TranscriptionJob.dialogue_entries[].corrected_text).

WER is computed per-segment and aggregated (weighted by each segment's word
count) rather than over a whole transcript at once: the O(N*M) edit-distance
matrix is fine for a single segment's handful of words, but a multi-thousand-
word hearing transcript makes it computationally infeasible (a real 158-
segment/~14,600-word transcript took over 30 seconds against a whole-document
comparison in testing).
"""

from __future__ import annotations

import re

_WORD_RE = re.compile(r"\S+")


def _tokenize(text: str) -> list[str]:
    return _WORD_RE.findall(text.lower())


def _edit_distance(ref_words: list[str], hyp_words: list[str]) -> int:
    n, m = len(ref_words), len(hyp_words)
    # dp[i][j] = edit distance between ref_words[:i] and hyp_words[:j]
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        dp[i][0] = i
    for j in range(m + 1):
        dp[0][j] = j

    for i in range(1, n + 1):
        for j in range(1, m + 1):
            if ref_words[i - 1] == hyp_words[j - 1]:
                dp[i][j] = dp[i - 1][j - 1]
            else:
                dp[i][j] = 1 + min(
                    dp[i - 1][j],  # deletion
                    dp[i][j - 1],  # insertion
                    dp[i - 1][j - 1],  # substitution
                )

    return dp[n][m]


def word_error_rate(reference: str, hypothesis: str) -> float:
    """Return WER of hypothesis against reference, as a fraction (0.0-1.0+).

    Standard word-level Levenshtein distance: WER = (S + D + I) / N, where
    N is the reference word count. Can exceed 1.0 if the hypothesis has far
    more insertions than the reference has words. Only suitable for
    single-segment-scale text — see module docstring.
    """
    ref_words = _tokenize(reference)
    hyp_words = _tokenize(hypothesis)

    if not ref_words:
        return 0.0 if not hyp_words else 1.0

    return _edit_distance(ref_words, hyp_words) / len(ref_words)


def aggregate_word_error_rate(pairs: list[tuple[str, str]]) -> float:
    """WER across multiple (reference, hypothesis) segment pairs.

    Weighted by each segment's reference word count, so a handful of
    heavily-edited short segments don't skew the result the same as one
    long, mostly-correct one.
    """
    total_errors = 0
    total_ref_words = 0
    for reference, hypothesis in pairs:
        ref_words = _tokenize(reference)
        hyp_words = _tokenize(hypothesis)
        total_ref_words += len(ref_words)
        total_errors += _edit_distance(ref_words, hyp_words)

    if total_ref_words == 0:
        return 0.0
    return total_errors / total_ref_words
