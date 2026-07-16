import { describe, expect, it } from "vitest";
import {
  buildModificationHistory,
  historyKindLabel,
} from "@/lib/modification-history";
import type { TranscriptionJob, TranscriptSegment } from "@/lib/types";

function segment(
  overrides: Partial<TranscriptSegment> & Pick<TranscriptSegment, "id">
): TranscriptSegment {
  return {
    speaker: "Judge",
    speakerColor: "#000",
    text: "some text",
    startTime: 0,
    duration: 10,
    ...overrides,
  };
}

function job(overrides: Partial<TranscriptionJob>): TranscriptionJob {
  return {
    id: "job-1",
    caseReference: "PA/1/2025",
    tribunal: "FTT",
    audioFileName: "a.mp3",
    uploadedAt: "2026-01-01T00:00:00Z",
    status: "COMPLETED",
    ...overrides,
  };
}

describe("historyKindLabel", () => {
  it("labels each known kind", () => {
    expect(historyKindLabel("segment")).toBe("Whole-segment edit");
    expect(historyKindLabel("word_range")).toBe("Phrase correction");
    expect(historyKindLabel("rollback")).toBe("Rolled back");
    expect(historyKindLabel("accept_all")).toBe("Accepted as-is");
  });

  it("falls back to the raw kind for unknown values", () => {
    expect(historyKindLabel("something_new")).toBe("something_new");
  });
});

describe("buildModificationHistory", () => {
  it("returns an empty list when there are no segments", () => {
    expect(buildModificationHistory(job({ segments: undefined }))).toEqual([]);
  });

  it("returns an empty list when no segment has any history", () => {
    expect(
      buildModificationHistory(
        job({ segments: [segment({ id: "s1" }), segment({ id: "s2" })] })
      )
    ).toEqual([]);
  });

  it("flattens correction_history across all segments", () => {
    const rows = buildModificationHistory(
      job({
        segments: [
          segment({
            id: "s1",
            speaker: "Judge",
            correctionHistory: [
              {
                timestamp: "2026-01-01T10:00:00Z",
                kind: "segment",
                previousText: "old one",
                newText: "new one",
              },
            ],
          }),
          segment({
            id: "s2",
            speaker: "Counsel",
            correctionHistory: [
              {
                timestamp: "2026-01-01T11:00:00Z",
                kind: "word_range",
                previousText: "whole before",
                newText: "whole after",
                previousPhrase: "quick",
                newPhrase: "slow",
                startWordIndex: 2,
                endWordIndex: 2,
              },
            ],
          }),
        ],
      })
    );
    expect(rows).toHaveLength(2);
    // Both segments' actions are present.
    expect(rows.map((r) => r.speaker).sort()).toEqual(["Counsel", "Judge"]);
  });

  it("orders actions newest first across segments", () => {
    const rows = buildModificationHistory(
      job({
        segments: [
          segment({
            id: "s1",
            correctionHistory: [
              {
                timestamp: "2026-01-01T09:00:00Z",
                kind: "segment",
                previousText: "a",
                newText: "b",
              },
              {
                timestamp: "2026-01-01T12:00:00Z",
                kind: "rollback",
                previousText: "b",
                newText: "a",
              },
            ],
          }),
          segment({
            id: "s2",
            correctionHistory: [
              {
                timestamp: "2026-01-01T10:30:00Z",
                kind: "segment",
                previousText: "c",
                newText: "d",
              },
            ],
          }),
        ],
      })
    );
    expect(rows.map((r) => r.timestamp)).toEqual([
      "2026-01-01T12:00:00Z",
      "2026-01-01T10:30:00Z",
      "2026-01-01T09:00:00Z",
    ]);
  });

  it("breaks timestamp ties deterministically by segment then entry order", () => {
    const ts = "2026-01-01T10:00:00Z";
    const rows = buildModificationHistory(
      job({
        segments: [
          segment({
            id: "s1",
            correctionHistory: [
              {
                timestamp: ts,
                kind: "segment",
                previousText: "1",
                newText: "2",
              },
              {
                timestamp: ts,
                kind: "rollback",
                previousText: "2",
                newText: "1",
              },
            ],
          }),
          segment({
            id: "s2",
            correctionHistory: [
              {
                timestamp: ts,
                kind: "segment",
                previousText: "3",
                newText: "4",
              },
            ],
          }),
        ],
      })
    );
    expect(rows.map((r) => `${r.segmentNumber}:${r.after}`)).toEqual([
      "1:2",
      "1:1",
      "2:4",
    ]);
  });

  it("uses the concise phrase diff for word-range corrections", () => {
    const [row] = buildModificationHistory(
      job({
        segments: [
          segment({
            id: "s1",
            correctionHistory: [
              {
                timestamp: "2026-01-01T10:00:00Z",
                kind: "word_range",
                previousText: "the quick brown fox",
                newText: "the slow brown fox",
                previousPhrase: "quick",
                newPhrase: "slow",
              },
            ],
          }),
        ],
      })
    );
    expect(row.before).toBe("quick");
    expect(row.after).toBe("slow");
  });

  it("falls back to whole-segment text when no phrase diff is present", () => {
    const [row] = buildModificationHistory(
      job({
        segments: [
          segment({
            id: "s1",
            correctionHistory: [
              {
                timestamp: "2026-01-01T10:00:00Z",
                kind: "segment",
                previousText: "before whole",
                newText: "after whole",
              },
            ],
          }),
        ],
      })
    );
    expect(row.before).toBe("before whole");
    expect(row.after).toBe("after whole");
  });

  it("carries a 1-based segment number and the segment start time", () => {
    const rows = buildModificationHistory(
      job({
        segments: [
          segment({ id: "s1" }),
          segment({
            id: "s2",
            startTime: 42,
            correctionHistory: [
              {
                timestamp: "2026-01-01T10:00:00Z",
                kind: "segment",
                previousText: "a",
                newText: "b",
              },
            ],
          }),
        ],
      })
    );
    expect(rows[0].segmentNumber).toBe(2);
    expect(rows[0].segmentIndex).toBe(1);
    expect(rows[0].segmentStartTime).toBe(42);
  });

  it("attributes every row to the job's caller", () => {
    const rows = buildModificationHistory(
      job({
        caller: "local-dev",
        segments: [
          segment({
            id: "s1",
            correctionHistory: [
              {
                timestamp: "2026-01-01T10:00:00Z",
                kind: "segment",
                previousText: "a",
                newText: "b",
              },
            ],
          }),
        ],
      })
    );
    expect(rows[0].changedBy).toBe("local-dev");
  });

  it("leaves changedBy undefined when the job has no caller", () => {
    const rows = buildModificationHistory(
      job({
        caller: undefined,
        segments: [
          segment({
            id: "s1",
            correctionHistory: [
              {
                timestamp: "2026-01-01T10:00:00Z",
                kind: "segment",
                previousText: "a",
                newText: "b",
              },
            ],
          }),
        ],
      })
    );
    expect(rows[0].changedBy).toBeUndefined();
  });
});
