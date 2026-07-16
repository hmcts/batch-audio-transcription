import type { NBestCandidate, PhraseAlternatives, Word } from "./types";

// The subset of a dialogue entry / TranscriptSegment this lookup needs. Kept
// structural (rather than requiring the whole segment) so both DIAAT-233's
// hover popup and DIAAT-234's click-to-resolve menu can call it with just
// the fields they hold.
export interface AlternativesLookupEntry {
  words?: Word[];
  alternatives?: PhraseAlternatives[];
}

export interface LowConfidenceWordDiagnosis {
  // The hovered word's own per-word confidence (0-1), or null when the entry
  // has no word-level data for that index.
  wordConfidence: number | null;
  // The alternate whole-phrase readings Azure also heard — i.e. candidates[1:]
  // of the alternatives group whose word-range contains this word. Index 0 is
  // never included, since it is the reading already shown as the segment text.
  // Empty when no group covers the word, or that group has only the top
  // reading. NEVER re-sorted: Azure's order (index 0 = top) is authoritative
  // and its confidences are not monotonic (DIAAT-232 spike).
  alternativeCandidates: NBestCandidate[];
  // The inclusive lexical word-range of the matching group, or null when no
  // group covers this word. Exposed so DIAAT-234 can apply a word-range
  // correction over exactly the phrase these alternatives belong to, reusing
  // the existing WordCorrection index space.
  matchedRange: { startWordIndex: number; endWordIndex: number } | null;
}

// Given a dialogue entry and a lexical word index, explains why that word is
// low-confidence: its own confidence score, and any alternate full-phrase
// readings Azure offered for the phrase it belongs to.
//
// Pure and side-effect-free — shared by DIAAT-233 (hover popup) and DIAAT-234
// (click-to-resolve menu). A group whose word-range is undefined (alignment
// lost during a speaker-turn merge) cannot be matched by word index, so such
// a word gracefully degrades to "confidence only, no alternatives".
export function diagnoseLowConfidenceWord(
  entry: AlternativesLookupEntry,
  wordIndex: number
): LowConfidenceWordDiagnosis {
  const wordConfidence = entry.words?.[wordIndex]?.confidence ?? null;

  const group = (entry.alternatives ?? []).find(
    (g) =>
      g.startWordIndex !== undefined &&
      g.endWordIndex !== undefined &&
      wordIndex >= g.startWordIndex &&
      wordIndex <= g.endWordIndex
  );

  if (!group) {
    return { wordConfidence, alternativeCandidates: [], matchedRange: null };
  }

  return {
    wordConfidence,
    // Only candidates[1:] are alternatives; index 0 is the current reading.
    alternativeCandidates:
      group.candidates.length > 1 ? group.candidates.slice(1) : [],
    matchedRange: {
      startWordIndex: group.startWordIndex as number,
      endWordIndex: group.endWordIndex as number,
    },
  };
}
