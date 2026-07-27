import { describe, expect, it } from "vitest";
import type { Word } from "@/lib/types";
import {
  alignWordsToDisplayTokens,
  displayRangeForWordRange,
  estimateLexicalWeight,
  tokenizeDisplayText,
} from "@/lib/word-alignment";

function word(
  text: string,
  confidence: number,
  start: number,
  end: number
): Word {
  return { text, confidence, startTime: start, endTime: end };
}

describe("tokenizeDisplayText", () => {
  it("splits on whitespace", () => {
    expect(tokenizeDisplayText("Good morning, Judge.")).toEqual([
      "Good",
      "morning,",
      "Judge.",
    ]);
  });

  it("collapses repeated whitespace and trims", () => {
    expect(tokenizeDisplayText("  a   b  ")).toEqual(["a", "b"]);
  });

  it("returns an empty array for blank text", () => {
    expect(tokenizeDisplayText("   ")).toEqual([]);
  });
});

describe("alignWordsToDisplayTokens", () => {
  it("maps one-to-one when word counts match", () => {
    const words = [
      word("good", 0.9, 0, 0.2),
      word("morning", 0.8, 0.2, 0.6),
      word("judge", 0.95, 0.6, 1.0),
    ];
    const tokens = alignWordsToDisplayTokens("Good morning Judge", words);
    expect(tokens.map((t) => t.text)).toEqual(["Good", "morning", "Judge"]);
    expect(tokens.map((t) => [t.startWordIndex, t.endWordIndex])).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
    ]);
    expect(tokens[1].confidence).toBe(0.8);
    expect(tokens[0].startTime).toBe(0);
    expect(tokens[2].endTime).toBe(1.0);
  });

  it("proportionally spans multiple lexical words under one merged display token", () => {
    // "PA/04471/2026" (1 display token) <- 11 lexical words in reality;
    // use a smaller example that's easy to reason about by hand.
    const words = [
      word("pa", 0.6, 0, 1),
      word("slash", 0.4, 1, 2),
      word("zero", 0.7, 2, 3),
      word("four", 0.9, 3, 4),
    ];
    const tokens = alignWordsToDisplayTokens("PA/0four", words);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].startWordIndex).toBe(0);
    expect(tokens[0].endWordIndex).toBe(3);
    // Mean confidence across the whole merged span (DIAAT-249): the one weak
    // sub-word (0.4) no longer drags the token down to the old min of 0.4.
    // (0.6 + 0.4 + 0.7 + 0.9) / 4 = 0.65.
    expect(tokens[0].confidence).toBeCloseTo(0.65, 5);
    expect(tokens[0].startTime).toBe(0);
    expect(tokens[0].endTime).toBe(4);
  });

  it("averages sub-word confidence so one weak sub-word doesn't flag a multi-word token (DIAAT-249)", () => {
    // A compressed reference token mapping to several lexical words, mostly
    // confident with a single dip. Under the old MIN aggregation the token's
    // confidence was 0.5 (below a 0.65 threshold) and it lit up as a false
    // positive; the mean stays well above the threshold, so it is NOT flagged.
    const words = [
      word("pa", 0.95, 0, 1),
      word("slash", 0.9, 1, 2),
      word("zero", 0.5, 2, 3), // lone weak sub-word
      word("four", 0.92, 3, 4),
      word("seven", 0.88, 4, 5),
    ];
    const tokens = alignWordsToDisplayTokens("PA/0475", words);
    expect(tokens).toHaveLength(1);
    // mean = (0.95 + 0.9 + 0.5 + 0.92 + 0.88) / 5 = 0.83.
    expect(tokens[0].confidence).toBeCloseTo(0.83, 5);
    expect(tokens[0].confidence).toBeGreaterThan(0.65);
  });

  it("still flags a broadly-uncertain multi-word token (mean below threshold) (DIAAT-249)", () => {
    // When most sub-words are weak, the mean stays below the threshold, so a
    // genuinely uncertain reference remains highlighted for review.
    const words = [
      word("pa", 0.5, 0, 1),
      word("slash", 0.55, 1, 2),
      word("zero", 0.6, 2, 3),
      word("four", 0.62, 3, 4),
    ];
    const tokens = alignWordsToDisplayTokens("PA/04", words);
    expect(tokens).toHaveLength(1);
    // mean = (0.5 + 0.55 + 0.6 + 0.62) / 4 = 0.5675.
    expect(tokens[0].confidence).toBeCloseTo(0.5675, 5);
    expect(tokens[0].confidence).toBeLessThan(0.65);
  });

  it("leaves a single low-confidence word unchanged (still below threshold) (DIAAT-249)", () => {
    // A one-to-one token: mean == that word's confidence, so genuinely low
    // single words still flag (no recall regression on the clear cases).
    const words = [word("good", 0.9, 0, 0.2), word("morning", 0.6, 0.2, 0.6)];
    const tokens = alignWordsToDisplayTokens("Good morning", words);
    expect(tokens[1].confidence).toBe(0.6);
    expect(tokens[1].confidence).toBeLessThan(0.65);
  });

  it("distributes lexical words across display tokens proportionally, covering all of them", () => {
    const words = Array.from({ length: 9 }, (_, i) =>
      word(`w${i}`, 0.9, i, i + 1)
    );
    const tokens = alignWordsToDisplayTokens("a b c", words);
    expect(tokens).toHaveLength(3);
    // 9 words / 3 tokens = 3 each, evenly.
    expect(tokens.map((t) => [t.startWordIndex, t.endWordIndex])).toEqual([
      [0, 2],
      [3, 5],
      [6, 8],
    ]);
  });

  it("covers every lexical word exactly once with no gaps across an uneven split", () => {
    const words = Array.from({ length: 7 }, (_, i) =>
      word(`w${i}`, 0.9, i, i + 1)
    );
    const tokens = alignWordsToDisplayTokens("a b c", words);
    expect(tokens[0].startWordIndex).toBe(0);
    expect(tokens[tokens.length - 1].endWordIndex).toBe(6);
    for (let i = 1; i < tokens.length; i++) {
      expect(tokens[i].startWordIndex).toBe(tokens[i - 1].endWordIndex + 1);
    }
  });

  it("returns an empty array when there are no words or no display text", () => {
    expect(alignWordsToDisplayTokens("", [word("a", 0.9, 0, 1)])).toEqual([]);
    expect(alignWordsToDisplayTokens("hello", [])).toEqual([]);
  });

  it("collapses excess display tokens instead of handing out duplicate word ranges", () => {
    // Unusual: more display tokens than lexical words. Without collapsing,
    // several distinct tokens would all map to word range [0,0].
    const words = [word("a", 0.9, 0, 1)];
    const tokens = alignWordsToDisplayTokens("one two three", words);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].text).toBe("one two three");
    expect(tokens[0].startWordIndex).toBe(0);
    expect(tokens[0].endWordIndex).toBe(0);
  });

  it("collapses only the excess when tokens outnumber words by more than one", () => {
    const words = [word("a", 0.9, 0, 1), word("b", 0.8, 1, 2)];
    const tokens = alignWordsToDisplayTokens("one two three four", words);
    expect(tokens).toHaveLength(2);
    expect(tokens[0].text).toBe("one");
    expect(tokens[1].text).toBe("two three four");
  });
});

