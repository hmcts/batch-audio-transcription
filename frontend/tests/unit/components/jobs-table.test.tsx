import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { JobsTable } from "@/components/jobs-table/jobs-table";
import { MOCK_JOBS } from "@/lib/mock-data";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
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

  it("shows dash for non-completed jobs", () => {
    const failedJobs = MOCK_JOBS.filter((j) => j.status === "FAILED");
    render(<JobsTable jobs={failedJobs} />);
    expect(screen.getByText("—")).toBeDefined();
  });
});
