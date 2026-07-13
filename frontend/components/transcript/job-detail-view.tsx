"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { JobStatusBadge } from "@/components/job-status/job-status-badge";
import { AudioPlayerBar } from "@/components/transcript/audio-player-bar";
import { NeedsReviewPanel } from "@/components/transcript/needs-review-panel";
import { TranscriptAccuracy } from "@/components/transcript/transcript-accuracy";
import { TranscriptSegment } from "@/components/transcript/transcript-segment";
import { Progress } from "@/components/ui/progress";
import { apiPath } from "@/lib/base-path";
import type { TranscriptionJob } from "@/lib/types";

const POLL_INTERVAL_MS = 5000;

interface JobDetailViewProps {
  jobId: string;
  initialJob: TranscriptionJob;
}

export function JobDetailView({ jobId, initialJob }: JobDetailViewProps) {
  const [job, setJob] = useState(initialJob);
  const jobRef = useRef(job);
  jobRef.current = job;

  useEffect(() => {
    const id = setInterval(async () => {
      if (jobRef.current.status !== "PENDING" && jobRef.current.status !== "PROCESSING") {
        return;
      }
      try {
        const response = await fetch(apiPath(`/api/jobs/${jobId}`), {
          cache: "no-store",
        });
        if (!response.ok) return;
        const body = await response.json();
        setJob(body.job as TranscriptionJob);
      } catch (err) {
        console.error("Failed to refresh job status", err);
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [jobId]);

  const backLink = (
    <Link
      href="/"
      className="inline-flex items-center gap-1 text-sm text-primary hover:underline mb-4"
    >
      <ChevronLeft className="size-4" />
      Back to hearing list
    </Link>
  );

  if (job.status === "COMPLETED" && job.segments) {
    const totalDuration = job.segments.reduce(
      (max, s) => Math.max(max, s.startTime + s.duration),
      0
    );

    return (
      <main className="min-h-screen bg-background">
        <AudioPlayerBar duration={totalDuration} />

        <div className="max-w-5xl mx-auto px-4 py-6">
          {backLink}

          <p className="text-sm text-primary mb-1">{job.tribunal}</p>
          <h1 className="text-3xl font-bold mb-6">{job.caseReference}</h1>

          <div className="flex gap-6 items-start">
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold">Transcript</h2>
                <p className="text-sm text-muted-foreground">
                  {job.segments.length} segments
                </p>
              </div>
              <div className="border border-border rounded-lg divide-y divide-border">
                {job.segments.map((segment) => (
                  <TranscriptSegment key={segment.id} segment={segment} />
                ))}
              </div>
            </div>

            {/* Sidebar (right) — accuracy/review metrics are only available
                for mock fixture data today; the real backend doesn't compute
                them yet, so the sidebar is simply omitted for live jobs. */}
            {job.accuracy && (
              <aside className="w-72 shrink-0 space-y-4">
                <TranscriptAccuracy accuracy={job.accuracy} />
                {job.lowConfidenceSegments &&
                  job.lowConfidenceSegments.length > 0 && (
                    <NeedsReviewPanel
                      items={job.lowConfidenceSegments}
                      threshold={job.accuracy.confidenceThreshold}
                    />
                  )}
              </aside>
            )}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-6">
        {backLink}

        <p className="text-sm text-primary mb-1">{job.tribunal}</p>
        <h1 className="text-3xl font-bold mb-4">{job.caseReference}</h1>

        <div className="flex items-center gap-3 mb-6">
          <JobStatusBadge status={job.status} />
          <span className="text-sm text-muted-foreground">
            {job.audioFileName}
          </span>
        </div>

        {(job.status === "PENDING" || job.status === "PROCESSING") && (
          <div className="border border-border rounded-lg p-6 space-y-4">
            <p className="text-muted-foreground">
              Transcription is still in progress. This page updates
              automatically — no need to refresh.
            </p>
            {job.progressPercent !== undefined && (
              <div className="flex items-center gap-3 max-w-sm">
                <Progress value={job.progressPercent} className="flex-1" />
                <span className="text-sm text-muted-foreground tabular-nums">
                  {job.progressPercent}%
                </span>
              </div>
            )}
          </div>
        )}

        {job.status === "FAILED" && (
          <div className="border border-destructive/30 bg-destructive/5 rounded-lg p-6">
            <p className="font-medium text-destructive mb-2">
              Transcription failed
            </p>
            <p className="text-sm text-muted-foreground">
              {job.errorMessage ?? "An unknown error occurred."}
            </p>
          </div>
        )}

        {job.status === "COMPLETED" && !job.segments && (
          <div className="border border-border rounded-lg p-6">
            <p className="text-muted-foreground">
              This transcript has no content to display.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
