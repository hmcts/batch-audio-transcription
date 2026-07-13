import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { JobsTable } from "@/components/jobs-table/jobs-table";
import { MOCK_JOBS } from "@/lib/mock-data";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

describe("JobsTable", () => {
  it("shows empty state message when no jobs", () => {
    render(<JobsTable jobs={[]} />);
    expect(screen.getByText(/no transcription jobs yet/i)).toBeDefined();
  });

  it("renders a row for each job", () => {
    render(<JobsTable jobs={MOCK_JOBS} />);
    for (const job of MOCK_JOBS) {
      expect(screen.getByText(job.caseReference)).toBeDefined();
    }
  });

  it("shows transcript link for COMPLETED jobs", () => {
    const completedJobs = MOCK_JOBS.filter((j) => j.status === "COMPLETED");
    render(<JobsTable jobs={completedJobs} />);
    expect(screen.getAllByText(/view transcript/i).length).toBe(
      completedJobs.length
    );
  });

  it("shows a details link for non-completed jobs", () => {
    const failedJobs = MOCK_JOBS.filter((j) => j.status === "FAILED");
    render(<JobsTable jobs={failedJobs} />);
    expect(screen.getAllByText(/view details/i).length).toBe(failedJobs.length);
  });

  it("shows percentage alongside the progress bar for processing jobs", () => {
    const processingJob = {
      ...MOCK_JOBS[0],
      id: "job-processing-test",
      status: "PROCESSING" as const,
      progressPercent: 60,
    };
    render(<JobsTable jobs={[processingJob]} />);
    expect(screen.getByText("60%")).toBeDefined();
  });
});
