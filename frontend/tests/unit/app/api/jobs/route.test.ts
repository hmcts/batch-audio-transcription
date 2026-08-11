import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const { mockListJobs } = vi.hoisted(() => ({ mockListJobs: vi.fn() }));

vi.mock("@/lib/api-client", () => ({
  listJobs: mockListJobs,
}));

function makeRequest(url = "http://localhost/api/jobs") {
  return new NextRequest(url);
}

describe("GET /api/jobs", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });
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

  it("forwards the Easy Auth context to listJobs when headers are present", async () => {
    vi.stubEnv("EASY_AUTH_ENABLED", "true");
    mockListJobs.mockResolvedValue({
      jobs: [],
      total: 0,
      limit: 20,
      offset: 0,
    });
    const { GET } = await import("@/app/api/jobs/route");

    const request = new NextRequest("http://localhost/api/jobs", {
      headers: {
        "x-ms-token-aad-access-token": "user-jwt-token",
        "x-ms-client-principal": "base64principal",
      },
    });
    await GET(request);

    expect(mockListJobs).toHaveBeenCalledWith(undefined, {
      accessToken: "user-jwt-token",
      clientPrincipal: "base64principal",
    });
  });

  it("passes a BackendAuthContext with nulls when Easy Auth headers are absent", async () => {
    mockListJobs.mockResolvedValue({
      jobs: [],
      total: 0,
      limit: 20,
      offset: 0,
    });
    const { GET } = await import("@/app/api/jobs/route");

    await GET(makeRequest());

    expect(mockListJobs).toHaveBeenCalledWith(undefined, {
      accessToken: null,
      clientPrincipal: null,
    });
  });
});
