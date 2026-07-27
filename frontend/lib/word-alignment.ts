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
// so it maps each whitespace-separated display token to the range of lexical
// words it most likely corresponds to. This is inherently approximate: a
// single display token like "PA/04471/2026" can span many lexical words
// ("PA", "slash", "zero", "four", ...), and the boundary between two display
// tokens won't always land exactly where the lexical boundary does.
//
// DIAAT-242: the mapping used to divide by UNIFORM TOKEN INDEX, i.e. it gave
// every display token roughly the same share of lexical words. That badly
// mislocates compressed tokens: a case reference like "PA/05217/2025" expands
// to ~12 spoken lexical words but only got its equal share, so the overflow
// spilled into the FOLLOWING tokens' ranges. Those tokens then inherited the
// number's EARLIER lexical times, so their highlight lit up early and stayed
// ahead of speech for the rest of the segment. We now WEIGHT each display
// token by an estimate of how many lexical words it expands to (digits,
// symbols and uppercase letters are each spoken separately) and distribute
// the lexical words proportionally to those weights using the largest-
// remainder method. It's good enough to keep highlighting broadly in sync
// and phrase-level correction consistent; it is not a token-for-token
// transcript alignment.

export interface DisplayToken {
  text: string;
  // Inclusive range of positions in the original `words` array this
  // display token was proportionally mapped to.
  startWordIndex: number;
  endWordIndex: number;
  // Mean confidence across the mapped lexical words (DIAAT-249). A single-word
  // token is unchanged (mean == that word's confidence), so genuinely low
  // single words still flag. For a multi-word token (a compressed reference
  // like "PA/05217/2025" spanning many lexical words), averaging stops one
  // weak sub-word among confident ones from dragging the whole token below the
  // highlight threshold — cutting false-positive "review" highlights — while a
  // broadly-uncertain multi-word token still averages low and stays flagged.
  confidence: number;
  startTime: number;
  endTime: number;
}

export function tokenizeDisplayText(text: string): string[] {
  return text.split(/\s+/).filter((t) => t.length > 0);
}

// A display token expands to roughly this many lexical (spoken) words:
//   - each digit is spoken separately ("2025" -> "twenty twenty five", counted
//     generously as one unit per digit);
//   - the separators /, ., -, : are spoken ("slash", "dot", "dash", "colon");
//   - an ACRONYM is spelled out letter-by-letter ("PA" -> "p a"), so its
//     uppercase letters each count.
// So "PA/05217/2025" -> "p a slash zero five two one seven slash twenty twenty
// five". Ordinary words map ~1:1 and get weight 1. Crucially, this must NOT
// inflate normal prose: a single leading capital (title-case, e.g. "Judge") is
// part of the base word, not a spelled-out acronym, so uppercase letters only
// count when there are 2+ of them; and non-spoken punctuation (commas, quotes,
// parentheses, trailing "." on "Judge.") is ignored. This is a heuristic proxy
// — good enough to keep the highlight broadly in sync (DIAAT-242), not an exact
// aligner.
const SPOKEN_SEPARATORS = new Set(["/", ".", "-", ":"]);

export function estimateLexicalWeight(token: string): number {
  let weight = 0;
  let uppercaseCount = 0;
  for (const ch of token) {
    if (ch >= "0" && ch <= "9") {
      weight += 1; // each digit ~ one spoken word
    } else if (SPOKEN_SEPARATORS.has(ch)) {
      weight += 1; // separators spoken aloud ("slash", "dot", ...)
    } else if (ch >= "A" && ch <= "Z") {
      uppercaseCount += 1; // tallied; only counts if this is an acronym (2+)
    }
    // Lowercase letters and other punctuation (commas, quotes, brackets)
    // contribute nothing — they don't add spoken lexical words.
  }
  // 2+ uppercase letters => acronym spelled out letter-by-letter; a single
  // leading capital is just title case and adds no extra spoken words.
  if (uppercaseCount >= 2) weight += uppercaseCount;
  return Math.max(1, weight);
}

