import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

vi.mock("@/lib/base-path", () => ({
  BASE_PATH: "",
  apiPath: (path: string) => `http://localhost${path}`,
}));

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ jobs: [] }) })
    );
  });
  it("renders page heading", () => {
    render(<DashboardPage />);
    expect(screen.getByText("Batch Audio Transcription")).toBeDefined();
  });

  it("renders upload section", () => {
    render(<DashboardPage />);
    expect(screen.getByText(/drag and drop an audio file/i)).toBeDefined();
  });

  it("renders exactly the transcripts and uploads sections", () => {
    render(<DashboardPage />);
    expect(screen.getByText(/^transcripts/i)).toBeDefined();
    expect(screen.getByText(/^uploads/i)).toBeDefined();
  });

  it("shows jobs returned by the API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            jobs: [
              {
                id: "job-1",
                caseReference: "PA/05217/2025",
                tribunal: "First-tier Tribunal",
                audioFileName: "hearing1.wav",
                status: "COMPLETED",
                progressPercent: 100,
              },
              {
                id: "job-2",
                caseReference: "EA/11042/2025",
                tribunal: "First-tier Tribunal",
                audioFileName: "hearing2.wav",
                status: "COMPLETED",
                progressPercent: 100,
              },
            ],
          }),
      })
    );

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getAllByText("PA/05217/2025").length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText("EA/11042/2025").length).toBeGreaterThan(0);
  });
});
