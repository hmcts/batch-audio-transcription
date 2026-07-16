import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptSegment,
  colorForSpeaker,
  getJob,
  getJobAudio,
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
    // The backend already labels speakers (e.g. "Speaker 0") via
    // add_speaker_labels before this ever reaches the frontend.
    {
      speaker: "Speaker 0",
      text: "Good morning.",
      start_time: 0,
      end_time: 2.5,
    },
    {
      speaker: "Speaker 1",
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
  audio_duration_seconds: 754.2,
  transcription_duration_seconds: 41.8,
  model_identifier: "https://eastus.example.com/models/base/xyz",
};

describe("listJobs", () => {
  it("maps backend jobs to frontend TranscriptionJob shape", async () => {
    mockFetchOnce({ jobs: [BACKEND_JOB] });

    const jobs = await listJobs();

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      id: BACKEND_JOB.job_id,
      caseReference: "PA/00001/2026",
      tribunal: "First-tier Tribunal — Immigration and Asylum Chamber",
      audioFileName: "hearing.wav",
      status: "COMPLETED",
      progressPercent: 100,
    });
    expect(jobs[0].segments).toHaveLength(2);
    expect(jobs[0].segments?.[0].speaker).toBe("Speaker 0");
  });

  it("maps run metadata (audio duration, transcription duration, model)", async () => {
    mockFetchOnce({ jobs: [BACKEND_JOB] });

    const jobs = await listJobs();

    expect(jobs[0].audioDurationSeconds).toBe(754.2);
    expect(jobs[0].transcriptionDurationSeconds).toBe(41.8);
    expect(jobs[0].modelIdentifier).toBe(
      "https://eastus.example.com/models/base/xyz"
    );
  });

  it("leaves run metadata undefined when the backend hasn't populated it yet", async () => {
    const pendingJob = {
      ...BACKEND_JOB,
      status: "submitted",
      transcription_duration_seconds: null,
      model_identifier: null,
    };
    mockFetchOnce({ jobs: [pendingJob] });

    const jobs = await listJobs();

    expect(jobs[0].audioDurationSeconds).toBe(754.2);
    expect(jobs[0].transcriptionDurationSeconds).toBeUndefined();
    expect(jobs[0].modelIdentifier).toBeUndefined();
  });

  it("sends the bearer token from TRANSCRIPTION_API_KEY", async () => {
    const fetchMock = mockFetchOnce({ jobs: [] });
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

  it("maps the backend caller_name onto the job's caller", async () => {
    mockFetchOnce({ ...BACKEND_JOB, caller_name: "local-dev" });
    const job = await getJob(BACKEND_JOB.job_id);
    expect(job?.caller).toBe("local-dev");
  });

  it("leaves caller undefined when the backend omits caller_name", async () => {
    mockFetchOnce(BACKEND_JOB);
    const job = await getJob(BACKEND_JOB.job_id);
    expect(job?.caller).toBeUndefined();
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

  it("forwards the audio duration when provided", async () => {
    const fetchMock = mockFetchOnce({
      ...BACKEND_JOB,
      status: "pending",
      dialogue_entries: null,
    });

    await submitJob(
      "https://storage.example.com/audio.wav?sig=abc",
      {
        caseReference: "PA/00002/2026",
        tribunal: "Tribunal",
        audioFileName: "hearing2.wav",
      },
      "uploads/x/hearing2.wav",
      9360
    );

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.audio_duration_seconds).toBe(9360);
  });

  it("maps audio_duration_seconds from the backend onto the job", async () => {
    mockFetchOnce({ ...BACKEND_JOB, audio_duration_seconds: 9360 });
    const job = await getJob(BACKEND_JOB.job_id);
    expect(job?.audioDurationSeconds).toBe(9360);
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

describe("getJobAudio", () => {
  it("returns the backend's response as-is for a successful range request", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 206,
      headers: new Headers({ "Content-Range": "bytes 0-9/20" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await getJobAudio("job-1", "bytes=0-9");
    expect(response.status).toBe(206);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Range).toBe("bytes=0-9");
  });

  it("forwards a non-2xx status instead of throwing", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 416,
      headers: new Headers({ "Content-Range": "bytes */20" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await getJobAudio("job-1", "bytes=999-1000");
    expect(response.status).toBe(416);
    expect(response.headers.get("Content-Range")).toBe("bytes */20");
  });
});

describe("acceptSegment", () => {
  it("POSTs to the segment accept endpoint and maps the returned job", async () => {
    const fetchMock = mockFetchOnce({
      ...BACKEND_JOB,
      dialogue_entries: [
        {
          speaker: "Speaker 0",
          text: "Good morning.",
          start_time: 0,
          end_time: 2.5,
          confidence: 0.4,
          accepted: true,
          correction_history: [
            {
              timestamp: "2026-07-01T09:31:00Z",
              kind: "accept_all",
              previous_text: "Good morning.",
              new_text: "Good morning.",
            },
          ],
        },
      ],
    });

    const job = await acceptSegment(BACKEND_JOB.job_id, 0);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain(
      `/api/v1/jobs/${BACKEND_JOB.job_id}/segments/0/accept`
    );
    expect(init.method).toBe("POST");
    // The accepted flag and the accept_all history entry survive the mapping
    // so the UI can distinguish an accept from a real correction (DIAAT-230).
    expect(job.segments?.[0].accepted).toBe(true);
    expect(job.segments?.[0].correctionHistory?.[0].kind).toBe("accept_all");
  });

  it("defaults accepted to false when the backend omits it", async () => {
    mockFetchOnce(BACKEND_JOB);
    const job = await acceptSegment(BACKEND_JOB.job_id, 0);
    expect(job.segments?.[0].accepted).toBe(false);
  });
});

describe("alternatives mapping (DIAAT-233)", () => {
  it("maps snake_case nBest alternatives onto the segment", async () => {
    mockFetchOnce({
      ...BACKEND_JOB,
      dialogue_entries: [
        {
          speaker: "Speaker 0",
          text: "Hello world.",
          start_time: 0,
          end_time: 2.5,
          alternatives: [
            {
              start_word_index: 0,
              end_word_index: 1,
              candidates: [
                {
                  text: "Hello world.",
                  confidence: 0.564,
                  lexical: "hello world",
                },
                { text: "hello worm", confidence: 0.5, lexical: "hello worm" },
                { text: "hello word", confidence: null, lexical: null },
              ],
            },
          ],
        },
      ],
    });

    const job = await getJob(BACKEND_JOB.job_id);
    const alternatives = job?.segments?.[0].alternatives;
    expect(alternatives).toHaveLength(1);
    expect(alternatives?.[0].startWordIndex).toBe(0);
    expect(alternatives?.[0].endWordIndex).toBe(1);
    expect(alternatives?.[0].candidates.map((c) => c.text)).toEqual([
      "Hello world.",
      "hello worm",
      "hello word",
    ]);
    // A null backend confidence/lexical becomes undefined, never 0/"".
    expect(alternatives?.[0].candidates[2].confidence).toBeUndefined();
    expect(alternatives?.[0].candidates[2].lexical).toBeUndefined();
  });

  it("carries a missing word-range through as undefined indices", async () => {
    mockFetchOnce({
      ...BACKEND_JOB,
      dialogue_entries: [
        {
          speaker: "Speaker 0",
          text: "Hello world.",
          start_time: 0,
          end_time: 2.5,
          alternatives: [
            {
              start_word_index: null,
              end_word_index: null,
              candidates: [{ text: "Hello world." }, { text: "hello worm" }],
            },
          ],
        },
      ],
    });

    const job = await getJob(BACKEND_JOB.job_id);
    const group = job?.segments?.[0].alternatives?.[0];
    expect(group?.startWordIndex).toBeUndefined();
    expect(group?.endWordIndex).toBeUndefined();
  });

  it("leaves alternatives undefined when the backend omits them", async () => {
    mockFetchOnce(BACKEND_JOB);
    const job = await getJob(BACKEND_JOB.job_id);
    expect(job?.segments?.[0].alternatives).toBeUndefined();
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
