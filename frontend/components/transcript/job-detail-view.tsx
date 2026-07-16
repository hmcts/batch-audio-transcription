"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { JobProgress } from "@/components/job-status/job-progress";
import { JobStatusBadge } from "@/components/job-status/job-status-badge";
import { AudioPlayerBar } from "@/components/transcript/audio-player-bar";
import { NeedsReviewPanel } from "@/components/transcript/needs-review-panel";
import { TranscriptAccuracy } from "@/components/transcript/transcript-accuracy";
import { TranscriptSegment } from "@/components/transcript/transcript-segment";
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

  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const audioCleanupRef = useRef<(() => void) | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioAvailable, setAudioAvailable] = useState(true);

  // A callback ref (rather than an effect) so listeners attach exactly when
  // the <audio> element mounts — which happens on first render if the job is
  // already COMPLETED, or later, whenever polling flips it to COMPLETED.
  // Stabilised with useCallback (empty deps): this component re-renders
  // frequently (timeupdate -> setPosition), and a ref callback recreated
  // every render makes React detach/reattach these listeners on every one.
  const attachAudioRef = useCallback((el: HTMLAudioElement | null) => {
    audioCleanupRef.current?.();
    audioCleanupRef.current = null;
    audioElRef.current = el;
    if (!el) return;

    const onTimeUpdate = () => setPosition(el.currentTime);
    const onLoadedMetadata = () => setAudioDuration(el.duration);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onError = () => setAudioAvailable(false);

    el.addEventListener("timeupdate", onTimeUpdate);
    el.addEventListener("loadedmetadata", onLoadedMetadata);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("error", onError);

    audioCleanupRef.current = () => {
      el.removeEventListener("timeupdate", onTimeUpdate);
      el.removeEventListener("loadedmetadata", onLoadedMetadata);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("error", onError);
    };
  }, []);

  const togglePlay = () => {
    const audio = audioElRef.current;
    if (!audio) return;
    if (audio.paused) {
      // play() returns a promise that can reject (e.g. a pause() interrupts
      // it, or the browser blocks autoplay) — the "error" listener already
      // handles genuine load failures, so this just avoids an unhandled
      // rejection showing up in the console.
      audio.play().catch((err) => {
        console.warn("Audio playback failed to start", err);
      });
    } else {
      audio.pause();
    }
  };

  const seekTo = (time: number) => {
    const audio = audioElRef.current;
    if (!audio) return;
    audio.currentTime = time;
    setPosition(time);
  };

  // Stable reference (reads the ref, not React state) so the active
  // segment's rAF-driven word-highlight loop can poll real playback
  // position at animation-frame precision instead of waiting on the
  // <audio> element's much coarser timeupdate event.
  const getCurrentTime = useCallback(
    () => audioElRef.current?.currentTime ?? 0,
    []
  );

  // "Needs review" items live in a separate sidebar list — jumping to one
  // should also bring its actual transcript segment into view, not just
  // move the audio position.
  const seekAndScrollToSegment = (time: number) => {
    seekTo(time);
    const segment = job.segments?.find(
      (s) => time >= s.startTime && time < s.startTime + s.duration
    );
    if (segment) {
      document
        .getElementById(segment.id)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  const correctSegment = async (index: number, correctedText: string) => {
    const response = await fetch(
      apiPath(`/api/jobs/${jobId}/segments/${index}`),
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ correctedText }),
      }
    );
    if (!response.ok) {
      throw new Error(`Failed to save correction: ${response.status}`);
    }
    const body = await response.json();
    setJob(body.job as TranscriptionJob);
  };

  const correctWordRange = async (
    index: number,
    startWordIndex: number,
    endWordIndex: number,
    correctedText: string
  ) => {
    const response = await fetch(
      apiPath(`/api/jobs/${jobId}/segments/${index}/words`),
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startWordIndex, endWordIndex, correctedText }),
      }
    );
    if (!response.ok) {
      throw new Error(`Failed to save correction: ${response.status}`);
    }
    const body = await response.json();
    setJob(body.job as TranscriptionJob);
  };

  const rollbackSegment = async (index: number) => {
    const response = await fetch(
      apiPath(`/api/jobs/${jobId}/segments/${index}/rollback`),
      { method: "POST" }
    );
    if (!response.ok) {
      throw new Error(`Failed to roll back segment: ${response.status}`);
    }
    const body = await response.json();
    setJob(body.job as TranscriptionJob);
  };

  const rollbackToHistoryEntry = async (
    index: number,
    historyIndex: number
  ) => {
    const response = await fetch(
      apiPath(
        `/api/jobs/${jobId}/segments/${index}/history/${historyIndex}/rollback`
      ),
      { method: "POST" }
    );
    if (!response.ok) {
      throw new Error(`Failed to roll back: ${response.status}`);
    }
    const body = await response.json();
    setJob(body.job as TranscriptionJob);
  };

  useEffect(() => {
    const id = setInterval(async () => {
      if (
        jobRef.current.status !== "PENDING" &&
        jobRef.current.status !== "PROCESSING"
      ) {
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
        <audio
          ref={attachAudioRef}
          src={apiPath(`/api/audio/${job.id}`)}
          preload="metadata"
          className="hidden"
        >
          <track kind="captions" />
        </audio>

        {audioAvailable ? (
          <AudioPlayerBar
            duration={audioDuration || totalDuration}
            position={position}
            playing={playing}
            onTogglePlay={togglePlay}
            onSeek={seekTo}
            onSpeedChange={(speed) => {
              if (audioElRef.current) audioElRef.current.playbackRate = speed;
            }}
          />
        ) : (
          <div className="bg-white border-b border-border px-4 py-3 text-sm text-muted-foreground">
            Audio playback is unavailable for this recording.
          </div>
        )}

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
                {job.segments.map((segment, index) => {
                  const isActive =
                    playing &&
                    position >= segment.startTime &&
                    position < segment.startTime + segment.duration;
                  return (
                    <TranscriptSegment
                      key={segment.id}
                      segment={segment}
                      onSeek={audioAvailable ? seekTo : undefined}
                      onCorrect={(text) => correctSegment(index, text)}
                      onCorrectRange={(start, end, text) =>
                        correctWordRange(index, start, end, text)
                      }
                      onRollback={() => rollbackSegment(index)}
                      onRollbackToHistory={(historyIndex) =>
                        rollbackToHistoryEntry(index, historyIndex)
                      }
                      isActive={isActive}
                      getCurrentTime={getCurrentTime}
                    />
                  );
                })}
              </div>
            </div>

            {/* Sidebar (right) — omitted when the backend hasn't returned
                any confidence-scored segments (e.g. an older job predating
                this feature). */}
            {job.accuracy && (
              <aside className="w-72 shrink-0 space-y-4">
                <TranscriptAccuracy accuracy={job.accuracy} />
                {job.lowConfidenceSegments &&
                  job.lowConfidenceSegments.length > 0 && (
                    <NeedsReviewPanel
                      items={job.lowConfidenceSegments}
                      threshold={job.accuracy.confidenceThreshold}
                      onSeek={seekAndScrollToSegment}
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
            <JobProgress job={job} />
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
