import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TranscriptSegment } from "@/components/transcript/transcript-segment";
import type { TranscriptSegment as SegmentType } from "@/lib/types";

const SEGMENT: SegmentType = {
  id: "s1",
  speaker: "Judge",
  speakerColor: "#6d28d9",
  text: "Good morning. We are on the record.",
  startTime: 0,
  duration: 19,
  confidence: 0.98,
  flaggedForReview: false,
};

describe("TranscriptSegment", () => {
  it("renders speaker name", () => {
    render(<TranscriptSegment segment={SEGMENT} />);
    expect(screen.getByText("Judge")).toBeDefined();
  });

  it("renders transcript text", () => {
    render(<TranscriptSegment segment={SEGMENT} />);
    expect(
      screen.getByText("Good morning. We are on the record.")
    ).toBeDefined();
  });

  it("renders confidence percentage", () => {
    render(<TranscriptSegment segment={SEGMENT} />);
    expect(screen.getByText("98% CONF")).toBeDefined();
  });

  it("renders timestamp", () => {
    render(<TranscriptSegment segment={SEGMENT} />);
    expect(screen.getByText("0:00")).toBeDefined();
  });

  it("does not show flagged indicator when not flagged", () => {
    render(<TranscriptSegment segment={SEGMENT} />);
    expect(screen.queryByText(/flagged/i)).toBeNull();
  });

  it("shows flagged indicator when flaggedForReview is true", () => {
    render(
      <TranscriptSegment segment={{ ...SEGMENT, flaggedForReview: true }} />
    );
    expect(screen.getByText(/flagged for clerk review/i)).toBeDefined();
  });

  it("rounds a real-world floating point duration instead of showing raw digits", () => {
    render(
      <TranscriptSegment
        segment={{ ...SEGMENT, duration: 7.159999999999997 }}
      />
    );
    expect(screen.getByText("7s")).toBeDefined();
    expect(screen.queryByText(/7\.159999/)).toBeNull();
  });

  it("calls onSeek with the segment's start time when the timestamp is clicked", async () => {
    const onSeek = vi.fn();
    const user = userEvent.setup();
    render(
      <TranscriptSegment
        segment={{ ...SEGMENT, startTime: 152.6 }}
        onSeek={onSeek}
      />
    );
    await user.click(screen.getByRole("button", { name: "2:32" }));
    expect(onSeek).toHaveBeenCalledWith(152.6);
  });

  it("does not throw when the timestamp is clicked with no onSeek provided", async () => {
    const user = userEvent.setup();
    render(<TranscriptSegment segment={SEGMENT} />);
    await expect(user.click(screen.getByText("0:00"))).resolves.not.toThrow();
  });

  it("shows the corrected text instead of the original when present", () => {
    render(
      <TranscriptSegment
        segment={{
          ...SEGMENT,
          correctedText: "Good morning, we are on the record.",
        }}
      />
    );
    expect(
      screen.getByText("Good morning, we are on the record.")
    ).toBeDefined();
    expect(
      screen.queryByText("Good morning. We are on the record.")
    ).toBeNull();
  });

  it("shows an Edited badge once a segment has been corrected", () => {
    render(
      <TranscriptSegment
        segment={{ ...SEGMENT, correctedText: "Fixed text." }}
      />
    );
    expect(screen.getByText("Edited")).toBeDefined();
  });

  it("does not show an edit button without an onCorrect handler", () => {
    render(<TranscriptSegment segment={SEGMENT} />);
    expect(screen.queryByLabelText(/edit segment text/i)).toBeNull();
  });

  it("lets a user edit and save a correction", async () => {
    const onCorrect = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<TranscriptSegment segment={SEGMENT} onCorrect={onCorrect} />);

    await user.click(screen.getByLabelText(/edit segment text/i));
    const textarea = screen.getByRole("textbox");
    await user.clear(textarea);
    await user.type(textarea, "Corrected wording.");
    await user.click(screen.getByRole("button", { name: /save/i }));

    expect(onCorrect).toHaveBeenCalledWith("Corrected wording.");
  });

  it("cancels editing without calling onCorrect", async () => {
    const onCorrect = vi.fn();
    const user = userEvent.setup();
    render(<TranscriptSegment segment={SEGMENT} onCorrect={onCorrect} />);

    await user.click(screen.getByLabelText(/edit segment text/i));
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onCorrect).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("does not call onCorrect when the text is unchanged", async () => {
    const onCorrect = vi.fn();
    const user = userEvent.setup();
    render(<TranscriptSegment segment={SEGMENT} onCorrect={onCorrect} />);

    await user.click(screen.getByLabelText(/edit segment text/i));
    await user.click(screen.getByRole("button", { name: /save/i }));

    expect(onCorrect).not.toHaveBeenCalled();
  });

  it("applies active playback highlighting when isActive is true", () => {
    const { container } = render(
      <TranscriptSegment segment={SEGMENT} isActive />
    );
    expect(container.querySelector(".border-l-primary")).not.toBeNull();
  });

  // One lexical word per display-text token in SEGMENT.text ("Good",
  // "morning.", "We", "are", "on", "the", "record.") — Azure's per-word
  // array is always lowercase/unpunctuated ("lexical" form), unlike the
  // phrase-level display text these render against, so these use that
  // form even though the rendered text shows the punctuated tokens above.
  const WORDS: SegmentType["words"] = [
    { text: "good", startTime: 0, endTime: 0.5, confidence: 0.97 },
    { text: "morning", startTime: 0.5, endTime: 1.0, confidence: 0.6 },
    { text: "we", startTime: 1.0, endTime: 1.3, confidence: 0.95 },
    { text: "are", startTime: 1.3, endTime: 1.5, confidence: 0.96 },
    { text: "on", startTime: 1.5, endTime: 1.7, confidence: 0.97 },
    { text: "the", startTime: 1.7, endTime: 1.9, confidence: 0.98 },
    { text: "record", startTime: 1.9, endTime: 2.4, confidence: 0.95 },
  ];

  it("renders word-by-word when word-level data is available", () => {
    render(<TranscriptSegment segment={{ ...SEGMENT, words: WORDS }} />);
    expect(screen.getByText("morning", { exact: false })).toBeDefined();
  });

  function wordsParagraph(container: HTMLElement) {
    const p = Array.from(container.querySelectorAll("p")).find((el) =>
      el.textContent?.includes("Good")
    );
    if (!p) throw new Error("words paragraph not found");
    return p;
  }

  it("highlights a low-confidence word", () => {
    const { container } = render(
      <TranscriptSegment segment={{ ...SEGMENT, words: WORDS }} />
    );
    const lowConfWord = Array.from(
      wordsParagraph(container).querySelectorAll("span")
    ).find((el) => el.textContent?.trim() === "morning.");
    expect(lowConfWord?.className).toContain("bg-orange-100");
  });

  it("does not flag a high-confidence word as low-confidence", () => {
    const { container } = render(
      <TranscriptSegment segment={{ ...SEGMENT, words: WORDS }} />
    );
    const goodWord = Array.from(
      wordsParagraph(container).querySelectorAll("span")
    ).find((el) => el.textContent?.trim() === "Good");
    expect(goodWord?.className).not.toContain("bg-orange-100");
  });

  it("highlights the word matching the current playback position", async () => {
    const { container } = render(
      <TranscriptSegment
        segment={{ ...SEGMENT, words: WORDS }}
        isActive
        getCurrentTime={() => 1.2}
      />
    );
    // The highlight is driven by a requestAnimationFrame loop (polling
    // real playback position instead of the coarser timeupdate event),
    // so it needs at least one frame to run before asserting. 1.2s falls
    // within "we"'s 1.0-1.3 range.
    await waitFor(() => {
      const spokenWord = Array.from(
        wordsParagraph(container).querySelectorAll("span")
      ).find((el) => el.textContent?.trim() === "We");
      expect(spokenWord?.className).toContain("bg-primary/30");
    });
  });

  it("falls back to plain text once the segment has been corrected, even with word data present", () => {
    render(
      <TranscriptSegment
        segment={{
          ...SEGMENT,
          words: WORDS,
          correctedText: "Good morning, Judge.",
        }}
      />
    );
    expect(screen.getByText("Good morning, Judge.")).toBeDefined();
  });

  describe("low-confidence word-range editing", () => {
    // "morning" (index 1) is the only low-confidence word in WORDS, so it
    // forms its own single-word run.
    it("is clickable when onCorrectRange is provided", () => {
      const { container } = render(
        <TranscriptSegment
          segment={{ ...SEGMENT, words: WORDS }}
          onCorrectRange={vi.fn()}
        />
      );
      const run = Array.from(
        wordsParagraph(container).querySelectorAll('[role="button"]')
      ).find((el) => el.textContent?.includes("morning"));
      expect(run).toBeDefined();
    });

    it("is not interactive when no onCorrectRange handler is provided", () => {
      const { container } = render(
        <TranscriptSegment segment={{ ...SEGMENT, words: WORDS }} />
      );
      const run = Array.from(
        wordsParagraph(container).querySelectorAll('[role="button"]')
      ).find((el) => el.textContent?.includes("morning"));
      expect(run).toBeUndefined();
    });

    it("prevents the default Space action so the page doesn't scroll on activation", () => {
      const { container } = render(
        <TranscriptSegment
          segment={{ ...SEGMENT, words: WORDS }}
          onCorrectRange={vi.fn()}
        />
      );
      const run = Array.from(
        wordsParagraph(container).querySelectorAll('[role="button"]')
      ).find((el) => el.textContent?.includes("morning"));
      const notCancelled = fireEvent.keyDown(run as Element, { key: " " });
      expect(notCancelled).toBe(false);
    });

    it("opens an inline editor pre-filled with just the run's text", async () => {
      const user = userEvent.setup();
      const { container } = render(
        <TranscriptSegment
          segment={{ ...SEGMENT, words: WORDS }}
          onCorrectRange={vi.fn()}
        />
      );
      const run = Array.from(
        wordsParagraph(container).querySelectorAll('[role="button"]')
      ).find((el) => el.textContent?.includes("morning"));
      await user.click(run as Element);

      // Includes the trailing period, since it's part of the display
      // token being edited — a minor trade-off of editing display text
      // rather than the unpunctuated lexical word.
      const input = screen.getByRole("textbox") as HTMLInputElement;
      expect(input.value).toBe("morning.");
    });

    it("saves the run's own word-range, not the whole segment text", async () => {
      const onCorrectRange = vi.fn().mockResolvedValue(undefined);
      const user = userEvent.setup();
      const { container } = render(
        <TranscriptSegment
          segment={{ ...SEGMENT, words: WORDS }}
          onCorrectRange={onCorrectRange}
        />
      );
      const run = Array.from(
        wordsParagraph(container).querySelectorAll('[role="button"]')
      ).find((el) => el.textContent?.includes("morning"));
      await user.click(run as Element);

      const input = screen.getByRole("textbox");
      await user.clear(input);
      await user.type(input, "afternoon");
      await user.click(screen.getByRole("button", { name: /save/i }));

      // "morning" is word index 1 — only that index is corrected, the
      // untouched words never pass through this callback at all.
      expect(onCorrectRange).toHaveBeenCalledWith(1, 1, "afternoon");
    });

    it("cancels without calling onCorrectRange", async () => {
      const onCorrectRange = vi.fn();
      const user = userEvent.setup();
      const { container } = render(
        <TranscriptSegment
          segment={{ ...SEGMENT, words: WORDS }}
          onCorrectRange={onCorrectRange}
        />
      );
      const run = Array.from(
        wordsParagraph(container).querySelectorAll('[role="button"]')
      ).find((el) => el.textContent?.includes("morning"));
      await user.click(run as Element);
      await user.click(screen.getByRole("button", { name: /cancel/i }));

      expect(onCorrectRange).not.toHaveBeenCalled();
      expect(screen.queryByRole("textbox")).toBeNull();
    });
  });

  describe("word_corrections rendering", () => {
    it("keeps other words' confidence highlighting after a phrase is corrected", () => {
      const { container } = render(
        <TranscriptSegment
          segment={{
            ...SEGMENT,
            words: WORDS,
            wordCorrections: [
              { startWordIndex: 1, endWordIndex: 1, text: "afternoon" },
            ],
          }}
        />
      );
      // The corrected word ("morning" -> "afternoon") should no longer show
      // as low-confidence, but "Good" and "Judge" (untouched, high
      // confidence) must still render as plain words, not collapse to a
      // flat paragraph.
      expect(screen.getByText("afternoon", { exact: false })).toBeDefined();
      const lowConf = Array.from(
        wordsParagraph(container).querySelectorAll("span")
      ).find((el) => el.className.includes("bg-orange-100"));
      expect(lowConf).toBeUndefined();
    });

    it("prevents the default Space action on the corrected span", () => {
      render(
        <TranscriptSegment
          segment={{
            ...SEGMENT,
            words: WORDS,
            wordCorrections: [
              { startWordIndex: 1, endWordIndex: 1, text: "afternoon" },
            ],
          }}
          onCorrectRange={vi.fn()}
        />
      );
      const correctedSpan = screen.getByText("afternoon", { exact: false });
      const notCancelled = fireEvent.keyDown(correctedSpan, { key: " " });
      expect(notCancelled).toBe(false);
    });

    it("re-opens the editor pre-filled with the correction's current text", async () => {
      const user = userEvent.setup();
      render(
        <TranscriptSegment
          segment={{
            ...SEGMENT,
            words: WORDS,
            wordCorrections: [
              { startWordIndex: 1, endWordIndex: 1, text: "afternoon" },
            ],
          }}
          onCorrectRange={vi.fn()}
        />
      );
      await user.click(screen.getByText("afternoon", { exact: false }));
      const input = screen.getByRole("textbox") as HTMLInputElement;
      expect(input.value).toBe("afternoon");
    });

    it("does not fall back to plain text when only word_corrections (no corrected_text) are present", () => {
      render(
        <TranscriptSegment
          segment={{
            ...SEGMENT,
            words: WORDS,
            wordCorrections: [
              { startWordIndex: 1, endWordIndex: 1, text: "afternoon" },
            ],
          }}
        />
      );
      expect(
        screen.queryByText("Good morning. We are on the record.")
      ).toBeNull();
    });

    it("merges two corrections that land on the same coarse display token instead of duplicating it", () => {
      // A single display token ("ABCD", no internal whitespace) can span
      // several lexical words. Two distinct, non-overlapping lexical
      // corrections landing inside that same span must render as one
      // merged corrected run, not two overlapping/duplicate-keyed ones.
      const denseWords: SegmentType["words"] = [
        { text: "a", startTime: 0, endTime: 0.1, confidence: 0.9 },
        { text: "b", startTime: 0.1, endTime: 0.2, confidence: 0.9 },
        { text: "c", startTime: 0.2, endTime: 0.3, confidence: 0.9 },
        { text: "d", startTime: 0.3, endTime: 0.4, confidence: 0.9 },
      ];
      const { container } = render(
        <TranscriptSegment
          segment={{
            ...SEGMENT,
            text: "ABCD",
            words: denseWords,
            wordCorrections: [
              { startWordIndex: 0, endWordIndex: 0, text: "X" },
              { startWordIndex: 2, endWordIndex: 2, text: "Y" },
            ],
          }}
        />
      );
      const p = container.querySelector("p");
      if (!p) throw new Error("words paragraph not found");
      const correctedSpans = p.querySelectorAll("span.bg-emerald-100");
      expect(correctedSpans).toHaveLength(1);
      expect(correctedSpans[0].textContent?.trim()).toBe("X Y");
    });
  });

  describe("change history", () => {
    const HISTORY: SegmentType["correctionHistory"] = [
      {
        timestamp: "2026-01-01T00:00:00Z",
        kind: "word_range",
        previousText: "Good morning. We are on the record.",
        newText: "Good afternoon. We are on the record.",
        startWordIndex: 1,
        endWordIndex: 1,
      },
    ];

    it("does not show a history button when there is no history", () => {
      render(<TranscriptSegment segment={SEGMENT} />);
      expect(screen.queryByLabelText(/show change history/i)).toBeNull();
    });

    it("shows a history button and toggles the panel", async () => {
      const user = userEvent.setup();
      render(
        <TranscriptSegment
          segment={{ ...SEGMENT, correctionHistory: HISTORY }}
        />
      );
      expect(screen.queryByText(/change history/i)).toBeNull();
      await user.click(screen.getByLabelText(/show change history/i));
      expect(screen.getByText(/change history/i)).toBeDefined();
    });

    it("calls onRollbackToHistory with the entry's index", async () => {
      const onRollbackToHistory = vi.fn().mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(
        <TranscriptSegment
          segment={{ ...SEGMENT, correctionHistory: HISTORY }}
          onRollbackToHistory={onRollbackToHistory}
        />
      );
      await user.click(screen.getByLabelText(/show change history/i));
      await user.click(
        screen.getByRole("button", { name: /roll back to before this/i })
      );
      expect(onRollbackToHistory).toHaveBeenCalledWith(0);
    });

    it("calls onRollback for a whole-section rollback", async () => {
      const onRollback = vi.fn().mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(
        <TranscriptSegment
          segment={{
            ...SEGMENT,
            correctedText: "Good afternoon. We are on the record.",
            correctionHistory: HISTORY,
          }}
          onRollback={onRollback}
        />
      );
      await user.click(screen.getByLabelText(/show change history/i));
      await user.click(
        screen.getByRole("button", { name: /roll back whole section/i })
      );
      expect(onRollback).toHaveBeenCalled();
    });

    it("highlights the corresponding word range while hovering a history entry", async () => {
      const user = userEvent.setup();
      const { container } = render(
        <TranscriptSegment
          segment={{ ...SEGMENT, words: WORDS, correctionHistory: HISTORY }}
        />
      );
      await user.click(screen.getByLabelText(/show change history/i));

      // "morning." is low-confidence, so it's nested inside an outer orange
      // wrapper span — query the inner (leaf) word span specifically.
      const morningWord = Array.from(
        wordsParagraph(container).querySelectorAll("span span")
      ).find((el) => el.textContent?.trim() === "morning.");
      expect(morningWord?.className).not.toContain("ring-amber-500");

      const historyItem = screen.getByText(/phrase correction/i).closest("li");
      await user.hover(historyItem as Element);
      expect(morningWord?.className).toContain("ring-amber-500");

      await user.unhover(historyItem as Element);
      expect(morningWord?.className).not.toContain("ring-amber-500");
    });
  });
});
