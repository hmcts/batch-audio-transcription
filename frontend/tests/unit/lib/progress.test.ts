import { describe, expect, it } from "vitest";
import {
  audioDurationMessage,
  computeElapsedSeconds,
  estimateRemainingSeconds,
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
    expect(formatDuration(89)).toBe("1m"); // 89s = 1.48m, rounds down to 1m
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

describe("estimateRemainingSeconds", () => {
  it("returns undefined when neither audio duration nor progress is known", () => {
    expect(estimateRemainingSeconds({ elapsedSeconds: 60 })).toBeUndefined();
  });

  it("estimates from audio duration alone", () => {
    // 9360s audio * 0.5 ratio = 4680s total estimate, minus 60s elapsed.
    const result = estimateRemainingSeconds({
      elapsedSeconds: 60,
      audioDurationSeconds: 9360,
    });
    expect(result).toBe(4620);
  });

  it("estimates from observed throughput alone", () => {
    // 60s elapsed to reach 25% -> projected total 240s -> 180s remaining.
    const result = estimateRemainingSeconds({
      elapsedSeconds: 60,
      progressPercent: 25,
    });
    expect(result).toBe(180);
  });

  it("blends both estimates when available", () => {
    const durationOnly = estimateRemainingSeconds({
      elapsedSeconds: 60,
      audioDurationSeconds: 9360,
    });
    const throughputOnly = estimateRemainingSeconds({
      elapsedSeconds: 60,
      progressPercent: 25,
    });
    const blended = estimateRemainingSeconds({
      elapsedSeconds: 60,
      progressPercent: 25,
      audioDurationSeconds: 9360,
    });
    expect(blended).toBe(((durationOnly ?? 0) + (throughputOnly ?? 0)) / 2);
  });

  it("never returns a negative value even once elapsed exceeds the estimate", () => {
    const result = estimateRemainingSeconds({
      elapsedSeconds: 100_000,
      audioDurationSeconds: 60,
    });
    expect(result).toBe(0);
  });

  it("ignores progress of 0 or 100 for the throughput estimate", () => {
    expect(
      estimateRemainingSeconds({ elapsedSeconds: 60, progressPercent: 0 })
    ).toBeUndefined();
    expect(
      estimateRemainingSeconds({ elapsedSeconds: 60, progressPercent: 100 })
    ).toBeUndefined();
  });

  it("updates as elapsed time grows, decreasing the estimate", () => {
    const early = estimateRemainingSeconds({
      elapsedSeconds: 60,
      progressPercent: 25,
      audioDurationSeconds: 9360,
    });
    const later = estimateRemainingSeconds({
      elapsedSeconds: 300,
      progressPercent: 60,
      audioDurationSeconds: 9360,
    });
    expect(later).toBeLessThan(early ?? Number.POSITIVE_INFINITY);
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
