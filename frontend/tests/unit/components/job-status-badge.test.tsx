import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { JobStatusBadge } from "@/components/job-status/job-status-badge";

describe("JobStatusBadge", () => {
  it("renders COMPLETED with success label", () => {
    render(<JobStatusBadge status="COMPLETED" />);
    expect(screen.getByText("Completed")).toBeDefined();
  });

  it("renders PROCESSING with label", () => {
    render(<JobStatusBadge status="PROCESSING" />);
    expect(screen.getByText("Processing…")).toBeDefined();
  });

  it("renders FAILED with label", () => {
    render(<JobStatusBadge status="FAILED" />);
    expect(screen.getByText("Failed")).toBeDefined();
  });

  it("renders PENDING with label", () => {
    render(<JobStatusBadge status="PENDING" />);
    expect(screen.getByText("Pending")).toBeDefined();
  });
});
