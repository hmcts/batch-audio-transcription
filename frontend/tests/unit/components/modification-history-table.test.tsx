import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ModificationHistoryTable } from "@/components/transcript/modification-history-table";
import type { TranscriptionJob, TranscriptSegment } from "@/lib/types";

function segment(
  overrides: Partial<TranscriptSegment> & Pick<TranscriptSegment, "id">
): TranscriptSegment {
  return {
    speaker: "Judge",
    speakerColor: "#000",
    text: "text",
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
    caller: "local-dev",
    ...overrides,
  };
}

const JOB_WITH_HISTORY = job({
  segments: [
    segment({
      id: "s1",
      speaker: "Judge",
      startTime: 0,
      correctionHistory: [
        {
          timestamp: "2026-01-01T10:00:00Z",
          kind: "word_range",
          previousText: "the quick brown fox",
          newText: "the slow brown fox",
          previousPhrase: "quick",
          newPhrase: "slow",
          startWordIndex: 1,
          endWordIndex: 1,
        },
      ],
    }),
    segment({
      id: "s2",
      speaker: "Counsel",
      startTime: 65,
      confidence: 0.5,
      correctionHistory: [
        {
          timestamp: "2026-01-01T11:00:00Z",
          kind: "accept_all",
          previousText: "unchanged text",
          newText: "unchanged text",
        },
      ],
    }),
  ],
});

describe("ModificationHistoryTable", () => {
  it("shows an empty state when there are no modifications", () => {
    render(
      <ModificationHistoryTable
        job={job({ segments: [segment({ id: "s1" })] })}
      />
    );
    expect(screen.getByText(/no modifications have been made/i)).toBeDefined();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("renders one row per action across all segments", () => {
    render(<ModificationHistoryTable job={JOB_WITH_HISTORY} />);
    // Header row + two action rows.
    expect(screen.getAllByRole("row")).toHaveLength(3);
  });

  it("renders newest action first", () => {
    render(<ModificationHistoryTable job={JOB_WITH_HISTORY} />);
    const rows = screen.getAllByRole("row").slice(1); // drop header
    // The accept-all at 11:00 is newer than the phrase correction at 10:00.
    expect(rows[0].textContent).toContain("Accepted as-is");
    expect(rows[1].textContent).toContain("Phrase correction");
  });

  it("shows the action kind labels", () => {
    render(<ModificationHistoryTable job={JOB_WITH_HISTORY} />);
    expect(screen.getByText("Phrase correction")).toBeDefined();
    expect(screen.getByText("Accepted as-is")).toBeDefined();
  });

  it("shows the concise before/after diff for a correction", () => {
    render(<ModificationHistoryTable job={JOB_WITH_HISTORY} />);
    expect(screen.getByText("quick")).toBeDefined();
    expect(screen.getByText("slow")).toBeDefined();
  });

  it("shows 'No text change' for an accept-all action", () => {
    render(<ModificationHistoryTable job={JOB_WITH_HISTORY} />);
    expect(screen.getByText(/no text change/i)).toBeDefined();
  });

  it("shows the segment number and speaker", () => {
    render(<ModificationHistoryTable job={JOB_WITH_HISTORY} />);
    expect(screen.getByText("Segment 1")).toBeDefined();
    expect(screen.getByText("Segment 2")).toBeDefined();
    expect(screen.getByText(/Judge/)).toBeDefined();
    expect(screen.getByText(/Counsel/)).toBeDefined();
  });

  it("attributes changes to the job's caller", () => {
    render(<ModificationHistoryTable job={JOB_WITH_HISTORY} />);
    expect(screen.getAllByText("local-dev")).toHaveLength(2);
  });

  it("shows 'Unknown' when the job has no caller", () => {
    render(
      <ModificationHistoryTable
        job={{ ...JOB_WITH_HISTORY, caller: undefined }}
      />
    );
    expect(screen.getAllByText("Unknown")).toHaveLength(2);
  });

  it("seeks to a segment's start time when its row is clicked", async () => {
    const onSeekToSegment = vi.fn();
    const user = userEvent.setup();
    render(
      <ModificationHistoryTable
        job={JOB_WITH_HISTORY}
        onSeekToSegment={onSeekToSegment}
      />
    );
    // Newest row first = the accept-all on segment 2 (startTime 65).
    const rows = screen.getAllByRole("row").slice(1);
    await user.click(rows[0]);
    expect(onSeekToSegment).toHaveBeenCalledWith(65);
  });

  it("does not make rows clickable without a seek handler", async () => {
    const user = userEvent.setup();
    render(<ModificationHistoryTable job={JOB_WITH_HISTORY} />);
    const rows = screen.getAllByRole("row").slice(1);
    // No handler wired — clicking must not throw.
    await expect(user.click(rows[0])).resolves.not.toThrow();
  });
});
