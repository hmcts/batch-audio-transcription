import type {
  LowConfidenceSegment,
  TranscriptAccuracy,
  TranscriptionJob,
  TranscriptSegment,
} from "./types";

const SEGMENT_COLORS: Record<string, string> = {
  Judge: "#6d28d9",
  Counsel: "#1d4ed8",
  Appellant: "#065f46",
  Respondent: "#92400e",
  Interpreter: "#9f1239",
};

function color(speaker: string): string {
  return SEGMENT_COLORS[speaker] ?? "#374151";
}

const JOB_1_SEGMENTS: TranscriptSegment[] = [
  {
    id: "s1",
    speaker: "Judge",
    speakerColor: color("Judge"),
    text: "Good morning. We are on the record. This is the appeal of the appellant, reference PA/05217/2025, before the First-tier Tribunal, Immigration and Asylum Chamber, sitting at Taylor House. I am Judge Marwood. Can I take the appearances, please.",
    startTime: 0,
    duration: 19,
    confidence: 0.98,
    flaggedForReview: false,
  },
  {
    id: "s2",
    speaker: "Counsel",
    speakerColor: color("Counsel"),
    text: "Good morning, Judge. My name is Adeyemi, of counsel, instructed by Whitfield Law. I appear on behalf of the appellant.",
    startTime: 19,
    duration: 11,
    confidence: 0.58,
    flaggedForReview: true,
  },
  {
    id: "s3",
    speaker: "Respondent",
    speakerColor: color("Respondent"),
    text: "Good morning, Judge. Clarke, I appear on behalf of the Secretary of State as respondent.",
    startTime: 30,
    duration: 9,
    confidence: 0.96,
    flaggedForReview: false,
  },
  {
    id: "s4",
    speaker: "Judge",
    speakerColor: color("Judge"),
    text: "Thank you. I understand we have a Tigrinya interpreter today. Could the interpreter confirm their full name and that they are able to interpret for the appellant in Tigrinya without any difficulty.",
    startTime: 39,
    duration: 14,
    confidence: 0.97,
    flaggedForReview: false,
  },
  {
    id: "s5",
    speaker: "Interpreter",
    speakerColor: color("Interpreter"),
    text: "Yes, Judge. My name is Helen Tesfay. I am interpreting in Tigrinya and the appellant and I understand one another without any difficulty.",
    startTime: 53,
    duration: 11,
    confidence: 0.96,
    flaggedForReview: false,
  },
  {
    id: "s6",
    speaker: "Appellant",
    speakerColor: color("Appellant"),
    text: "I confirm that I can understand the interpreter clearly.",
    startTime: 64,
    duration: 8,
    confidence: 0.61,
    flaggedForReview: true,
  },
];

const JOB_1_ACCURACY: TranscriptAccuracy = {
  confidenceScore: 95.3,
  wordsTranscribed: 2284,
  lowConfidenceCount: 6,
  confidenceThreshold: 65,
  hasCorrections: true,
  wordErrorRate: 4.7,
  correctedPercent: 12,
  hasBaseline: false,
};

// All entries sit below the 65% threshold (see JOB_1_ACCURACY) — the
// "needs review" list only contains genuinely low-confidence segments.
const JOB_1_LOW_CONFIDENCE: LowConfidenceSegment[] = [
  {
    speaker: "Counsel",
    speakerColor: color("Counsel"),
    confidence: 0.58,
    startTime: 19,
  },
  {
    speaker: "Appellant",
    speakerColor: color("Appellant"),
    confidence: 0.61,
    startTime: 159,
  },
  {
    speaker: "Appellant",
    speakerColor: color("Appellant"),
    confidence: 0.55,
    startTime: 178,
  },
  {
    speaker: "Appellant",
    speakerColor: color("Appellant"),
    confidence: 0.52,
    startTime: 220,
  },
  {
    speaker: "Respondent",
    speakerColor: color("Respondent"),
    confidence: 0.63,
    startTime: 239,
  },
  {
    speaker: "Appellant",
    speakerColor: color("Appellant"),
    confidence: 0.64,
    startTime: 264,
  },
];

const JOB_2_SEGMENTS: TranscriptSegment[] = [
  {
    id: "j2s1",
    speaker: "Judge",
    speakerColor: color("Judge"),
    text: "This is the resumed hearing in the matter of the appellant. The appellant is present and represented. Can we confirm the interpreter is also present.",
    startTime: 0,
    duration: 12,
    confidence: 0.99,
    flaggedForReview: false,
  },
  {
    id: "j2s2",
    speaker: "Counsel",
    speakerColor: color("Counsel"),
    text: "Yes, Judge. Counsel for the appellant, Ms. Okafor. The interpreter is present and ready.",
    startTime: 12,
    duration: 8,
    confidence: 0.97,
    flaggedForReview: false,
  },
];

const JOB_2_ACCURACY: TranscriptAccuracy = {
  confidenceScore: 97.8,
  wordsTranscribed: 1456,
  lowConfidenceCount: 1,
  confidenceThreshold: 65,
  hasCorrections: true,
  wordErrorRate: 2.1,
  correctedPercent: 15,
  hasBaseline: true,
  baselineWordErrorRate: 6.3,
};

export const MOCK_JOBS: TranscriptionJob[] = [
  {
    id: "job-pa05217-2025",
    caseReference: "PA/05217/2025",
    tribunal: "First-tier Tribunal — Immigration and Asylum Chamber",
    audioFileName: "PA_05217_2025_hearing.mp3",
    uploadedAt: "2026-06-28T09:15:00Z",
    completedAt: "2026-06-28T09:47:00Z",
    status: "COMPLETED",
    segments: JOB_1_SEGMENTS,
    accuracy: JOB_1_ACCURACY,
    lowConfidenceSegments: JOB_1_LOW_CONFIDENCE,
    audioDurationSeconds: 1920,
    transcriptionDurationSeconds: 187,
    modelIdentifier:
      "https://uksouth.cognitiveservices.azure.com/speechtotext/v3.2/models/base/ab0dcc7d-2f9f-4f4d-9c2d-2b6f0e2b1a11",
    modelDisplayName: "20240614 Base — en-GB",
  },
  {
    id: "job-ea11042-2025",
    caseReference: "EA/11042/2025",
    tribunal: "First-tier Tribunal — Immigration and Asylum Chamber",
    audioFileName: "EA_11042_2025_hearing.mp3",
    uploadedAt: "2026-06-27T14:30:00Z",
    completedAt: "2026-06-27T15:02:00Z",
    status: "COMPLETED",
    segments: JOB_2_SEGMENTS,
    accuracy: JOB_2_ACCURACY,
    lowConfidenceSegments: [
      {
        speaker: "Counsel",
        speakerColor: color("Counsel"),
        confidence: 0.6,
        startTime: 88,
      },
    ],
    audioDurationSeconds: 1932,
    transcriptionDurationSeconds: 154,
    modelIdentifier: "azure-speech-batch-transcription (en-GB)",
  },
  {
    id: "job-rp00331-2026",
    caseReference: "RP/00331/2026",
    tribunal: "First-tier Tribunal — Immigration and Asylum Chamber",
    audioFileName: "RP_00331_2026_hearing.mp3",
    uploadedAt: "2026-06-30T08:00:00Z",
    status: "FAILED",
    audioDurationSeconds: 2401,
  },
];

export function getMockJobById(id: string): TranscriptionJob | undefined {
  return MOCK_JOBS.find((j) => j.id === id);
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function confidencePercent(confidence: number): number {
  return Math.round(confidence * 100);
}
