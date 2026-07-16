import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("GET /batch/api/version", () => {
  const original = process.env.GIT_SHA;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.GIT_SHA;
    } else {
      process.env.GIT_SHA = original;
    }
  });

  it("returns the baked-in GIT_SHA", async () => {
    process.env.GIT_SHA = "abc123def456";
    const { GET } = await import("@/app/api/version/route");

    const response = GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ version: "abc123def456" });
  });

  it("falls back to 'unknown' when GIT_SHA is unset", async () => {
    delete process.env.GIT_SHA;
    const { GET } = await import("@/app/api/version/route");

    const response = GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ version: "unknown" });
  });
});
