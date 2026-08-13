import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ jobs: [] }),
      })
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

  it("removes a job from the list after it is deleted", async () => {
    const job = {
      id: "job-1",
      caseReference: "PA/00001/2026",
      tribunal: "First-tier Tribunal — Immigration and Asylum Chamber",
      audioFileName: "hearing.wav",
      uploadedAt: "2026-07-01T09:00:00Z",
      status: "COMPLETED",
      progressPercent: 100,
    };
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        return Promise.resolve({ ok: true, status: 204 });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ jobs: [job] }),
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<DashboardPage />);
    // Case reference appears in both the Transcripts and Uploads sections.
    await waitFor(() =>
      expect(screen.getAllByText("PA/00001/2026").length).toBeGreaterThan(0)
    );

    await user.click(screen.getAllByRole("button", { name: /delete/i })[0]);
    await user.click(screen.getByRole("button", { name: /^delete$/i }));

    await waitFor(() => expect(screen.queryByText("PA/00001/2026")).toBeNull());
  });
});
