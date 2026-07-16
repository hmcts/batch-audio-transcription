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

  // DIAAT-235: the highlight threshold was lowered from 0.85 to 0.65 so
  // correct-but-imperfectly-confident common words stop being flagged,
  // while genuinely uncertain words still are.
  it("does not flag a word between the old (0.85) and new (0.65) threshold as low-confidence", () => {
    const wordsWithMidConfidence: SegmentType["words"] = WORDS.map((w) =>
      w.text === "morning" ? { ...w, confidence: 0.75 } : w
    );
    const { container } = render(
      <TranscriptSegment
        segment={{ ...SEGMENT, words: wordsWithMidConfidence }}
      />
    );
    const word = Array.from(
      wordsParagraph(container).querySelectorAll("span")
    ).find((el) => el.textContent?.trim() === "morning.");
    expect(word?.className).not.toContain("bg-orange-100");
  });

  it("still flags a word below the new 0.65 threshold as low-confidence", () => {
    const wordsWithLowConfidence: SegmentType["words"] = WORDS.map((w) =>
      w.text === "morning" ? { ...w, confidence: 0.5 } : w
    );
    const { container } = render(
      <TranscriptSegment
        segment={{ ...SEGMENT, words: wordsWithLowConfidence }}
      />
    );
    const word = Array.from(
      wordsParagraph(container).querySelectorAll("span")
    ).find((el) => el.textContent?.trim() === "morning.");
    expect(word?.className).toContain("bg-orange-100");
  });

  // DIAAT-235: the per-word highlight cutoff follows the backend-derived
  // threshold (passed as a 0-1 ratio) so highlights stay consistent with the
  // "needs review" list even when ops override the threshold.
  it("respects an explicit lowConfidenceThreshold prop over the default", () => {
    // "morning" is 0.6 — below the default 0.65 (would normally highlight),
    // but a 0.5 override should leave it un-highlighted.
    const wordsMid: SegmentType["words"] = WORDS.map((w) =>
      w.text === "morning" ? { ...w, confidence: 0.6 } : w
    );
    const { container } = render(
      <TranscriptSegment
        segment={{ ...SEGMENT, words: wordsMid }}
        lowConfidenceThreshold={0.5}
      />
    );
    const word = Array.from(
      wordsParagraph(container).querySelectorAll("span")
    ).find((el) => el.textContent?.trim() === "morning.");
    expect(word?.className).not.toContain("bg-orange-100");
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
            // Deliberately out of lexical order — the backend's
            // word_corrections array isn't guaranteed sorted, so the merge
            // must still produce "X Y" (not "Y X") by ordering on
            // wordStart rather than array/display order.
            wordCorrections: [
              { startWordIndex: 2, endWordIndex: 2, text: "Y" },
              { startWordIndex: 0, endWordIndex: 0, text: "X" },
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

  describe("accept as-is", () => {
    // A low-confidence segment (< 85%) that hasn't been edited — the only
    // state in which the accept control is offered.
    const LOW_CONF: SegmentType = {
      ...SEGMENT,
      confidence: 0.5,
      words: WORDS,
    };

    it("does not show an accept button without an onAccept handler", () => {
      render(<TranscriptSegment segment={LOW_CONF} />);
      expect(screen.queryByLabelText(/accept segment as-is/i)).toBeNull();
    });

    it("shows an accept button for a low-confidence, uncorrected segment", () => {
      render(<TranscriptSegment segment={LOW_CONF} onAccept={vi.fn()} />);
      expect(screen.getByLabelText(/accept segment as-is/i)).toBeDefined();
    });

    it("does not offer accept for a high-confidence segment", () => {
      render(
        <TranscriptSegment
          segment={{ ...SEGMENT, confidence: 0.98, words: WORDS }}
          onAccept={vi.fn()}
        />
      );
      expect(screen.queryByLabelText(/accept segment as-is/i)).toBeNull();
    });

    it("does not offer accept once the segment has been corrected", () => {
      render(
        <TranscriptSegment
          segment={{ ...LOW_CONF, correctedText: "fixed text" }}
          onAccept={vi.fn()}
        />
      );
      expect(screen.queryByLabelText(/accept segment as-is/i)).toBeNull();
    });

    it("does not offer accept once the segment has already been accepted", () => {
      render(
        <TranscriptSegment
          segment={{ ...LOW_CONF, accepted: true }}
          onAccept={vi.fn()}
        />
      );
      expect(screen.queryByLabelText(/accept segment as-is/i)).toBeNull();
    });

    it("calls onAccept when the accept button is clicked", async () => {
      const onAccept = vi.fn().mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(<TranscriptSegment segment={LOW_CONF} onAccept={onAccept} />);
      await user.click(screen.getByLabelText(/accept segment as-is/i));
      expect(onAccept).toHaveBeenCalledTimes(1);
    });

    it("shows an Accepted badge and clears low-confidence highlighting once accepted", () => {
      const { container } = render(
        <TranscriptSegment
          segment={{ ...LOW_CONF, accepted: true }}
          onAccept={vi.fn()}
        />
      );
      expect(screen.getByText(/^Accepted$/)).toBeDefined();
      // "morning." was the low-confidence word — after accepting it must no
      // longer carry the orange highlight, without its text being altered.
      const morningWord = Array.from(
        wordsParagraph(container).querySelectorAll("span")
      ).find((el) => el.textContent?.trim() === "morning.");
      expect(morningWord).toBeDefined();
      expect(morningWord?.className ?? "").not.toContain("bg-orange-100");
    });

    it("still highlights low-confidence words before acceptance", () => {
      const { container } = render(
        <TranscriptSegment segment={LOW_CONF} onAccept={vi.fn()} />
      );
      const morningWord = Array.from(
        wordsParagraph(container).querySelectorAll("span")
      ).find((el) => el.textContent?.trim() === "morning.");
      expect(morningWord?.className).toContain("bg-orange-100");
    });
  });

  describe("low-confidence hover popup (DIAAT-233)", () => {
    // "morning" (index 1, confidence 0.6) is the low-confidence word.
    // The alternatives group covers the whole phrase and offers one
    // alternate reading beyond the top choice.
    const WITH_ALTERNATIVES: SegmentType = {
      ...SEGMENT,
      words: WORDS,
      alternatives: [
        {
          startWordIndex: 0,
          endWordIndex: 6,
          candidates: [
            { text: "Good morning. We are on the record." },
            { text: "Good mourning. We are on the record.", confidence: 0.48 },
          ],
        },
      ],
    };

    function lowConfidenceRun(container: HTMLElement) {
      const run = Array.from(
        wordsParagraph(container).querySelectorAll("span")
      ).find(
        (el) =>
          el.className.includes("bg-orange-100") &&
          el.textContent?.includes("morning")
      );
      if (!run) throw new Error("low-confidence run not found");
      return run;
    }

    it("does not render the popup until the word is hovered", () => {
      const { container } = render(
        <TranscriptSegment
          segment={WITH_ALTERNATIVES}
          onCorrectRange={vi.fn()}
        />
      );
      expect(container.querySelector('[role="tooltip"]')).toBeNull();
    });

    it("shows the word's confidence score on hover", async () => {
      const user = userEvent.setup();
      const { container } = render(
        <TranscriptSegment
          segment={WITH_ALTERNATIVES}
          onCorrectRange={vi.fn()}
        />
      );
      await user.hover(lowConfidenceRun(container));
      const popup = screen.getByRole("tooltip");
      expect(popup.textContent).toMatch(/60%/);
    });

    it("shows alternate readings Azure also heard on hover", async () => {
      const user = userEvent.setup();
      const { container } = render(
        <TranscriptSegment
          segment={WITH_ALTERNATIVES}
          onCorrectRange={vi.fn()}
        />
      );
      await user.hover(lowConfidenceRun(container));
      expect(screen.getByText(/azure also heard/i)).toBeDefined();
      expect(screen.getByText(/Good mourning/)).toBeDefined();
      expect(screen.getByText("48%")).toBeDefined();
    });

    it("dismisses the popup cleanly on mouse-out", async () => {
      const user = userEvent.setup();
      const { container } = render(
        <TranscriptSegment
          segment={WITH_ALTERNATIVES}
          onCorrectRange={vi.fn()}
        />
      );
      const run = lowConfidenceRun(container);
      await user.hover(run);
      expect(screen.getByRole("tooltip")).toBeDefined();
      await user.unhover(run);
      expect(screen.queryByRole("tooltip")).toBeNull();
    });

    it("degrades gracefully when the word has no alternative data", async () => {
      const user = userEvent.setup();
      // WORDS has per-word confidence but no alternatives at all.
      const { container } = render(
        <TranscriptSegment
          segment={{ ...SEGMENT, words: WORDS }}
          onCorrectRange={vi.fn()}
        />
      );
      await user.hover(lowConfidenceRun(container));
      const popup = screen.getByRole("tooltip");
      // Still shows the confidence and a short explanation, not an empty popup.
      expect(popup.textContent).toMatch(/60%/);
      expect(
        screen.getByText(/suggested no alternative readings/i)
      ).toBeDefined();
      expect(screen.queryByText(/azure also heard/i)).toBeNull();
    });

    it("takes no action on hover — the inline editor never opens", async () => {
      const onCorrectRange = vi.fn();
      const user = userEvent.setup();
      const { container } = render(
        <TranscriptSegment
          segment={WITH_ALTERNATIVES}
          onCorrectRange={onCorrectRange}
        />
      );
      await user.hover(lowConfidenceRun(container));
      expect(screen.queryByRole("textbox")).toBeNull();
      expect(onCorrectRange).not.toHaveBeenCalled();
    });

    it("opens the resolve menu on click (DIAAT-234), from which Edit is reachable", async () => {
      const user = userEvent.setup();
      const { container } = render(
        <TranscriptSegment
          segment={WITH_ALTERNATIVES}
          onCorrectRange={vi.fn()}
        />
      );
      const run = lowConfidenceRun(container);
      await user.hover(run);
      // With alternatives present, click now opens the resolve menu rather
      // than the inline editor directly. The editor is one step away via Edit.
      await user.click(run);
      expect(screen.queryByRole("textbox")).toBeNull();
      await user.click(screen.getByRole("menuitem", { name: /edit/i }));
      expect(screen.getByRole("textbox")).toBeDefined();
    });

    it("shows the popup on keyboard focus and links it via aria-describedby", () => {
      const { container } = render(
        <TranscriptSegment
          segment={WITH_ALTERNATIVES}
          onCorrectRange={vi.fn()}
        />
      );
      const run = lowConfidenceRun(container);
      fireEvent.focus(run);
      const popup = screen.getByRole("tooltip");
      // The focused element describes itself with the popup, and focus stays
      // on the run itself — the popup is not focusable, so it can't trap focus.
      expect(run.getAttribute("aria-describedby")).toBe(popup.id);
      expect(popup.querySelector("[tabindex]")).toBeNull();
      fireEvent.blur(run);
      expect(screen.queryByRole("tooltip")).toBeNull();
    });
  });

  describe("click-to-resolve menu (DIAAT-234)", () => {
    // "morning" (index 1, confidence 0.6) is the low-confidence word. The
    // alternatives group covers the whole phrase (words 0-6) and offers one
    // alternate reading beyond the top choice.
    const WITH_ALTERNATIVES: SegmentType = {
      ...SEGMENT,
      words: WORDS,
      alternatives: [
        {
          startWordIndex: 0,
          endWordIndex: 6,
          candidates: [
            { text: "Good morning. We are on the record." },
            { text: "Good mourning. We are on the record.", confidence: 0.48 },
          ],
        },
      ],
    };

    function lowConfidenceRun(container: HTMLElement) {
      const run = Array.from(
        wordsParagraph(container).querySelectorAll("span")
      ).find(
        (el) =>
          el.className.includes("bg-orange-100") &&
          el.textContent?.includes("morning")
      );
      if (!run) throw new Error("low-confidence run not found");
      return run;
    }

    it("opens a menu with Edit and Suggested options on click", async () => {
      const user = userEvent.setup();
      const { container } = render(
        <TranscriptSegment
          segment={WITH_ALTERNATIVES}
          onCorrectRange={vi.fn()}
        />
      );
      await user.click(lowConfidenceRun(container));
      expect(screen.getByRole("menu", { name: /resolve/i })).toBeDefined();
      expect(screen.getByRole("menuitem", { name: /edit/i })).toBeDefined();
      expect(
        screen.getByRole("menuitem", { name: /suggested/i })
      ).toBeDefined();
    });

    it("Edit from the menu opens the inline editor pre-filled with the run's text", async () => {
      const user = userEvent.setup();
      const { container } = render(
        <TranscriptSegment
          segment={WITH_ALTERNATIVES}
          onCorrectRange={vi.fn()}
        />
      );
      await user.click(lowConfidenceRun(container));
      await user.click(screen.getByRole("menuitem", { name: /edit/i }));
      const input = screen.getByRole("textbox") as HTMLInputElement;
      expect(input.value).toBe("morning.");
    });

    it("lists suggested candidates in Azure's order, never re-sorted by confidence", async () => {
      const user = userEvent.setup();
      // candidates[1:] are, in Azure order, a lower-confidence reading first
      // then a higher-confidence one — a re-sort would flip them.
      const segment: SegmentType = {
        ...SEGMENT,
        words: WORDS,
        alternatives: [
          {
            startWordIndex: 0,
            endWordIndex: 6,
            candidates: [
              { text: "top reading" },
              { text: "first alternate", confidence: 0.3 },
              { text: "second alternate", confidence: 0.7 },
            ],
          },
        ],
      };
      const { container } = render(
        <TranscriptSegment segment={segment} onCorrectRange={vi.fn()} />
      );
      await user.click(lowConfidenceRun(container));
      await user.click(screen.getByRole("menuitem", { name: /suggested/i }));

      const suggestions = screen
        .getByRole("menu", { name: /suggested alternatives/i })
        .querySelectorAll('[role="menuitem"]');
      const texts = Array.from(suggestions).map((el) => el.textContent ?? "");
      expect(texts[0]).toContain("first alternate");
      expect(texts[1]).toContain("second alternate");
      // The current top reading (candidates[0]) is never offered as an option.
      expect(texts.some((t) => t.includes("top reading"))).toBe(false);
    });

    it("applies a chosen candidate as a word-range correction over the phrase range", async () => {
      const onCorrectRange = vi.fn().mockResolvedValue(undefined);
      const user = userEvent.setup();
      const { container } = render(
        <TranscriptSegment
          segment={WITH_ALTERNATIVES}
          onCorrectRange={onCorrectRange}
        />
      );
      await user.click(lowConfidenceRun(container));
      await user.click(screen.getByRole("menuitem", { name: /suggested/i }));
      await user.click(
        screen.getByRole("menuitem", { name: /good mourning/i })
      );

      // The phrase group covers words 0-6, and the whole alternate reading is
      // applied over that range — exactly as typing it into the editor would.
      expect(onCorrectRange).toHaveBeenCalledWith(
        0,
        6,
        "Good mourning. We are on the record."
      );
    });

    it("skips the menu and opens Edit directly when the word has no alternatives", async () => {
      const user = userEvent.setup();
      // WORDS has per-word confidence but no alternatives at all.
      const { container } = render(
        <TranscriptSegment
          segment={{ ...SEGMENT, words: WORDS }}
          onCorrectRange={vi.fn()}
        />
      );
      await user.click(lowConfidenceRun(container));
      // No menu — straight to the inline editor, preserving today's behaviour.
      expect(screen.queryByRole("menu")).toBeNull();
      const input = screen.getByRole("textbox") as HTMLInputElement;
      expect(input.value).toBe("morning.");
    });

    it("dismisses the menu on Escape without taking any action", async () => {
      const onCorrectRange = vi.fn();
      const user = userEvent.setup();
      const { container } = render(
        <TranscriptSegment
          segment={WITH_ALTERNATIVES}
          onCorrectRange={onCorrectRange}
        />
      );
      await user.click(lowConfidenceRun(container));
      expect(screen.getByRole("menu", { name: /resolve/i })).toBeDefined();
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("menu")).toBeNull();
      expect(onCorrectRange).not.toHaveBeenCalled();
      expect(screen.queryByRole("textbox")).toBeNull();
    });

    it("suppresses the informational hover popup while the resolve menu is open", async () => {
      const user = userEvent.setup();
      const { container } = render(
        <TranscriptSegment
          segment={WITH_ALTERNATIVES}
          onCorrectRange={vi.fn()}
        />
      );
      const run = lowConfidenceRun(container);
      await user.hover(run);
      expect(screen.getByRole("tooltip")).toBeDefined();
      await user.click(run);
      // Menu takes over; the tooltip must not linger overlapping it.
      expect(screen.getByRole("menu", { name: /resolve/i })).toBeDefined();
      expect(screen.queryByRole("tooltip")).toBeNull();
    });
  });
});
