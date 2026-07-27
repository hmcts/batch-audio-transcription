import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockListJobs } = vi.hoisted(() => ({ mockListJobs: vi.fn() }));

vi.mock("@/lib/api-client", () => ({
  listJobs: mockListJobs,
}));

function makeRequest(url = "http://localhost/api/jobs") {
  return new NextRequest(url);
}

describe("GET /api/jobs", () => {
  it("returns jobs from the backend", async () => {
    mockListJobs.mockResolvedValue({
      jobs: [{ id: "job-1" }],
      total: 1,
      limit: 20,
      offset: 0,
    });
    const { GET } = await import("@/app/api/jobs/route");

    const response = await GET(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.jobs).toEqual([{ id: "job-1" }]);
    expect(body.total).toBe(1);
  });

  it("returns a 502 when the backend call fails", async () => {
    mockListJobs.mockRejectedValue(new Error("backend down"));
    const { GET } = await import("@/app/api/jobs/route");

    const response = await GET(makeRequest());

    expect(response.status).toBe(502);
  });

  it("forwards the Easy Auth token to listJobs when present", async () => {
    mockListJobs.mockResolvedValue({ jobs: [], total: 0, limit: 20, offset: 0 });
    const { GET } = await import("@/app/api/jobs/route");

    const request = new NextRequest("http://localhost/api/jobs", {
      headers: { "x-ms-token-aad-access-token": "user-jwt-token" },
    });
    await GET(request);

    expect(mockListJobs).toHaveBeenCalledWith(undefined, "user-jwt-token");
  });

  it("passes null when the Easy Auth header is absent", async () => {
    mockListJobs.mockResolvedValue({ jobs: [], total: 0, limit: 20, offset: 0 });
    const { GET } = await import("@/app/api/jobs/route");

    await GET(makeRequest());

    expect(mockListJobs).toHaveBeenCalledWith(undefined, null);
  });
});