describe("estimateLexicalWeight", () => {
  it("maps an ordinary lowercase word to ~1", () => {
    expect(estimateLexicalWeight("before")).toBe(1);
    expect(estimateLexicalWeight("reference")).toBe(1);
  });

  it("counts each uppercase letter of an acronym as a spoken word", () => {
    expect(estimateLexicalWeight("PA")).toBe(2);
  });

  it("counts each digit as a spoken word", () => {
    expect(estimateLexicalWeight("05217")).toBe(5);
  });

  it("sums digits, symbols and uppercase letters for a case reference", () => {
    // "PA/05217/2025" -> "p a slash zero five two one seven slash twenty
    // twenty five": PA=2, /=1, 05217=5, /=1, 2025=4 => 13.
    expect(estimateLexicalWeight("PA/05217/2025")).toBe(13);
  });

  it("treats a lowercase word as one spoken word", () => {
    expect(estimateLexicalWeight("tribunal")).toBe(1);
  });

  it("treats a title-case word as one spoken word (leading capital only)", () => {
    expect(estimateLexicalWeight("Before")).toBe(1);
  });

  it("ignores non-spoken punctuation so ordinary prose isn't inflated", () => {
    // A trailing period / comma is not a spoken lexical word, and a single
    // leading capital is just title case — so these stay at weight 1 and
    // don't skew the distribution of a normal sentence (DIAAT-242 review).
    expect(estimateLexicalWeight("Judge.")).toBe(1);
    expect(estimateLexicalWeight("morning,")).toBe(1);
    expect(estimateLexicalWeight("(hearing)")).toBe(1);
  });

  it("counts only the spoken separators / . - :", () => {
    expect(estimateLexicalWeight("a/b")).toBe(1); // "/" spoken: 0 + 1 => max(1,1)
    expect(estimateLexicalWeight("9-5")).toBe(3); // 9, -, 5
    expect(estimateLexicalWeight("10:30")).toBe(5); // 1,0,:,3,0
  });
});

