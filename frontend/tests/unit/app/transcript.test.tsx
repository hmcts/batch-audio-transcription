import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

const MOCK_JOB = {
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
      confidence: 1.0,
      flaggedForReview: false,
    },
  ],
};

vi.mock("@/lib/api-client", () => ({
  getJob: vi.fn((id: string) =>
    Promise.resolve(id === "job-pa05217-2025" ? MOCK_JOB : null)
  ),
}));

describe("TranscriptPage", () => {
  it("renders case reference for known job", async () => {
    render(
      await TranscriptPage({
        params: Promise.resolve({ jobId: "job-pa05217-2025" }),
      })
    );
    expect(screen.getByText("PA/05217/2025")).toBeDefined();
  });

  it("renders tribunal name", async () => {
    render(
      await TranscriptPage({
        params: Promise.resolve({ jobId: "job-pa05217-2025" }),
      })
    );
    expect(
      screen.getByText("First-tier Tribunal — Immigration and Asylum Chamber")
    ).toBeDefined();
  });

  it("renders transcript segments", async () => {
    render(
      await TranscriptPage({
        params: Promise.resolve({ jobId: "job-pa05217-2025" }),
      })
    );
    expect(screen.getAllByText("Judge").length).toBeGreaterThan(0);
  });

  it("calls notFound for unknown job id", async () => {
    await expect(
      TranscriptPage({ params: Promise.resolve({ jobId: "unknown" }) })
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
