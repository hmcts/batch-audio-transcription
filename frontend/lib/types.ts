export type JobStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";

export interface TranscriptSegment {
  id: string;
  speaker: string;
  speakerColor: string;
  text: string;
  startTime: number;
  duration: number;
  confidence: number;
  flaggedForReview: boolean;
}

export interface LowConfidenceSegment {
  speaker: string;
  speakerColor: string;
  confidence: number;
  startTime: number;
}

export interface TranscriptAccuracy {
  wordErrorRate: number;
  wordsTranscribed: number;
  samplePercent: number;
  lowConfidenceCount: number;
  confidenceThreshold: number;
}

export interface TranscriptionJob {
  id: string;
  caseReference: string;
  tribunal: string;
  audioFileName: string;
  uploadedAt: string;
  completedAt?: string;
  status: JobStatus;
  progressPercent?: number;
  segments?: TranscriptSegment[];
  accuracy?: TranscriptAccuracy;
  lowConfidenceSegments?: LowConfidenceSegment[];
}
