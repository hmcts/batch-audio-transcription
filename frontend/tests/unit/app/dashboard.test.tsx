import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DashboardPage from "@/app/page";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

describe("DashboardPage", () => {
  it("renders page heading", () => {
    render(<DashboardPage />);
    expect(screen.getByText("Batch Audio Transcription")).toBeDefined();
  });

  it("renders upload section", () => {
    render(<DashboardPage />);
    expect(
      screen.getByText(/drag and drop an audio file/i)
    ).toBeDefined();
  });

  it("renders recent transcripts section", () => {
    render(<DashboardPage />);
    expect(screen.getByText("Recent transcripts")).toBeDefined();
  });

  it("shows mock completed jobs", () => {
    render(<DashboardPage />);
    expect(screen.getAllByText("PA/05217/2025").length).toBeGreaterThan(0);
    expect(screen.getAllByText("EA/11042/2025").length).toBeGreaterThan(0);
  });
});
