import { describe, expect, it } from "vitest";
import { diagnoseLowConfidenceWord } from "@/lib/alternatives";
import type { PhraseAlternatives, Word } from "@/lib/types";

const WORDS: Word[] = [
  { text: "hello", startTime: 0, endTime: 0.5, confidence: 0.56 },
  { text: "world", startTime: 0.5, endTime: 1.0, confidence: 0.5 },
  { text: "today", startTime: 1.0, endTime: 1.4, confidence: 0.9 },
];

// Mirrors Azure's documented "hello world" example (DIAAT-232 spike): index 0
// is the top reading already shown as the segment text; confidences are not
// monotonic and one alternate omits confidence entirely.
const ALTERNATIVES: PhraseAlternatives[] = [
  {
    startWordIndex: 0,
    endWordIndex: 1,
    candidates: [
      { text: "Hello world", confidence: 0.564 },
      { text: "helloworld", confidence: 0.177 },
      { text: "hello worm", confidence: 0.5 },
      { text: "hello word" }, // confidence absent
    ],
  },
];

describe("diagnoseLowConfidenceWord", () => {
  it("returns the word's own confidence", () => {
    const result = diagnoseLowConfidenceWord({ words: WORDS }, 1);
    expect(result.wordConfidence).toBe(0.5);
  });

  it("returns null wordConfidence when there is no word-level data", () => {
    const result = diagnoseLowConfidenceWord({ alternatives: ALTERNATIVES }, 1);
    expect(result.wordConfidence).toBeNull();
  });

  it("returns null wordConfidence for an out-of-range index", () => {
    const result = diagnoseLowConfidenceWord({ words: WORDS }, 99);
    expect(result.wordConfidence).toBeNull();
  });

  it("finds the group whose word-range contains the word index", () => {
    const result = diagnoseLowConfidenceWord(
      { words: WORDS, alternatives: ALTERNATIVES },
      0
    );
    expect(result.matchedRange).toEqual({ startWordIndex: 0, endWordIndex: 1 });
  });

  it("also matches the word at the inclusive end of the range", () => {
    const result = diagnoseLowConfidenceWord(
      { words: WORDS, alternatives: ALTERNATIVES },
      1
    );
    expect(result.matchedRange).toEqual({ startWordIndex: 0, endWordIndex: 1 });
  });

  it("excludes candidates[0] and returns the remaining readings in order", () => {
    const result = diagnoseLowConfidenceWord(
      { words: WORDS, alternatives: ALTERNATIVES },
      1
    );
    // candidates[1:], never re-sorted.
    expect(result.alternativeCandidates.map((c) => c.text)).toEqual([
      "helloworld",
      "hello worm",
      "hello word",
    ]);
  });

  it("preserves an absent candidate confidence as undefined (not 0)", () => {
    const result = diagnoseLowConfidenceWord(
      { words: WORDS, alternatives: ALTERNATIVES },
      1
    );
    const lastCandidate = result.alternativeCandidates.at(-1);
    expect(lastCandidate?.text).toBe("hello word");
    expect(lastCandidate?.confidence).toBeUndefined();
  });

  it("degrades to no alternatives when the word is outside every group's range", () => {
    // "today" (index 2) is not covered by the [0,1] group.
    const result = diagnoseLowConfidenceWord(
      { words: WORDS, alternatives: ALTERNATIVES },
      2
    );
    expect(result.matchedRange).toBeNull();
    expect(result.alternativeCandidates).toEqual([]);
    expect(result.wordConfidence).toBe(0.9);
  });

  it("returns no alternatives when the group has only the top reading", () => {
    const singleCandidate: PhraseAlternatives[] = [
      {
        startWordIndex: 0,
        endWordIndex: 1,
        candidates: [{ text: "Hello world", confidence: 0.9 }],
      },
    ];
    const result = diagnoseLowConfidenceWord(
      { words: WORDS, alternatives: singleCandidate },
      0
    );
    // The range still matches (useful to DIAAT-234), but there is nothing to
    // surface as "also heard".
    expect(result.matchedRange).toEqual({ startWordIndex: 0, endWordIndex: 1 });
    expect(result.alternativeCandidates).toEqual([]);
  });

  it("cannot match a group whose word-range was cleared during a merge", () => {
    const unanchored: PhraseAlternatives[] = [
      {
        // startWordIndex/endWordIndex undefined: alignment lost in a merge.
        candidates: [
          { text: "Hello world", confidence: 0.5 },
          { text: "hello worm", confidence: 0.4 },
        ],
      },
    ];
    const result = diagnoseLowConfidenceWord(
      { words: WORDS, alternatives: unanchored },
      0
    );
    expect(result.matchedRange).toBeNull();
    expect(result.alternativeCandidates).toEqual([]);
  });

  it("returns empty results when the entry has no alternatives at all", () => {
    const result = diagnoseLowConfidenceWord({ words: WORDS }, 1);
    expect(result.matchedRange).toBeNull();
    expect(result.alternativeCandidates).toEqual([]);
  });
});
