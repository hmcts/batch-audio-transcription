import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const { mockDeleteJob, MockBackendApiError } = vi.hoisted(() => {
  class MockBackendApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = "BackendApiError";
      this.status = status;
    }
  }
  return { mockDeleteJob: vi.fn(), MockBackendApiError };
});

vi.mock("@/lib/api-client", () => ({
  deleteJob: mockDeleteJob,
  BackendApiError: MockBackendApiError,
}));

function makeRequest() {
  return new NextRequest("http://localhost/api/jobs/job-1", {
    method: "DELETE",
  });
}

const context = { params: Promise.resolve({ jobId: "job-1" }) };

describe("DELETE /api/jobs/[jobId]", () => {
  it("returns 204 on success and forwards jobId + auth", async () => {
    mockDeleteJob.mockResolvedValue(undefined);
    const { DELETE } = await import("@/app/api/jobs/[jobId]/route");

    const response = await DELETE(makeRequest(), context);

    expect(response.status).toBe(204);
    expect(mockDeleteJob).toHaveBeenCalledWith("job-1", {
      accessToken: null,
      clientPrincipal: null,
    });
  });

  it("maps a backend 404 to 404", async () => {
    mockDeleteJob.mockRejectedValue(new MockBackendApiError("nope", 404));
    const { DELETE } = await import("@/app/api/jobs/[jobId]/route");

    const response = await DELETE(makeRequest(), context);

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toEqual({ error: expect.any(String) });
  });

  it("maps any other backend error to 502", async () => {
    mockDeleteJob.mockRejectedValue(new Error("boom"));
    const { DELETE } = await import("@/app/api/jobs/[jobId]/route");

    const response = await DELETE(makeRequest(), context);

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body).toEqual({ error: expect.any(String) });
  });
});