describe("alignWordsToDisplayTokens drift regression (DIAAT-242)", () => {
  it("keeps tokens after a case reference near the tail instead of drifting ahead", () => {
    // Reported scenario: a segment carrying a case reference number. The
    // display token "PA/05217/2025" expands to many spoken lexical words, so
    // the tokens that FOLLOW it must map to the tail of the lexical stream —
    // not to the number's earlier words.
    //
    // Old uniform-index bucketing: 5 display tokens over 16 lexical words gave
    // "before" (index 2) the range words 6-8 (the digits "two one seven"),
    // lighting its highlight up early and staying ahead for the rest of the
    // segment. Weighted distribution pushes "before" out to words ~11+.
    const lexical = [
      "reference",
      "p",
      "a",
      "slash",
      "zero",
      "five",
      "two",
      "one",
      "seven",
      "slash",
      "twenty",
      "twenty",
      "five",
      "before",
      "the",
      "tribunal",
    ];
    const words = lexical.map((text, i) => word(text, 0.9, i, i + 1));
    const tokens = alignWordsToDisplayTokens(
      "reference PA/05217/2025 before the tribunal",
      words
    );

    const byText = (t: string) => tokens.find((tok) => tok.text === t);
    const ref = byText("PA/05217/2025");
    const before = byText("before");
    if (!(ref && before)) throw new Error("expected tokens not found");

    // (a) the case reference spans a wide lexical range.
    expect(ref.endWordIndex - ref.startWordIndex).toBeGreaterThanOrEqual(7);

    // (b) "before" maps near the tail, far past the old buggy value of 6.
    expect(before.startWordIndex).toBeGreaterThanOrEqual(9);

    // (c) token startTimes are non-decreasing across the whole segment.
    for (let i = 1; i < tokens.length; i++) {
      expect(tokens[i].startTime).toBeGreaterThanOrEqual(
        tokens[i - 1].startTime
      );
    }
  });
});

describe("alignWordsToDisplayTokens weighted invariants", () => {
  it("keeps ranges contiguous and covering all words for a mixed-weight case", () => {
    const words = Array.from({ length: 20 }, (_, i) =>
      word(`w${i}`, 0.9, i, i + 1)
    );
    const tokens = alignWordsToDisplayTokens("hi PA/05217/2025 ok", words);

    expect(tokens[0].startWordIndex).toBe(0);
    expect(tokens[tokens.length - 1].endWordIndex).toBe(19);
    for (const t of tokens) {
      expect(t.startWordIndex).toBeLessThanOrEqual(t.endWordIndex);
    }
    for (let i = 1; i < tokens.length; i++) {
      expect(tokens[i].startWordIndex).toBe(tokens[i - 1].endWordIndex + 1);
    }
  });
});

describe("displayRangeForWordRange", () => {
  const words = Array.from({ length: 9 }, (_, i) =>
    word(`w${i}`, 0.9, i, i + 1)
  );
  const tokens = alignWordsToDisplayTokens("a b c", words); // [0,2] [3,5] [6,8]

  it("finds the single display token exactly covering a lexical range", () => {
    expect(displayRangeForWordRange(tokens, 3, 5)).toEqual({
      start: 1,
      end: 1,
    });
  });

  it("finds a span of display tokens when the lexical range crosses token boundaries", () => {
    expect(displayRangeForWordRange(tokens, 2, 4)).toEqual({
      start: 0,
      end: 1,
    });
  });

  it("returns null when the range is out of bounds", () => {
    expect(displayRangeForWordRange(tokens, 100, 101)).toBeNull();
  });
});
