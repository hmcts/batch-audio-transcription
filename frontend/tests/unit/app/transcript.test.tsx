import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TranscriptPage from "@/app/jobs/[jobId]/page";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

const { mockGetJob } = vi.hoisted(() => ({ mockGetJob: vi.fn() }));

vi.mock("@/lib/api-client", () => ({ getJob: mockGetJob }));

const COMPLETED_JOB = {
  id: "job-pa05217-2025",
  caseReference: "PA/05217/2025",
  tribunal: "First-tier Tribunal — Immigration and Asylum Chamber",
  audioFileName: "hearing.wav",
  status: "COMPLETED" as const,
  progressPercent: 100,
  segments: [
    {
      id: "seg-0",
      speaker: "Judge",
      speakerColor: "#4A90D9",
      text: "This hearing is now in session.",
      startTime: 0,
      duration: 3.5,
    },
  ],
};

beforeEach(() => {
  mockGetJob.mockResolvedValue(COMPLETED_JOB);
});

describe("TranscriptPage", () => {
  it("renders case reference for known job", async () => {
    render(
      await TranscriptPage({
        params: Promise.resolve({ jobId: COMPLETED_JOB.id }),
      })
    );
    expect(screen.getByText("PA/05217/2025")).toBeDefined();
  });

  it("renders tribunal name", async () => {
    render(
      await TranscriptPage({
        params: Promise.resolve({ jobId: COMPLETED_JOB.id }),
      })
    );
    expect(
      screen.getByText("First-tier Tribunal — Immigration and Asylum Chamber")
    ).toBeDefined();
  });

  it("renders transcript segments", async () => {
    render(
      await TranscriptPage({
        params: Promise.resolve({ jobId: COMPLETED_JOB.id }),
      })
    );
    expect(screen.getAllByText("Judge").length).toBeGreaterThan(0);
  });

  it("calls notFound for unknown job id", async () => {
    mockGetJob.mockResolvedValue(null);
    await expect(
      TranscriptPage({ params: Promise.resolve({ jobId: "unknown" }) })
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("shows a fallback message when a completed job has no transcript segments", async () => {
    mockGetJob.mockResolvedValue({ ...COMPLETED_JOB, segments: undefined });
    render(
      await TranscriptPage({
        params: Promise.resolve({ jobId: COMPLETED_JOB.id }),
      })
    );
    expect(screen.getByText(/no content to display/i)).toBeDefined();
  });

  it("shows an in-progress message and does not 404 for a processing job", async () => {
    mockGetJob.mockResolvedValue({
      ...COMPLETED_JOB,
      status: "PROCESSING",
      progressPercent: 60,
      segments: undefined,
    });
    render(
      await TranscriptPage({
        params: Promise.resolve({ jobId: COMPLETED_JOB.id }),
      })
    );
    expect(screen.getByText(/still in progress/i)).toBeDefined();
    expect(screen.getByText("60%")).toBeDefined();
  });

  it("shows the error message and does not 404 for a failed job", async () => {
    mockGetJob.mockResolvedValue({
      ...COMPLETED_JOB,
      status: "FAILED",
      segments: undefined,
      errorMessage: "Azure batch transcription submission failed",
    });
    render(
      await TranscriptPage({
        params: Promise.resolve({ jobId: COMPLETED_JOB.id }),
      })
    );
    expect(screen.getByText(/transcription failed/i)).toBeDefined();
    expect(
      screen.getByText("Azure batch transcription submission failed")
    ).toBeDefined();
  });
});
