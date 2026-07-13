import { describe, expect, it, vi } from "vitest";

const { mockListJobs } = vi.hoisted(() => ({ mockListJobs: vi.fn() }));

vi.mock("@/lib/api-client", () => ({
  listJobs: mockListJobs,
}));

describe("GET /api/jobs", () => {
  it("returns jobs from the backend", async () => {
    mockListJobs.mockResolvedValue([{ id: "job-1" }]);
    const { GET } = await import("@/app/api/jobs/route");

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.jobs).toEqual([{ id: "job-1" }]);
  });

  it("returns a 502 when the backend call fails", async () => {
    mockListJobs.mockRejectedValue(new Error("backend down"));
    const { GET } = await import("@/app/api/jobs/route");

    const response = await GET();

    expect(response.status).toBe(502);
  });
});
