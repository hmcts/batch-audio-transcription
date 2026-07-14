import type { Word } from "./types";

// Azure Speech Batch only applies capitalisation, punctuation, and digit
// formatting (e.g. "339C", "8") at the whole-phrase level ("display" text).
// Its per-word array is always the raw recognition ("lexical") stream:
// lowercase, no punctuation, numbers spelled out. There is no per-word
// display form to fall back on. So rendering word-by-word directly (as the
// UI used to, whenever word-level data existed) reads noticeably worse than
// the phrase text used everywhere else.
//
// This module renders the properly-formatted phrase text, but still needs
// per-word confidence/timing for highlighting and word-range corrections —
// so it proportionally maps each whitespace-separated display token to the
// range of lexical words it most likely corresponds to. This is inherently
// approximate: a single display token like "PA/04471/20206" can span many
// lexical words ("PA", "slash", "zero", "four", ...), and the boundary
// between two display tokens won't always land exactly where the lexical
// boundary does. It's good enough for highlighting and phrase-level
// correction; it is not a token-for-token transcript alignment.

export interface DisplayToken {
  text: string;
  // Inclusive range of positions in the original `words` array this
  // display token was proportionally mapped to.
  startWordIndex: number;
  endWordIndex: number;
  // Most pessimistic (lowest) confidence among the mapped lexical words —
  // if any of them was uncertain, treat the whole display token as such.
  confidence: number;
  startTime: number;
  endTime: number;
}

export function tokenizeDisplayText(text: string): string[] {
  return text.split(/\s+/).filter((t) => t.length > 0);
}

// Splits `count` lexical words into `bucketCount` contiguous, non-empty*
// buckets as evenly as possible. (*a bucket can only be empty if there are
// fewer lexical words than display tokens, which doesn't happen in
// practice — display text is never more granular than the lexical stream.)
function proportionalBucket(index: number, bucketCount: number, count: number): [number, number] {
  const start = Math.floor((index * count) / bucketCount);
  const end = Math.floor(((index + 1) * count) / bucketCount) - 1;
  return [start, Math.max(start, end)];
}

// Maps each display-text token to the proportional range of lexical
// `words` it corresponds to. Returns one DisplayToken per display token,
// in order, covering the full lexical range with no gaps or overlaps.
export function alignWordsToDisplayTokens(
  displayText: string,
  words: Word[]
): DisplayToken[] {
  const tokens = tokenizeDisplayText(displayText);
  if (tokens.length === 0 || words.length === 0) return [];

  return tokens.map((text, i) => {
    const [start, end] = proportionalBucket(i, tokens.length, words.length);
    const span = words.slice(start, end + 1);
    return {
      text,
      startWordIndex: start,
      endWordIndex: end,
      confidence: Math.min(...span.map((w) => w.confidence)),
      startTime: Math.min(...span.map((w) => w.startTime)),
      endTime: Math.max(...span.map((w) => w.endTime)),
    };
  });
}

// Reverse mapping: given a lexical word-index range (e.g. from a
// WordCorrection or a history entry, both always expressed in the original
// `words` array's indices), finds the range of display tokens that overlap
// it — i.e. the token(s) a clerk would need to see replaced/highlighted so
// the correction and the displayed phrase text stay consistent.
export function displayRangeForWordRange(
  tokens: DisplayToken[],
  startWordIndex: number,
  endWordIndex: number
): { start: number; end: number } | null {
  let start = -1;
  let end = -1;
  for (let i = 0; i < tokens.length; i++) {
    const overlaps =
      tokens[i].startWordIndex <= endWordIndex && tokens[i].endWordIndex >= startWordIndex;
    if (overlaps) {
      if (start === -1) start = i;
      end = i;
    }
  }
  if (start === -1) return null;
  return { start, end };
}
