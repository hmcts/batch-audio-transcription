import type { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const { mockUploadAndSubmit } = vi.hoisted(() => ({
  mockUploadAndSubmit: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  uploadAndSubmit: mockUploadAndSubmit,
}));

// jsdom's FormData/File brand checks are unreliable in this test
// environment, so stub Request.formData() directly rather than round-
// tripping a real multipart body through the DOM FormData/File classes.
function requestWithFile(
  file: Blob | null,
  durationSeconds?: string,
  easyAuthToken?: string,
  clientPrincipal?: string,
  extraFields: Record<string, unknown> = {}
) {
  const fields: Record<string, unknown> = { file, ...extraFields };
  if (durationSeconds !== undefined) {
    fields.audio_duration_seconds = durationSeconds;
  }
  return {
    headers: {
      get: (name: string) => {
        if (name === "x-ms-token-aad-access-token")
          return easyAuthToken ?? null;
        if (name === "x-ms-client-principal") return clientPrincipal ?? null;
        return null;
      },
    },
    formData: async () => ({
      get: (key: string) => fields[key] ?? null,
    }),
  } as unknown as NextRequest;
}

function audioBlob() {
  return new Blob(["bytes"], { type: "audio/wav" });
}

describe("POST /api/upload", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  it("uploads and submits the file, returning the created job", async () => {
    mockUploadAndSubmit.mockResolvedValue({ id: "job-1", status: "PENDING" });
    const { POST } = await import("@/app/api/upload/route");

    const response = await POST(requestWithFile(audioBlob()));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.job).toEqual({ id: "job-1", status: "PENDING" });
    expect(mockUploadAndSubmit).toHaveBeenCalledWith(
      expect.any(Blob),
      "audio",
      undefined,
      { accessToken: null, clientPrincipal: null },
      undefined // no hearing
    );
  });

  it("forwards a parsed audio duration to uploadAndSubmit", async () => {
    mockUploadAndSubmit.mockResolvedValue({ id: "job-1", status: "PENDING" });
    const { POST } = await import("@/app/api/upload/route");

    await POST(requestWithFile(audioBlob(), "9360.5"));

    expect(mockUploadAndSubmit).toHaveBeenCalledWith(
      expect.any(Blob),
      "audio",
      9360.5,
      { accessToken: null, clientPrincipal: null },
      undefined // no hearing
    );
  });

  it("omits the duration when it is not a positive number", async () => {
    mockUploadAndSubmit.mockResolvedValue({ id: "job-1", status: "PENDING" });
    const { POST } = await import("@/app/api/upload/route");

    await POST(requestWithFile(audioBlob(), "not-a-number"));

    expect(mockUploadAndSubmit).toHaveBeenCalledWith(
      expect.any(Blob),
      "audio",
      undefined,
      { accessToken: null, clientPrincipal: null },
      undefined // no hearing
    );
  });

  it("rejects partially-numeric values rather than truncating them", async () => {
    mockUploadAndSubmit.mockResolvedValue({ id: "job-1", status: "PENDING" });
    const { POST } = await import("@/app/api/upload/route");

    // parseFloat would have accepted "123abc" as 123; Number() rejects it.
    await POST(requestWithFile(audioBlob(), "123abc"));

    expect(mockUploadAndSubmit).toHaveBeenCalledWith(
      expect.any(Blob),
      "audio",
      undefined,
      { accessToken: null, clientPrincipal: null },
      undefined // no hearing
    );
  });

  it("forwards both Easy Auth headers to uploadAndSubmit when present", async () => {
    vi.stubEnv("EASY_AUTH_ENABLED", "true");
    mockUploadAndSubmit.mockResolvedValue({ id: "job-1", status: "PENDING" });
    const { POST } = await import("@/app/api/upload/route");

    await POST(
      requestWithFile(
        audioBlob(),
        undefined,
        "user-jwt-token",
        "base64principal"
      )
    );

    expect(mockUploadAndSubmit).toHaveBeenCalledWith(
      expect.any(Blob),
      "audio",
      undefined,
      { accessToken: "user-jwt-token", clientPrincipal: "base64principal" },
      undefined // no hearing
    );
  });

  it("forwards only the access token when clientPrincipal is absent", async () => {
    mockUploadAndSubmit.mockResolvedValue({ id: "job-1", status: "PENDING" });
    const { POST } = await import("@/app/api/upload/route");

    await POST(requestWithFile(audioBlob(), undefined, "user-jwt-token"));

    expect(mockUploadAndSubmit).toHaveBeenCalledWith(
      expect.any(Blob),
      "audio",
      undefined,
      { accessToken: "user-jwt-token", clientPrincipal: null },
      undefined // no hearing
    );
  });

  describe("hearing correlation (DIAAT-280)", () => {
    const HEARING_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
    const noAuth = { accessToken: null, clientPrincipal: null };

    async function postWithHearing(fields: Record<string, unknown>) {
      mockUploadAndSubmit.mockResolvedValue({ id: "job-1", status: "PENDING" });
      const { POST } = await import("@/app/api/upload/route");
      const response = await POST(
        requestWithFile(audioBlob(), undefined, undefined, undefined, fields)
      );
      expect(response.status).toBe(201);
      return mockUploadAndSubmit.mock.calls.at(-1)?.[4];
    }

    it("passes the browser's hearing ID and file count through", async () => {
      const hearing = await postWithHearing({
        hearing_id: HEARING_ID,
        hearing_file_count: "2",
      });
      expect(hearing).toEqual({ hearingId: HEARING_ID, fileCount: 2 });
      expect(mockUploadAndSubmit).toHaveBeenLastCalledWith(
        expect.any(Blob),
        "audio",
        undefined,
        noAuth,
        { hearingId: HEARING_ID, fileCount: 2 }
      );
    });

    it("accepts the bounds of the file count", async () => {
      for (const count of ["1", "50"]) {
        const hearing = await postWithHearing({
          hearing_id: HEARING_ID,
          hearing_file_count: count,
        });
        expect(hearing).toEqual({
          hearingId: HEARING_ID,
          fileCount: Number(count),
        });
      }
    });

    it.each([
      ["missing", {}],
      ["no file count", { hearing_id: HEARING_ID }],
      ["no hearing ID", { hearing_file_count: "2" }],
      [
        "a non-UUID ID",
        { hearing_id: "PA_50123_2024", hearing_file_count: "2" },
      ],
      ["a count of 0", { hearing_id: HEARING_ID, hearing_file_count: "0" }],
      ["a count of 51", { hearing_id: HEARING_ID, hearing_file_count: "51" }],
      [
        "a fractional count",
        { hearing_id: HEARING_ID, hearing_file_count: "2.5" },
      ],
      ["a padded count", { hearing_id: HEARING_ID, hearing_file_count: " 2" }],
      [
        "a non-numeric count",
        { hearing_id: HEARING_ID, hearing_file_count: "x" },
      ],
    ])("sends no hearing for %s", async (_label, fields) => {
      expect(await postWithHearing(fields)).toBeUndefined();
    });
  });

  it("returns 400 when no file is provided", async () => {
    const { POST } = await import("@/app/api/upload/route");
    const response = await POST(requestWithFile(null));
    expect(response.status).toBe(400);
  });

  it("returns 502 when the backend call fails", async () => {
    mockUploadAndSubmit.mockRejectedValue(new Error("backend down"));
    const { POST } = await import("@/app/api/upload/route");

    const response = await POST(requestWithFile(audioBlob()));

    expect(response.status).toBe(502);
  });

  it("returns 413 when the request body is truncated or unparseable", async () => {
    // Next.js truncates bodies larger than experimental.proxyClientMaxBodySize,
    // which corrupts the multipart payload and makes formData() throw. The route
    // must surface a clear 413 rather than an opaque 500, and must not call the
    // backend.
    const { POST } = await import("@/app/api/upload/route");

    const request = {
      headers: { get: () => null },
      formData: async () => {
        throw new TypeError("Failed to parse body as FormData.");
      },
    } as unknown as NextRequest;

    const response = await POST(request);

    expect(response.status).toBe(413);
    expect(mockUploadAndSubmit).not.toHaveBeenCalled();
  });

  it("rethrows unexpected body errors instead of masking them as 413", async () => {
    // Only the known FormData truncation/boundary error should become a 413;
    // an unexpected runtime error must surface as a real 500.
    const { POST } = await import("@/app/api/upload/route");

    const request = {
      headers: { get: () => null },
      formData: async () => {
        throw new Error("unexpected runtime failure");
      },
    } as unknown as NextRequest;

    await expect(POST(request)).rejects.toThrow("unexpected runtime failure");
    expect(mockUploadAndSubmit).not.toHaveBeenCalled();
  });
});
