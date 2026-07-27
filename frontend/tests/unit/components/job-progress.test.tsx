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

  it("derives a time-based bar percentage from the Azure 5x model", () => {
    // est = 9360 / 5 = 1872s; elapsed = 600s (10m) -> round(600/1872*100) = 32%.
    render(<JobProgress job={makeJob({ audioDurationSeconds: 9360 })} />);
    expect(screen.getByText("32%")).toBeDefined();
    expect(screen.getByRole("progressbar")).toBeDefined();
  });

  it("shows an estimated remaining time consistent with the bar", () => {
    // remaining = 1872 - 600 = 1272s ≈ 21m — the same model as the bar above.
    render(<JobProgress job={makeJob({ audioDurationSeconds: 9360 })} />);
    expect(screen.getByText(/Estimated remaining: 21m/)).toBeDefined();
  });

  it("shows an elapsed-only display (no bar, no estimate) when duration is unknown", () => {
    render(<JobProgress job={makeJob({ status: "PROCESSING" })} />);
    expect(screen.getByText(/Elapsed: 10m/)).toBeDefined();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByText(/Estimated remaining:/)).toBeNull();
    expect(screen.queryByText(/Taking longer than usual/)).toBeNull();
  });

  it("holds at 99% and says 'Taking longer than usual' once past the estimate", () => {
    // est = 60 / 5 = 12s; elapsed = 600s is well past it.
    render(<JobProgress job={makeJob({ audioDurationSeconds: 60 })} />);
    expect(screen.getByText("99%")).toBeDefined();
    expect(screen.getByText(/Taking longer than usual/)).toBeDefined();
    expect(screen.queryByText(/Estimated remaining:/)).toBeNull();
  });

  it("shows a full 100% bar and no countdown for a COMPLETED job", () => {
    render(
      <JobProgress
        job={makeJob({ status: "COMPLETED", audioDurationSeconds: 9360 })}
      />
    );
    expect(screen.getByText("100%")).toBeDefined();
    expect(screen.queryByText(/Estimated remaining:/)).toBeNull();
  });

  it("renders no bar for a FAILED job (its failed state is shown separately)", () => {
    render(
      <JobProgress
        job={makeJob({ status: "FAILED", audioDurationSeconds: 9360 })}
      />
    );
    expect(screen.queryByRole("progressbar")).toBeNull();
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

  it("advances the bar and shrinks the estimate as the live clock ticks", () => {
    render(<JobProgress job={makeJob({ audioDurationSeconds: 9360 })} />);
    const earlyRemaining = screen.getByText(/Estimated remaining:/).textContent;
    const earlyBar = screen.getByText(/%$/).textContent;

    act(() => {
      vi.setSystemTime(new Date("2026-07-15T09:20:00Z"));
      vi.advanceTimersByTime(1000);
    });

    // est = 1872s; elapsed now 1200s -> round(1200/1872*100) = 64%, remaining 11m.
    expect(screen.getByText("64%")).toBeDefined();
    const laterRemaining = screen.getByText(/Estimated remaining:/).textContent;
    const laterBar = screen.getByText(/%$/).textContent;
    expect(laterRemaining).not.toBe(earlyRemaining);
    expect(laterBar).not.toBe(earlyBar);
  });
});
