import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { JobsTable } from "@/components/jobs-table/jobs-table";
import { MOCK_JOBS } from "@/lib/mock-data";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
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

  it("gives each row a real, keyboard/screen-reader accessible link", () => {
    const completedJob = { ...MOCK_JOBS[0], status: "COMPLETED" as const };
    render(<JobsTable jobs={[completedJob]} />);
    const link = screen.getByRole("link", { name: /view transcript/i });
    expect(link.getAttribute("href")).toBe(`/jobs/${completedJob.id}`);
  });

  it("keeps rows queryable by their table row role", () => {
    render(<JobsTable jobs={[MOCK_JOBS[0]]} />);
    expect(screen.getAllByRole("row").length).toBeGreaterThan(0);
  });
});

describe("JobsTable run metadata popover", () => {
  const jobWithMetadata = MOCK_JOBS[0];

  it("reveals audio length, transcription time, and model on file name click", async () => {
    const user = userEvent.setup();
    render(<JobsTable jobs={[jobWithMetadata]} />);

    const trigger = screen.getByRole("button", {
      name: new RegExp(
        `transcription run details for ${jobWithMetadata.audioFileName}`,
        "i"
      ),
    });

    // Not visible until opened.
    expect(screen.queryByText(/audio length/i)).toBeNull();

    await user.click(trigger);

    expect(screen.getByText(/audio length/i)).toBeDefined();
    expect(screen.getByText(/transcription time/i)).toBeDefined();
    expect(screen.getByText(/model/i)).toBeDefined();
    expect(
      screen.getByText(jobWithMetadata.modelIdentifier as string)
    ).toBeDefined();
  });

  it("does not navigate to the transcript when the file name is clicked", async () => {
    const user = userEvent.setup();
    render(<JobsTable jobs={[jobWithMetadata]} />);

    const trigger = screen.getByRole("button", {
      name: new RegExp(
        `transcription run details for ${jobWithMetadata.audioFileName}`,
        "i"
      ),
    });
    await user.click(trigger);

    expect(push).not.toHaveBeenCalled();
  });

  it("shows the file name as plain text when no run metadata is available", () => {
    const jobWithoutMetadata = {
      ...MOCK_JOBS[2],
      audioDurationSeconds: undefined,
      transcriptionDurationSeconds: undefined,
      modelIdentifier: undefined,
    };
    render(<JobsTable jobs={[jobWithoutMetadata]} />);

    expect(
      screen.queryByRole("button", { name: /transcription run details/i })
    ).toBeNull();
    expect(screen.getByText(jobWithoutMetadata.audioFileName)).toBeDefined();
  });
});
