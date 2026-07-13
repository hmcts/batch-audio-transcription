"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AudioUpload } from "@/components/audio-upload/audio-upload";
import { JobsTable } from "@/components/jobs-table/jobs-table";
import type { TranscriptionJob } from "@/lib/types";

const POLL_INTERVAL_MS = 5000;

async function fetchJobs(): Promise<TranscriptionJob[]> {
  const response = await fetch("/api/jobs", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load jobs: ${response.status}`);
  }
  const body = await response.json();
  return body.jobs as TranscriptionJob[];
}

export default function DashboardPage() {
  const [jobs, setJobs] = useState<TranscriptionJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const pollId = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      setJobs(await fetchJobs());
    } catch (err) {
      console.error(err);
      toast.error("Could not load transcription jobs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Poll while any job is still in flight; stop as soon as everything has
  // reached a terminal state so the dashboard doesn't poll forever.
  useEffect(() => {
    const hasActiveJobs = jobs.some(
      (job) => job.status === "PENDING" || job.status === "PROCESSING"
    );
    if (!hasActiveJobs) return;

    pollId.current = setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      if (pollId.current) clearInterval(pollId.current);
    };
  }, [jobs, refresh]);

  const handleUpload = useCallback(
    async (file: File) => {
      setUploading(true);
      try {
        const formData = new FormData();
        formData.append("file", file);
        const response = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error ?? `Upload failed: ${response.status}`);
        }
        toast.success(`"${file.name}" submitted for transcription`);
        await refresh();
      } catch (err) {
        console.error(err);
        toast.error(
          err instanceof Error ? err.message : "Failed to submit audio file"
        );
      } finally {
        setUploading(false);
      }
    },
    [refresh]
  );

  const processingJobs = jobs.filter((job) => job.status === "PROCESSING");
  const completedJobs = jobs.filter((job) => job.status === "COMPLETED");
  const failedJobs = jobs.filter((job) => job.status === "FAILED");

  return (
    <main className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-white">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-3">
          <h1 className="text-xl font-bold text-foreground">
            Batch Audio Transcription
          </h1>
          <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
            Beta
          </span>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-8 space-y-10">
        {/* Upload section */}
        <section>
          <h2 className="text-lg font-semibold mb-4">Upload audio file</h2>
          <div className="max-w-xl">
            <AudioUpload onUpload={handleUpload} uploading={uploading} />
          </div>
        </section>

        {/* In-progress jobs */}
        {processingJobs.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold mb-4">
              In progress ({processingJobs.length})
            </h2>
            <JobsTable jobs={processingJobs} />
          </section>
        )}

        {/* Recent transcripts */}
        <section>
          <h2 className="text-lg font-semibold mb-4">Recent transcripts</h2>
          {loading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : (
            <JobsTable jobs={completedJobs} />
          )}
        </section>

        {/* Failed jobs */}
        {failedJobs.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold mb-4">
              Failed ({failedJobs.length})
            </h2>
            <JobsTable jobs={failedJobs} />
          </section>
        )}

        {/* All uploads */}
        <section>
          <h2 className="text-lg font-semibold mb-4">All uploads</h2>
          <JobsTable jobs={jobs} />
        </section>
      </div>
    </main>
  );
}
