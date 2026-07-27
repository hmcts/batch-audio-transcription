import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { JobDetailView } from "@/components/transcript/job-detail-view";
import type { TranscriptionJob } from "@/lib/types";

// DIAAT-236: the review panel sidebar must stay in view (position: sticky)
// while scrolling a long transcript, rather than being anchored in normal
// document flow where it scrolls out of view once the transcript column
// (which can run to ~15,000 words) grows taller than the sidebar.

function makeJob(overrides: Partial<TranscriptionJob> = {}): TranscriptionJob {
  return {
    id: "job-1",
    caseReference: "PA/00001/2025",
    tribunal: "First-tier Tribunal",
    audioFileName: "hearing.mp3",
    uploadedAt: new Date().toISOString(),
    status: "COMPLETED",
    segments: [
      {
        id: "s1",
        speaker: "Judge",
        speakerColor: "#000000",
        text: "Good morning.",
        startTime: 0,
        duration: 5,
        confidence: 0.98,
      },
    ],
    accuracy: {
      confidenceScore: 90,
      wordsTranscribed: 1000,
      lowConfidenceCount: 1,
      confidenceThreshold: 85,
      hasCorrections: false,
      hasBaseline: false,
    },
    lowConfidenceSegments: [
      {
        speaker: "Judge",
        speakerColor: "#000000",
        confidence: 0.7,
        startTime: 0,
      },
    ],
    ...overrides,
  };
}

describe("JobDetailView review panel sidebar", () => {
  it("renders the sidebar with sticky positioning so it stays in view while scrolling", () => {
    const job = makeJob();
    render(<JobDetailView jobId={job.id} initialJob={job} />);

    const heading = screen.getByRole("heading", { name: /needs review/i });
    // The sidebar is the nearest <aside> ancestor of the panel.
    const sidebar = heading.closest("aside");
    expect(sidebar).not.toBeNull();
    expect(sidebar?.className.split(/\s+/)).toContain("sticky");
    // A top offset is required to clear the sticky audio player bar above
    // it — without one, the sidebar would stick flush to the viewport top
    // and render underneath/behind the audio bar.
    expect(sidebar?.className).toMatch(/\btop-\d+\b/);
    // Bounded height + internal scroll, so a sidebar taller than the
    // viewport (e.g. many low-confidence segments) never spills past the
    // bottom of the screen once stuck.
    expect(sidebar?.className).toMatch(/overflow-y-auto/);
  });

  it("omits the sidebar entirely when there is no accuracy data", () => {
    const job = makeJob({
      accuracy: undefined,
      lowConfidenceSegments: undefined,
    });
    render(<JobDetailView jobId={job.id} initialJob={job} />);
    expect(screen.queryByText(/needs review/i)).toBeNull();
  });
});

// DIAAT-249: reframe the highlight as "review", not "error" — a muted caption
// near the Transcript heading, shown only when the transcript actually renders
// at least one low-confidence highlight, so clean transcripts (and ones where
// every highlight was cleared) don't show a caption about highlights that
// aren't there.
describe("JobDetailView highlight caption", () => {
  // A segment that renders word-by-word with a sub-threshold word, so a
  // low-confidence highlight actually exists (the caption's precondition).
  const HIGHLIGHTED_SEGMENT = {
    id: "s1",
    speaker: "Judge",
    speakerColor: "#000000",
    text: "Good morning.",
    startTime: 0,
    duration: 5,
    confidence: 0.98,
    words: [
      { text: "good", startTime: 0, endTime: 0.5, confidence: 0.97 },
      { text: "morning", startTime: 0.5, endTime: 1.0, confidence: 0.5 },
    ],
  };

  it("shows the review caption when a low-confidence word is highlighted", () => {
    const job = makeJob({ segments: [HIGHLIGHTED_SEGMENT] });
    render(<JobDetailView jobId={job.id} initialJob={job} />);
    expect(
      screen.getByText(/lower recognition confidence — review and confirm/i)
    ).toBeDefined();
  });

  it("omits the caption when there is no accuracy data", () => {
    const job = makeJob({
      segments: [HIGHLIGHTED_SEGMENT],
      accuracy: undefined,
      lowConfidenceSegments: undefined,
    });
    render(<JobDetailView jobId={job.id} initialJob={job} />);
    expect(screen.queryByText(/lower recognition confidence/i)).toBeNull();
  });

  it("omits the caption when accuracy exists but nothing is highlighted", () => {
    // All words above the threshold — accuracy data present, but there are no
    // low-confidence highlights to review, so the caption must not appear.
    const job = makeJob({
      segments: [
        {
          ...HIGHLIGHTED_SEGMENT,
          words: [
            { text: "good", startTime: 0, endTime: 0.5, confidence: 0.97 },
            { text: "morning", startTime: 0.5, endTime: 1.0, confidence: 0.95 },
          ],
        },
      ],
    });
    render(<JobDetailView jobId={job.id} initialJob={job} />);
    expect(screen.queryByText(/lower recognition confidence/i)).toBeNull();
  });
});

// DIAAT-246: the sync-highlight preference is owned here, defaults on, and is
// persisted to localStorage so it survives reloads.
describe("JobDetailView sync-highlight toggle", () => {
  const STORAGE_KEY = "batch:syncHighlight";

  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults the toggle on", () => {
    const job = makeJob();
    render(<JobDetailView jobId={job.id} initialJob={job} />);
    const toggle = screen.getByRole("button", {
      name: /highlight words with audio/i,
    });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
  });

  it("flips state and writes localStorage when toggled off", async () => {
    const user = userEvent.setup();
    const job = makeJob();
    render(<JobDetailView jobId={job.id} initialJob={job} />);
    const toggle = screen.getByRole("button", {
      name: /highlight words with audio/i,
    });

    await user.click(toggle);

    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("false");
  });

  it("hydrates the stored 'off' choice on mount", async () => {
    localStorage.setItem(STORAGE_KEY, "false");
    const job = makeJob();
    render(<JobDetailView jobId={job.id} initialJob={job} />);
    const toggle = screen.getByRole("button", {
      name: /highlight words with audio/i,
    });
    await waitFor(() => {
      expect(toggle.getAttribute("aria-pressed")).toBe("false");
    });
  });
});
