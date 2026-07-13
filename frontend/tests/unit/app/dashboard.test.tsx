import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DashboardPage from "@/app/page";
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
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

const SAMPLE_JOBS: TranscriptionJob[] = [
  {
    id: "job-1",
    caseReference: "PA/05217/2025",
    tribunal: "First-tier Tribunal — Immigration and Asylum Chamber",
    audioFileName: "hearing.mp3",
    uploadedAt: "2026-06-28T09:15:00Z",
    completedAt: "2026-06-28T09:47:00Z",
    status: "COMPLETED",
    progressPercent: 100,
  },
  {
    id: "job-2",
    caseReference: "EA/11042/2025",
    tribunal: "First-tier Tribunal — Immigration and Asylum Chamber",
    audioFileName: "hearing-2.mp3",
    uploadedAt: "2026-06-27T14:30:00Z",
    completedAt: "2026-06-27T15:02:00Z",
    status: "COMPLETED",
    progressPercent: 100,
  },
];

function mockFetchJobs(jobs: TranscriptionJob[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ jobs }),
    })
  );
}

describe("DashboardPage", () => {
  beforeEach(() => {
    mockFetchJobs(SAMPLE_JOBS);
  });

  it("renders page heading", () => {
    render(<DashboardPage />);
    expect(screen.getByText("Batch Audio Transcription")).toBeDefined();
  });

  it("renders upload section", () => {
    render(<DashboardPage />);
    expect(screen.getByText(/drag and drop an audio file/i)).toBeDefined();
  });

  it("renders recent transcripts section", () => {
    render(<DashboardPage />);
    expect(screen.getByText("Recent transcripts")).toBeDefined();
  });

  it("shows jobs fetched from the API", async () => {
    render(<DashboardPage />);
    await waitFor(() => {
      expect(screen.getAllByText("PA/05217/2025").length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText("EA/11042/2025").length).toBeGreaterThan(0);
  });

  it("shows an empty state when the API returns no jobs", async () => {
    mockFetchJobs([]);
    render(<DashboardPage />);
    await waitFor(() => {
      expect(
        screen.getAllByText(/no transcription jobs yet/i).length
      ).toBeGreaterThan(0);
    });
  });
});
