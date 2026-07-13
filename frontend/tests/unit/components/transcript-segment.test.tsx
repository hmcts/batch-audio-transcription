import { render, screen } from "@testing-library/react";
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
      <TranscriptSegment segment={{ ...SEGMENT, startTime: 152.6 }} onSeek={onSeek} />
    );
    await user.click(screen.getByRole("button", { name: "2:32" }));
    expect(onSeek).toHaveBeenCalledWith(152.6);
  });

  it("does not throw when the timestamp is clicked with no onSeek provided", async () => {
    const user = userEvent.setup();
    render(<TranscriptSegment segment={SEGMENT} />);
    await expect(
      user.click(screen.getByText("0:00"))
    ).resolves.not.toThrow();
  });
});
