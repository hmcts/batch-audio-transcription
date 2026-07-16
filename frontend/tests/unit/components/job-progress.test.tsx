import { act, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JobProgress } from "@/components/job-status/job-progress";
import type { TranscriptionJob } from "@/lib/types";

function makeJob(overrides: Partial<TranscriptionJob> = {}): TranscriptionJob {
  return {
    id: "job-1",
    caseReference: "PA/00001/2026",
    tribunal: "First-tier Tribunal — Immigration and Asylum Chamber",
    audioFileName: "hearing.wav",
    uploadedAt: "2026-07-15T09:00:00Z",
    status: "PROCESSING",
    progressPercent: 60,
    ...overrides,
  };
}

describe("JobProgress", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T09:10:00Z")); // 10 minutes after uploadedAt
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows elapsed time since submission", () => {
    render(<JobProgress job={makeJob()} />);
    expect(screen.getByText(/Elapsed: 10m/)).toBeDefined();
  });

  it("renders no empty paragraph on the server when there's nothing to show", () => {
    // On the server useNow() returns null, so with no audio-duration message
    // there's no elapsed/estimate text — the <p> must be omitted entirely
    // rather than rendered empty (which would add stray vertical spacing).
    const html = renderToStaticMarkup(
      <JobProgress
        job={makeJob({
          progressPercent: undefined,
          audioDurationSeconds: undefined,
        })}
      />
    );
    expect(html).not.toContain("<p");
  });

  it("shows the audio duration message in the ticket's example format", () => {
    render(<JobProgress job={makeJob({ audioDurationSeconds: 9360 })} />);
    expect(screen.getByText(/Transcribing 2h 36m of audio/)).toBeDefined();
  });

  it("omits the audio duration message when duration is unknown", () => {
    render(<JobProgress job={makeJob()} />);
    expect(screen.queryByText(/Transcribing/)).toBeNull();
  });

  it("shows an estimated remaining time when audio duration is known", () => {
    render(<JobProgress job={makeJob({ audioDurationSeconds: 9360 })} />);
    expect(screen.getByText(/Estimated remaining:/)).toBeDefined();
  });

  it("omits estimated remaining time when there's no basis to estimate from", () => {
    render(
      <JobProgress
        job={makeJob({ progressPercent: undefined, status: "PENDING" })}
      />
    );
    expect(screen.queryByText(/Estimated remaining:/)).toBeNull();
  });

  it("still shows the percentage progress bar alongside the new text", () => {
    render(<JobProgress job={makeJob()} />);
    expect(screen.getByText("60%")).toBeDefined();
    expect(screen.getByRole("progressbar")).toBeDefined();
  });

  it("updates the elapsed time as polling/ticking advances, without remounting", () => {
    render(<JobProgress job={makeJob()} />);
    expect(screen.getByText(/Elapsed: 10m/)).toBeDefined();

    act(() => {
      vi.setSystemTime(new Date("2026-07-15T09:15:00Z"));
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByText(/Elapsed: 15m/)).toBeDefined();
  });

  it("updates the estimated remaining time as the job's reported progress advances", () => {
    const { rerender } = render(
      <JobProgress
        job={makeJob({ progressPercent: 25, audioDurationSeconds: 9360 })}
      />
    );
    const early = screen.getByText(/Estimated remaining:/).textContent;

    act(() => {
      vi.setSystemTime(new Date("2026-07-15T09:30:00Z"));
    });
    rerender(
      <JobProgress
        job={makeJob({ progressPercent: 60, audioDurationSeconds: 9360 })}
      />
    );

    const later = screen.getByText(/Estimated remaining:/).textContent;
    expect(later).not.toBe(early);
  });
});
