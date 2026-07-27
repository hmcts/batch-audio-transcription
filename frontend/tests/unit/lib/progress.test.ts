import { describe, expect, it } from "vitest";
import {
  audioDurationMessage,
  computeElapsedSeconds,
  computeProcessingProgress,
  estimatedProcessingSeconds,
  formatDuration,
} from "@/lib/progress";

describe("formatDuration", () => {
  it("formats hours and minutes together", () => {
    expect(formatDuration(9360)).toBe("2h 36m"); // 2h36m = 9360s, matches the ticket's example
  });

  it("omits minutes when there are none", () => {
    expect(formatDuration(7200)).toBe("2h");
  });

  it("formats minutes only when under an hour", () => {
    expect(formatDuration(2700)).toBe("45m");
  });

  it("rounds to the nearest minute", () => {
    expect(formatDuration(89)).toBe("1m"); // 89s = 1.48m, rounds to nearest -> 1m
  });

  it("shows a friendly message for very short durations", () => {
    expect(formatDuration(10)).toBe("less than a minute");
    expect(formatDuration(0)).toBe("less than a minute");
  });

  it("clamps negative durations to zero", () => {
    expect(formatDuration(-100)).toBe("less than a minute");
  });
});

describe("computeElapsedSeconds", () => {
  it("returns the difference in seconds between now and submittedAt", () => {
    const submittedAt = "2026-07-15T09:00:00Z";
    const now = new Date("2026-07-15T09:10:00Z");
    expect(computeElapsedSeconds(submittedAt, now)).toBe(600);
  });

  it("never returns a negative value", () => {
    const submittedAt = "2026-07-15T09:10:00Z";
    const now = new Date("2026-07-15T09:00:00Z");
    expect(computeElapsedSeconds(submittedAt, now)).toBe(0);
  });

  it("returns 0 for an unparsable timestamp", () => {
    expect(computeElapsedSeconds("not-a-date", new Date())).toBe(0);
  });
});

describe("estimatedProcessingSeconds", () => {
  it("estimates from Azure's ~5x real-time processing rate (audio / 5)", () => {
    // 9360s of audio processes ~5x faster than real time -> 1872s.
    expect(estimatedProcessingSeconds(9360)).toBe(1872);
  });

  it("returns undefined when the audio duration is unknown", () => {
    expect(estimatedProcessingSeconds(undefined)).toBeUndefined();
  });

  it("returns undefined for a non-positive duration", () => {
    expect(estimatedProcessingSeconds(0)).toBeUndefined();
    expect(estimatedProcessingSeconds(-5)).toBeUndefined();
  });
});

describe("computeProcessingProgress", () => {
  it("drives bar and countdown from the same model so they always agree (mid-processing)", () => {
    // est = 9360 / 5 = 1872s. Halfway through (elapsed=936) the bar should
    // read ~50% AND the remaining should be ~half of the estimate — the two
    // are derived from one model, so they can never disagree.
    const result = computeProcessingProgress({
      status: "PROCESSING",
      elapsedSeconds: 936,
      audioDurationSeconds: 9360,
    });
    expect(result.barPercent).toBe(50);
    expect(result.remainingSeconds).toBe(936);
    expect(result.overrun).toBe(false);
  });

  it("reports 100% and no countdown only when COMPLETED", () => {
    const result = computeProcessingProgress({
      status: "COMPLETED",
      elapsedSeconds: 5000,
      audioDurationSeconds: 9360,
    });
    expect(result.barPercent).toBe(100);
    expect(result.remainingSeconds).toBeUndefined();
    expect(result.overrun).toBe(false);
  });

  it("renders no bar for a FAILED job (a failed state is shown separately)", () => {
    const result = computeProcessingProgress({
      status: "FAILED",
      elapsedSeconds: 500,
      audioDurationSeconds: 9360,
    });
    expect(result.barPercent).toBeUndefined();
    expect(result.remainingSeconds).toBeUndefined();
    expect(result.overrun).toBe(false);
  });

  it("holds near 99% with an overrun flag once elapsed passes the estimate", () => {
    // est = 60 / 5 = 12s; elapsed of 100s is well past it (e.g. queue wait).
    const result = computeProcessingProgress({
      status: "PROCESSING",
      elapsedSeconds: 100,
      audioDurationSeconds: 60,
    });
    expect(result.barPercent).toBe(99);
    expect(result.remainingSeconds).toBeUndefined();
    expect(result.overrun).toBe(true);
  });

  it("shows an elapsed-only display (no bar/countdown) when the duration is unknown", () => {
    const result = computeProcessingProgress({
      status: "PROCESSING",
      elapsedSeconds: 300,
      audioDurationSeconds: undefined,
    });
    expect(result.barPercent).toBeUndefined();
    expect(result.remainingSeconds).toBeUndefined();
    expect(result.overrun).toBe(false);
  });

  it("treats PENDING like PROCESSING for the model", () => {
    const result = computeProcessingProgress({
      status: "PENDING",
      elapsedSeconds: 936,
      audioDurationSeconds: 9360,
    });
    expect(result.barPercent).toBe(50);
    expect(result.remainingSeconds).toBe(936);
    expect(result.overrun).toBe(false);
  });

  it("caps the bar below 100 while still processing (never 100 until COMPLETED)", () => {
    // Almost done but not complete: elapsed just below the estimate.
    const result = computeProcessingProgress({
      status: "PROCESSING",
      elapsedSeconds: 1871,
      audioDurationSeconds: 9360, // est = 1872
    });
    expect(result.barPercent).toBeLessThan(100);
    expect(result.barPercent).toBe(99); // round(1871/1872*100)=100 -> capped to 99
    expect(result.remainingSeconds).toBe(1);
  });

  it("decreases the remaining estimate as elapsed time grows", () => {
    const early = computeProcessingProgress({
      status: "PROCESSING",
      elapsedSeconds: 100,
      audioDurationSeconds: 9360,
    });
    const later = computeProcessingProgress({
      status: "PROCESSING",
      elapsedSeconds: 500,
      audioDurationSeconds: 9360,
    });
    expect(later.remainingSeconds).toBeLessThan(
      early.remainingSeconds ?? Number.POSITIVE_INFINITY
    );
    expect(later.barPercent).toBeGreaterThan(early.barPercent ?? 0);
  });
});

describe("audioDurationMessage", () => {
  it("formats the ticket's example message", () => {
    expect(audioDurationMessage(9360)).toBe("Transcribing 2h 36m of audio");
  });

  it("returns undefined when duration is unknown", () => {
    expect(audioDurationMessage(undefined)).toBeUndefined();
  });

  it("returns undefined for a non-positive duration", () => {
    expect(audioDurationMessage(0)).toBeUndefined();
    expect(audioDurationMessage(-5)).toBeUndefined();
  });
});