// Distributes `count` lexical words across `tokens` contiguous ranges,
// proportional to each token's estimated lexical weight, using the largest-
// remainder method. Requires tokens.length <= count (callers must collapse
// any excess tokens first) so every token gets at least one distinct word and
// consecutive ranges never share or overlap a word index. Returns one
// inclusive [start, end] range per token, in order, covering [0, count - 1]
// with no gaps or overlaps.
function distributeByWeight(
  tokens: string[],
  count: number
): Array<[number, number]> {
  const d = tokens.length;
  const counts = new Array<number>(d).fill(1);
  const remaining = count - d;

  if (remaining > 0) {
    const weights = tokens.map(estimateLexicalWeight);
    const total = weights.reduce((sum, w) => sum + w, 0);
    const idealExtra = weights.map((w) => (w / total) * remaining);
    const floorExtra = idealExtra.map((x) => Math.floor(x));
    for (let i = 0; i < d; i++) {
      counts[i] += floorExtra[i];
    }
    const rem = remaining - floorExtra.reduce((sum, x) => sum + x, 0);
    // Give the leftover words to the tokens with the largest fractional
    // remainder; tie-break on lower index first for determinism.
    const order = Array.from({ length: d }, (_, i) => i).sort((a, b) => {
      const fracA = idealExtra[a] - floorExtra[a];
      const fracB = idealExtra[b] - floorExtra[b];
      if (fracB !== fracA) return fracB - fracA;
      return a - b;
    });
    for (let k = 0; k < rem; k++) {
      counts[order[k]] += 1;
    }
  }

  const ranges: Array<[number, number]> = [];
  let cursor = 0;
  for (let i = 0; i < d; i++) {
    const start = cursor;
    const end = start + counts[i] - 1;
    ranges.push([start, end]);
    cursor = end + 1;
  }
  return ranges;
}

// Maps each display-text token to the proportional range of lexical
// `words` it corresponds to. Returns one DisplayToken per display token,
// in order, covering the full lexical range with no gaps or overlaps.
export function alignWordsToDisplayTokens(
  displayText: string,
  words: Word[]
): DisplayToken[] {
  const rawTokens = tokenizeDisplayText(displayText);
  if (rawTokens.length === 0 || words.length === 0) return [];

  // Display text is normally a compressed form of the lexical stream (as
  // many or fewer tokens than lexical words), never more — but if it ever
  // is (e.g. unusual whitespace, or Azure returning fewer word entries
  // than expected), collapse the excess into the last token rather than
  // letting proportionalBucket hand out duplicate word ranges to several
  // distinct display tokens.
  const tokens =
    rawTokens.length <= words.length
      ? rawTokens
      : [
          ...rawTokens.slice(0, words.length - 1),
          rawTokens.slice(words.length - 1).join(" "),
        ];

  const ranges = distributeByWeight(tokens, words.length);

  return tokens.map((text, i) => {
    const [start, end] = ranges[i];
    // A plain loop rather than spreading `span.map(...)` into Math.min/reduce —
    // spreading a large array as call arguments risks exceeding the JS engine's
    // argument-count limit, and this avoids the intermediate arrays too.
    // Confidence is the MEAN across the mapped words (DIAAT-249); timing keeps
    // the min startTime / max endTime so the token spans the full spoken range.
    let confidenceSum = words[start].confidence;
    let startTime = words[start].startTime;
    let endTime = words[start].endTime;
    for (let j = start + 1; j <= end; j++) {
      confidenceSum += words[j].confidence;
      if (words[j].startTime < startTime) startTime = words[j].startTime;
      if (words[j].endTime > endTime) endTime = words[j].endTime;
    }
    return {
      text,
      startWordIndex: start,
      endWordIndex: end,
      confidence: confidenceSum / (end - start + 1),
      startTime,
      endTime,
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
      tokens[i].startWordIndex <= endWordIndex &&
      tokens[i].endWordIndex >= startWordIndex;
    if (overlaps) {
      if (start === -1) start = i;
      end = i;
    }
  }
  if (start === -1) return null;
  return { start, end };
}
