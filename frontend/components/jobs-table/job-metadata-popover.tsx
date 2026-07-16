"use client";

import { Info } from "lucide-react";
import { HoverPopover } from "@/components/ui/hover-popover";
import type { TranscriptionJob } from "@/lib/types";
import { formatDuration } from "@/lib/utils";

interface JobMetadataPopoverProps {
  job: TranscriptionJob;
}

// Microsoft's PUBLIC Speech-to-Text docs (safe, unauthenticated) — NOT the
// authenticated model.self endpoint. Linked only when we're showing a
// resolved friendly name so a clerk can read what a base model is.
const SPEECH_MODELS_DOCS_URL =
  "https://learn.microsoft.com/azure/ai-services/speech-service/how-to-custom-speech-choose-model";

// Neutral label shown when the only thing we have is a raw authenticated
// model.self URL (historical jobs / failed resolution). The raw URL is an
// auth-only endpoint ending in a GUID and must never be rendered — as visible
// text or in a tooltip — which is the whole point of DIAAT-243.
const UNRESOLVED_MODEL_LABEL = "Azure Speech model";

/** True when the identifier is a raw URL (the auth-only model.self endpoint). */
function isUrlIdentifier(identifier: string | undefined): boolean {
  return (
    identifier !== undefined &&
    (identifier.startsWith("http://") || identifier.startsWith("https://"))
  );
}

/**
 * The safe model label to display: the server-resolved friendly name when
 * present, else the raw model_identifier only if it's a non-URL fallback
 * label, else a neutral label (never the raw self URL), else `undefined` so
 * the caller can show a progress/terminal placeholder.
 */
export function safeModelLabel(job: TranscriptionJob): string | undefined {
  if (job.modelDisplayName !== undefined) {
    return job.modelDisplayName;
  }
  if (job.modelIdentifier === undefined) {
    return undefined;
  }
  return isUrlIdentifier(job.modelIdentifier)
    ? UNRESOLVED_MODEL_LABEL
    : job.modelIdentifier;
}

/** True once there's at least one piece of run metadata worth showing. */
export function hasRunMetadata(job: TranscriptionJob): boolean {
  return (
    job.audioDurationSeconds !== undefined ||
    job.transcriptionDurationSeconds !== undefined ||
    job.modelDisplayName !== undefined ||
    job.modelIdentifier !== undefined
  );
}

/**
 * Surfaces audio length, transcription processing time, and the model that
 * produced the transcript directly on the dashboard's file name — on hover
 * or click — so a clerk can check run details without opening the
 * transcript itself (DIAAT-227).
 */
export function JobMetadataPopover({ job }: JobMetadataPopoverProps) {
  // Transcription time and model are only known once the job succeeds. Show
  // "In progress…" while the job can still produce them, but a terminal
  // placeholder ("—") once it has reached a terminal state without them
  // (e.g. a FAILED job) — otherwise "In progress…" is misleading for a
  // value that will never arrive.
  const isTerminal = job.status === "COMPLETED" || job.status === "FAILED";
  const missingPlaceholder = isTerminal ? "—" : "In progress…";

  // Prefer the server-resolved human-readable name (e.g. "Base model —
  // en-GB"); fall back to a safe label for historical jobs or when resolution
  // failed (never the raw self URL), and finally to the progress/terminal
  // placeholder.
  const safeLabel = safeModelLabel(job);
  const modelLabel = safeLabel ?? missingPlaceholder;

  return (
    <HoverPopover
      ariaLabel={`Transcription run details for ${job.audioFileName}`}
      trigger={
        <span className="inline-flex items-center gap-1">
          <span className="truncate max-w-48">{job.audioFileName}</span>
          <Info className="size-3.5 shrink-0 text-muted-foreground" />
        </span>
      }
    >
      <dl className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">Audio length</dt>
          <dd className="font-medium tabular-nums">
            {formatDuration(job.audioDurationSeconds)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">Transcription time</dt>
          <dd className="font-medium tabular-nums">
            {job.transcriptionDurationSeconds !== undefined
              ? formatDuration(job.transcriptionDurationSeconds)
              : missingPlaceholder}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground shrink-0">Model</dt>
          <dd className="truncate font-medium" title={safeLabel ?? undefined}>
            {modelLabel}
          </dd>
        </div>
        {job.modelDisplayName !== undefined ? (
          <div className="flex justify-end">
            <a
              href={SPEECH_MODELS_DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              About Speech models
            </a>
          </div>
        ) : null}
      </dl>
    </HoverPopover>
  );
}
