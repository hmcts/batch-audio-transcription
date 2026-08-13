import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeleteJobButton } from "@/components/jobs-table/delete-job-button";

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));
vi.mock("@/lib/base-path", () => ({
  apiPath: (p: string) => `http://localhost${p}`,
}));

describe("DeleteJobButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens a confirmation dialog before deleting", async () => {
    const user = userEvent.setup();
    render(
      <DeleteJobButton jobId="job-1" caseReference="PA/1" onDeleted={vi.fn()} />
    );

    await user.click(screen.getByRole("button", { name: /delete/i }));

    expect(await screen.findByRole("alertdialog")).toBeDefined();
    expect(screen.getByText(/permanently delete/i)).toBeDefined();
  });

  it("deletes and reports success on confirm", async () => {
    const user = userEvent.setup();
    const onDeleted = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <DeleteJobButton
        jobId="job-1"
        caseReference="PA/1"
        onDeleted={onDeleted}
      />
    );

    await user.click(screen.getByRole("button", { name: /delete/i }));
    await user.click(screen.getByRole("button", { name: /^delete$/i }));

    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith("job-1"));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost/api/jobs/job-1");
    expect(init.method).toBe("DELETE");
    expect(toastSuccess).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("reports an error and keeps the job on failure", async () => {
    const user = userEvent.setup();
    const onDeleted = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 502 })
    );

    render(
      <DeleteJobButton
        jobId="job-1"
        caseReference="PA/1"
        onDeleted={onDeleted}
      />
    );

    await user.click(screen.getByRole("button", { name: /delete/i }));
    await user.click(screen.getByRole("button", { name: /^delete$/i }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(onDeleted).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
