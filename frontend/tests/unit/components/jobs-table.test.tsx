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
    expect(screen.getByText(/^model$/i)).toBeDefined();
    // Prefers the server-resolved friendly name over the raw self URL.
    expect(
      screen.getByText(jobWithMetadata.modelDisplayName as string)
    ).toBeDefined();
  });

  it("prefers the resolved friendly name and links to public Speech docs", async () => {
    const job = {
      ...MOCK_JOBS[0],
      modelIdentifier:
        "https://uksouth.cognitiveservices.azure.com/speechtotext/v3.2/models/base/guid",
      modelDisplayName: "Base model — en-GB",
    };
    const user = userEvent.setup();
    render(<JobsTable jobs={[job]} />);

    await user.click(
      screen.getByRole("button", { name: /transcription run details/i })
    );

    expect(screen.getByText("Base model — en-GB")).toBeDefined();
    // The raw self URL is never rendered as visible text.
    expect(screen.queryByText(job.modelIdentifier as string)).toBeNull();
    const docsLink = screen.getByRole("link", { name: /about speech models/i });
    expect(docsLink.getAttribute("href")).toContain("learn.microsoft.com");
  });

  it("falls back to the raw model identifier when no friendly name is resolved", async () => {
    const job = {
      ...MOCK_JOBS[0],
      modelIdentifier: "azure-speech-batch-transcription (en-GB)",
      modelDisplayName: undefined,
    };
    const user = userEvent.setup();
    render(<JobsTable jobs={[job]} />);

    await user.click(
      screen.getByRole("button", { name: /transcription run details/i })
    );

    expect(
      screen.getByText("azure-speech-batch-transcription (en-GB)")
    ).toBeDefined();
    // No public-docs link when we only have the raw identifier.
    expect(
      screen.queryByRole("link", { name: /about speech models/i })
    ).toBeNull();
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

  it("gives the metadata dialog an accessible name", async () => {
    const user = userEvent.setup();
    render(<JobsTable jobs={[jobWithMetadata]} />);

    await user.click(
      screen.getByRole("button", {
        name: new RegExp(
          `transcription run details for ${jobWithMetadata.audioFileName}`,
          "i"
        ),
      })
    );

    const dialog = screen.getByRole("dialog", {
      name: new RegExp(
        `transcription run details for ${jobWithMetadata.audioFileName}`,
        "i"
      ),
    });
    expect(dialog).toBeDefined();
  });

  it("shows a terminal placeholder (not 'In progress…') for a FAILED job missing run details", async () => {
    const failedJob = {
      ...MOCK_JOBS[2], // FAILED
      audioDurationSeconds: 2401,
      transcriptionDurationSeconds: undefined,
      modelIdentifier: undefined,
      modelDisplayName: undefined,
    };
    const user = userEvent.setup();
    render(<JobsTable jobs={[failedJob]} />);

    await user.click(
      screen.getByRole("button", { name: /transcription run details/i })
    );

    expect(screen.queryByText(/in progress/i)).toBeNull();
    // Audio length is still known; the two unknown terminal values render "—".
    expect(screen.getAllByText("—").length).toBe(2);
  });

  it("shows 'In progress…' for a still-processing job missing run details", async () => {
    const processingJob = {
      ...MOCK_JOBS[0],
      status: "PROCESSING" as const,
      audioDurationSeconds: 1200,
      transcriptionDurationSeconds: undefined,
      modelIdentifier: undefined,
      modelDisplayName: undefined,
    };
    const user = userEvent.setup();
    render(<JobsTable jobs={[processingJob]} />);

    await user.click(
      screen.getByRole("button", { name: /transcription run details/i })
    );

    expect(screen.getAllByText(/in progress/i).length).toBe(2);
  });
});
