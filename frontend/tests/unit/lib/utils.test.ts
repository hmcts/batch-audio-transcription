import { describe, expect, it } from "vitest";
import { cn, formatDuration } from "@/lib/utils";

describe("cn", () => {
  it("merges class names", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("dedupes conflicting tailwind classes (last wins)", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });
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
