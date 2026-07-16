import { describe, expect, it } from "vitest";
import {
  confidencePercent,
  formatDuration,
  formatTime,
  getMockJobById,
  MOCK_JOBS,
} from "@/lib/mock-data";

describe("MOCK_JOBS", () => {
  it("contains at least 3 jobs", () => {
    expect(MOCK_JOBS.length).toBeGreaterThanOrEqual(3);
  });

  it("all jobs have required fields", () => {
    for (const job of MOCK_JOBS) {
      expect(job.id).toBeTruthy();
      expect(job.caseReference).toBeTruthy();
      expect(job.status).toMatch(/^(PENDING|PROCESSING|COMPLETED|FAILED)$/);
    }
  });

  it("completed jobs have segments and accuracy", () => {
    const completed = MOCK_JOBS.filter((j) => j.status === "COMPLETED");
    expect(completed.length).toBeGreaterThan(0);
    for (const job of completed) {
      expect(job.segments?.length).toBeGreaterThan(0);
      expect(job.accuracy).toBeDefined();
    }
  });
});

describe("getMockJobById", () => {
  it("returns job when id matches", () => {
    const job = getMockJobById("job-pa05217-2025");
    expect(job?.caseReference).toBe("PA/05217/2025");
  });

  it("returns undefined for unknown id", () => {
    expect(getMockJobById("does-not-exist")).toBeUndefined();
  });
});

describe("formatTime", () => {
  it("formats 0 as 0:00", () => expect(formatTime(0)).toBe("0:00"));
  it("formats 65 as 1:05", () => expect(formatTime(65)).toBe("1:05"));
  it("formats 289 as 4:49", () => expect(formatTime(289)).toBe("4:49"));
});

describe("confidencePercent", () => {
  it("converts 0.98 to 98", () => expect(confidencePercent(0.98)).toBe(98));
  it("converts 0.73 to 73", () => expect(confidencePercent(0.73)).toBe(73));
});

describe("formatDuration", () => {
  it("formats seconds only when under a minute", () => {
    expect(formatDuration(8)).toBe("8s");
  });

  it("formats minutes and seconds", () => {
    expect(formatDuration(754)).toBe("12m 34s");
  });

  it("formats hours, minutes and seconds", () => {
    expect(formatDuration(3723)).toBe("1h 2m 3s");
  });

  it("rounds fractional seconds", () => {
    expect(formatDuration(41.8)).toBe("42s");
  });

  it("returns an em dash placeholder when undefined", () => {
    expect(formatDuration(undefined)).toBe("—");
  });

  it("formats zero as 0s", () => {
    expect(formatDuration(0)).toBe("0s");
  });
});
