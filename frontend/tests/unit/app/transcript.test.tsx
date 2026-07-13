import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TranscriptPage from "@/app/jobs/[jobId]/page";
import type { TranscriptionJob } from "@/lib/types";

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

vi.mock("@/lib/api-client", () => ({
  getJob: mockGetJob,
}));

const COMPLETED_JOB: TranscriptionJob = {
  id: "job-pa05217-2025",
  caseReference: "PA/05217/2025",
  tribunal: "First-tier Tribunal — Immigration and Asylum Chamber",
  audioFileName: "hearing.mp3",
  uploadedAt: "2026-06-28T09:15:00Z",
  completedAt: "2026-06-28T09:47:00Z",
  status: "COMPLETED",
  segments: [
    {
      id: "s1",
      speaker: "Judge",
      speakerColor: "#6d28d9",
      text: "Good morning, we are on the record.",
      startTime: 0,
      duration: 10,
    },
  ],
};

describe("TranscriptPage", () => {
  it("renders case reference for a completed job", async () => {
    mockGetJob.mockResolvedValue(COMPLETED_JOB);
    render(
      await TranscriptPage({
        params: Promise.resolve({ jobId: COMPLETED_JOB.id }),
      })
    );
    expect(screen.getByText("PA/05217/2025")).toBeDefined();
  });

  it("renders tribunal name", async () => {
    mockGetJob.mockResolvedValue(COMPLETED_JOB);
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
    mockGetJob.mockResolvedValue(COMPLETED_JOB);
    render(
      await TranscriptPage({
        params: Promise.resolve({ jobId: COMPLETED_JOB.id }),
      })
    );
    expect(screen.getAllByText("Judge").length).toBeGreaterThan(0);
  });

  it("does not render the accuracy sidebar when the backend has no accuracy data", async () => {
    mockGetJob.mockResolvedValue(COMPLETED_JOB);
    render(
      await TranscriptPage({
        params: Promise.resolve({ jobId: COMPLETED_JOB.id }),
      })
    );
    expect(screen.queryByText("Transcript accuracy")).toBeNull();
  });

  it("calls notFound for unknown job id", async () => {
    mockGetJob.mockResolvedValue(null);
    await expect(
      TranscriptPage({ params: Promise.resolve({ jobId: "unknown" }) })
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("calls notFound when the job has no transcript segments yet", async () => {
    mockGetJob.mockResolvedValue({ ...COMPLETED_JOB, segments: undefined });
    await expect(
      TranscriptPage({
        params: Promise.resolve({ jobId: COMPLETED_JOB.id }),
      })
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
