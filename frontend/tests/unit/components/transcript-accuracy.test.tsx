import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
    };
    render(<TranscriptAccuracy accuracy={accuracy} />);

    expect(screen.getByText("2,284")).toBeDefined();
    expect(screen.getByText(/6 segments below 85% confidence/)).toBeDefined();
  });
});
