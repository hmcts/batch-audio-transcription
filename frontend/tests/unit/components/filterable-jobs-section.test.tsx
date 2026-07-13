import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FilterableJobsSection } from "@/components/jobs-table/filterable-jobs-section";
import type { TranscriptionJob } from "@/lib/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const JOBS: TranscriptionJob[] = [
  {
    id: "job-1",
    caseReference: "PA/00001/2026",
    tribunal: "Tribunal",
    audioFileName: "alpha-hearing.mp3",
    uploadedAt: "2026-06-01T09:00:00Z",
    status: "COMPLETED",
  },
  {
    id: "job-2",
    caseReference: "EA/00002/2026",
    tribunal: "Tribunal",
    audioFileName: "beta-hearing.mp3",
    uploadedAt: "2026-06-15T09:00:00Z",
    status: "FAILED",
  },
  {
    id: "job-3",
    caseReference: "RP/00003/2026",
    tribunal: "Tribunal",
    audioFileName: "gamma-hearing.mp3",
    uploadedAt: "2026-06-10T09:00:00Z",
    status: "PROCESSING",
  },
];

function getRows() {
  return screen.getAllByRole("row").slice(1); // drop the header row
}

describe("FilterableJobsSection", () => {
  it("shows every job by default", () => {
    render(<FilterableJobsSection title="Uploads" jobs={JOBS} />);
    expect(getRows()).toHaveLength(3);
  });

  it("filters by case reference or file name search text", async () => {
    const user = userEvent.setup();
    render(<FilterableJobsSection title="Uploads" jobs={JOBS} />);

    await user.type(screen.getByLabelText(/search uploads/i), "beta");

    const rows = getRows();
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByText("EA/00002/2026")).toBeDefined();
  });

  it("filters by an unchecked status", async () => {
    const user = userEvent.setup();
    render(<FilterableJobsSection title="Uploads" jobs={JOBS} />);

    await user.click(screen.getByLabelText("Failed"));

    const rows = getRows();
    expect(rows).toHaveLength(2);
    expect(screen.queryByText("EA/00002/2026")).toBeNull();
  });

  it("does not show status checkboxes when every job shares one status", () => {
    render(
      <FilterableJobsSection
        title="Transcripts"
        jobs={JOBS.filter((j) => j.status === "COMPLETED")}
      />
    );
    expect(screen.queryByLabelText("Completed")).toBeNull();
  });

  it("sorts by uploaded date ascending after clicking the header once", async () => {
    const user = userEvent.setup();
    render(<FilterableJobsSection title="Uploads" jobs={JOBS} />);

    await user.click(screen.getByRole("button", { name: /uploaded/i }));

    const rows = getRows();
    expect(within(rows[0]).getByText("PA/00001/2026")).toBeDefined();
    expect(within(rows[2]).getByText("EA/00002/2026")).toBeDefined();
  });

  it("reverses sort direction on a second click of the same header", async () => {
    const user = userEvent.setup();
    render(<FilterableJobsSection title="Uploads" jobs={JOBS} />);

    const header = screen.getByRole("button", { name: /uploaded/i });
    await user.click(header);
    await user.click(header);

    const rows = getRows();
    expect(within(rows[0]).getByText("EA/00002/2026")).toBeDefined();
  });

  it("sorts by case reference alphabetically", async () => {
    const user = userEvent.setup();
    render(<FilterableJobsSection title="Uploads" jobs={JOBS} />);

    await user.click(screen.getByRole("button", { name: /case reference/i }));

    const rows = getRows();
    expect(within(rows[0]).getByText("EA/00002/2026")).toBeDefined();
    expect(within(rows[1]).getByText("PA/00001/2026")).toBeDefined();
    expect(within(rows[2]).getByText("RP/00003/2026")).toBeDefined();
  });
});
