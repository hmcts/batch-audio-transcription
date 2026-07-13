import { describe, expect, it, vi } from "vitest";

const { mockUploadAndSubmit } = vi.hoisted(() => ({
  mockUploadAndSubmit: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  uploadAndSubmit: mockUploadAndSubmit,
}));

// jsdom's FormData/File brand checks are unreliable in this test
// environment, so stub Request.formData() directly rather than round-
// tripping a real multipart body through the DOM FormData/File classes.
function requestWithFile(file: Blob | null) {
  return {
    formData: async () => ({
      get: (key: string) => (key === "file" ? file : null),
    }),
  } as unknown as Request;
}

function audioBlob() {
  return new Blob(["bytes"], { type: "audio/wav" });
}

describe("POST /api/upload", () => {
  it("uploads and submits the file, returning the created job", async () => {
    mockUploadAndSubmit.mockResolvedValue({ id: "job-1", status: "PENDING" });
    const { POST } = await import("@/app/api/upload/route");

    const response = await POST(requestWithFile(audioBlob()));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.job).toEqual({ id: "job-1", status: "PENDING" });
    expect(mockUploadAndSubmit).toHaveBeenCalledWith(expect.any(Blob), "audio");
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
});
