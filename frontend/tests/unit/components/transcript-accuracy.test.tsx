import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TranscriptAccuracy } from "@/components/transcript/transcript-accuracy";
import type { TranscriptAccuracy as AccuracyType } from "@/lib/types";

describe("TranscriptAccuracy", () => {
  it("shows a confidence score, not WER, before any corrections exist", () => {
    const accuracy: AccuracyType = {
      confidenceScore: 94.2,
      wordsTranscribed: 2284,
      lowConfidenceCount: 6,
      confidenceThreshold: 85,
      hasCorrections: false,
      hasBaseline: false,
    };
    render(<TranscriptAccuracy accuracy={accuracy} />);

    expect(screen.getByText("Transcript confidence")).toBeDefined();
    expect(screen.getByText("94%")).toBeDefined();
    expect(screen.queryByText(/word error rate/i)).toBeNull();
  });

  it("shows the real word error rate once corrections exist", () => {
    const accuracy: AccuracyType = {
      confidenceScore: 94.2,
      wordsTranscribed: 2284,
      lowConfidenceCount: 6,
      confidenceThreshold: 85,
      hasCorrections: true,
      wordErrorRate: 4.7,
      correctedPercent: 12,
      hasBaseline: false,
    };
    render(<TranscriptAccuracy accuracy={accuracy} />);

    expect(screen.getByText("Transcript accuracy")).toBeDefined();
    expect(screen.getByText("Word error rate (WER)")).toBeDefined();
    expect(screen.getByText("4.7%")).toBeDefined();
    expect(screen.getByText(/12% of segments reviewed/)).toBeDefined();
  });

  it("shows words transcribed and low-confidence count", () => {
    const accuracy: AccuracyType = {
      confidenceScore: 94.2,
      wordsTranscribed: 2284,
      lowConfidenceCount: 6,
      confidenceThreshold: 85,
      hasCorrections: false,
      hasBaseline: false,
    };
    render(<TranscriptAccuracy accuracy={accuracy} />);

    expect(screen.getByText("2,284")).toBeDefined();
    expect(screen.getByText(/6 segments below 85% confidence/)).toBeDefined();
  });

  it("shows an upload prompt and no baseline WER before a baseline is uploaded", () => {
    const accuracy: AccuracyType = {
      confidenceScore: 94.2,
      wordsTranscribed: 2284,
      lowConfidenceCount: 6,
      confidenceThreshold: 85,
      hasCorrections: false,
      hasBaseline: false,
    };
    render(
      <TranscriptAccuracy accuracy={accuracy} onUploadBaseline={vi.fn()} />
    );

    expect(screen.queryByText(/baseline wer/i)).toBeNull();
    expect(
      screen.getByRole("button", { name: /upload baseline transcript/i })
    ).toBeDefined();
  });

  it("shows the baseline WER, distinguished from correction-based WER, once uploaded", () => {
    const accuracy: AccuracyType = {
      confidenceScore: 94.2,
      wordsTranscribed: 2284,
      lowConfidenceCount: 6,
      confidenceThreshold: 85,
      hasCorrections: true,
      wordErrorRate: 4.7,
      correctedPercent: 12,
      hasBaseline: true,
      baselineWordErrorRate: 8.3,
    };
    render(
      <TranscriptAccuracy accuracy={accuracy} onUploadBaseline={vi.fn()} />
    );

    expect(screen.getByText("Baseline WER")).toBeDefined();
    expect(screen.getByText("8.3%")).toBeDefined();
    // Both WER numbers are visible at once, and the copy should make clear
    // they're different, independent measurements rather than duplicates.
    expect(screen.getByText("4.7%")).toBeDefined();
    expect(
      screen.getByText(/independent of the correction-based wer/i)
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: /replace baseline transcript/i })
    ).toBeDefined();
  });

  it("uploads the selected file and surfaces errors", async () => {
    const accuracy: AccuracyType = {
      confidenceScore: 94.2,
      wordsTranscribed: 2284,
      lowConfidenceCount: 6,
      confidenceThreshold: 85,
      hasCorrections: false,
      hasBaseline: false,
    };
    const onUploadBaseline = vi.fn().mockRejectedValue(new Error("boom"));
    render(
      <TranscriptAccuracy
        accuracy={accuracy}
        onUploadBaseline={onUploadBaseline}
      />
    );

    const input = screen.getByLabelText(
      /baseline transcript file input/i
    ) as HTMLInputElement;
    const file = new File(["reference text"], "baseline.txt", {
      type: "text/plain",
    });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(onUploadBaseline).toHaveBeenCalledWith(file));
    await waitFor(() =>
      expect(
        screen.getByText(/failed to upload baseline transcript/i)
      ).toBeDefined()
    );
  });
});
