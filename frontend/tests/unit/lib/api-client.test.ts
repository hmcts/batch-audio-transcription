import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  colorForSpeaker,
  getJob,
  listJobs,
  submitJob,
  uploadAndSubmit,
  uploadAudio,
} from "@/lib/api-client";

beforeEach(() => {
  vi.unstubAllGlobals();
});

function mockFetchOnce(
  body: unknown,
  init?: { ok?: boolean; status?: number }
) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const BACKEND_JOB = {
  job_id: "11111111-1111-1111-1111-111111111111",
  status: "succeeded",
  created_at: "2026-07-01T09:00:00Z",
  updated_at: "2026-07-01T09:30:00Z",
  dialogue_entries: [
    { speaker: "0", text: "Good morning.", start_time: 0, end_time: 2.5 },
    {
      speaker: "1",
      text: "Good morning, Judge.",
      start_time: 2.5,
      end_time: 5,
    },
  ],
  error_message: null,
  metadata: {
    case_reference: "PA/00001/2026",
    tribunal: "First-tier Tribunal — Immigration and Asylum Chamber",
    audio_file_name: "hearing.wav",
  },
};

describe("listJobs", () => {
  it("maps backend jobs to frontend TranscriptionJob shape", async () => {
    mockFetchOnce({ jobs: [BACKEND_JOB], total: 1, limit: 20, offset: 0 });

    const result = await listJobs();

    expect(result.total).toBe(1);
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]).toMatchObject({
      id: BACKEND_JOB.job_id,
      caseReference: "PA/00001/2026",
      tribunal: "First-tier Tribunal — Immigration and Asylum Chamber",
      audioFileName: "hearing.wav",
      status: "COMPLETED",
      progressPercent: 100,
    });
    expect(result.jobs[0].segments).toHaveLength(2);
    expect(result.jobs[0].segments?.[0].speaker).toBe("Speaker 0");
  });

  it("sends the bearer token from TRANSCRIPTION_API_KEY", async () => {
    const fetchMock = mockFetchOnce({
      jobs: [],
      total: 0,
      limit: 20,
      offset: 0,
    });
    await listJobs();

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer test-api-key");
  });
});

describe("getJob", () => {
  it("returns a mapped job when found", async () => {
    mockFetchOnce(BACKEND_JOB);
    const job = await getJob(BACKEND_JOB.job_id);
    expect(job?.caseReference).toBe("PA/00001/2026");
  });

  it("returns null on 404", async () => {
    mockFetchOnce({ detail: "Job not found" }, { ok: false, status: 404 });
    const job = await getJob("unknown");
    expect(job).toBeNull();
  });

  it("returns null on 422 (backend rejects non-UUID job ids before lookup)", async () => {
    mockFetchOnce({ detail: "Invalid UUID" }, { ok: false, status: 422 });
    const job = await getJob("not-a-uuid");
    expect(job).toBeNull();
  });

  it("does not swallow non-404 errors", async () => {
    mockFetchOnce({ detail: "boom" }, { ok: false, status: 500 });
    await expect(getJob("x")).rejects.toThrow();
  });
});

describe("submitJob", () => {
  it("posts audio_url and metadata to the backend", async () => {
    const fetchMock = mockFetchOnce({
      ...BACKEND_JOB,
      status: "pending",
      dialogue_entries: null,
    });

    await submitJob("https://storage.example.com/audio.wav?sig=abc", {
      caseReference: "PA/00002/2026",
      tribunal: "Tribunal",
      audioFileName: "hearing2.wav",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v1/jobs");
    const body = JSON.parse(init.body);
    expect(body.audio_url).toBe(
      "https://storage.example.com/audio.wav?sig=abc"
    );
    expect(body.metadata.case_reference).toBe("PA/00002/2026");
  });
});

describe("uploadAudio", () => {
  it("posts the file as multipart form data", async () => {
    const fetchMock = mockFetchOnce({
      audio_url: "https://storage.example.com/audio.wav?sig=xyz",
      blob_name: "uploads/x/audio.wav",
    });

    const file = new Blob(["fake-bytes"], { type: "audio/wav" });
    const result = await uploadAudio(file, "hearing.wav");

    expect(result.audio_url).toBe(
      "https://storage.example.com/audio.wav?sig=xyz"
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v1/uploads");
    expect(init.body).toBeInstanceOf(FormData);
  });
});

describe("uploadAndSubmit", () => {
  it("uploads then submits, deriving a case reference from the filename", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: () =>
          Promise.resolve({
            audio_url: "https://storage.example.com/audio.wav?sig=xyz",
            blob_name: "uploads/x/PA_00003_2026.wav",
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: () =>
          Promise.resolve({
            ...BACKEND_JOB,
            status: "pending",
            dialogue_entries: null,
            metadata: { case_reference: "PA/00003/2026" },
          }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const file = new Blob(["fake-bytes"], { type: "audio/wav" });
    const job = await uploadAndSubmit(file, "PA_00003_2026.wav");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(job.caseReference).toBe("PA/00003/2026");
  });
});

describe("colorForSpeaker", () => {
  it("is deterministic for the same speaker id", () => {
    expect(colorForSpeaker("0")).toBe(colorForSpeaker("0"));
  });

  it("returns a value from the fixed palette", () => {
    const color = colorForSpeaker("3");
    expect(color).toMatch(/^#[0-9a-f]{6}$/);
  });
});
