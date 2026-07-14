import { describe, expect, it } from "vitest";
import type { Word } from "@/lib/types";
import {
  alignWordsToDisplayTokens,
  displayRangeForWordRange,
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
    // Pessimistic (min) confidence across the whole merged span.
    expect(tokens[0].confidence).toBe(0.4);
    expect(tokens[0].startTime).toBe(0);
    expect(tokens[0].endTime).toBe(4);
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
