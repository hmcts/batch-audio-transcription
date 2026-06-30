"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AudioUpload } from "@/components/audio-upload/audio-upload";
import { JobsTable } from "@/components/jobs-table/jobs-table";
import { MOCK_JOBS } from "@/lib/mock-data";
import type { TranscriptionJob } from "@/lib/types";

function generateId(): string {
  return `job-${Math.random().toString(36).slice(2, 10)}`;
}

export default function DashboardPage() {
  const [jobs, setJobs] = useState<TranscriptionJob[]>(MOCK_JOBS);
  const [uploading, setUploading] = useState(false);
  const timerIds = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    return () => {
      for (const id of timerIds.current) clearTimeout(id);
    };
  }, []);

  const handleUpload = useCallback((file: File) => {
    setUploading(true);

    const newJobId = generateId();
    const newJob: TranscriptionJob = {
      id: newJobId,
      caseReference: file.name.replace(/\.[^.]+$/, "").replace(/_/g, "/"),
      tribunal: "First-tier Tribunal — Immigration and Asylum Chamber",
      audioFileName: file.name,
      uploadedAt: new Date().toISOString(),
      status: "PENDING",
      progressPercent: 0,
    };

    setJobs((prev) => [newJob, ...prev]);
    toast.success(`"${file.name}" submitted for transcription`);

    // Simulate PENDING → PROCESSING → COMPLETED
    timerIds.current.push(
      setTimeout(() => {
        setJobs((prev) =>
          prev.map((j) =>
            j.id === newJobId
              ? { ...j, status: "PROCESSING", progressPercent: 10 }
              : j
          )
        );
        setUploading(false);
      }, 1000)
    );

    // Simulate progress updates
    const intervals = [30, 55, 75, 90, 100];
    for (const [i, pct] of intervals.entries()) {
      timerIds.current.push(
        setTimeout(
          () => {
            setJobs((prev) =>
              prev.map((j) =>
                j.id === newJobId
                  ? { ...j, status: "PROCESSING", progressPercent: pct }
                  : j
              )
            );
          },
          2000 + i * 1500
        )
      );
    }

    // Complete after ~10s
    timerIds.current.push(
      setTimeout(() => {
        setJobs((prev) =>
          prev.map((j) =>
            j.id === newJobId
              ? {
                  ...j,
                  status: "COMPLETED",
                  progressPercent: 100,
                  completedAt: new Date().toISOString(),
                }
              : j
          )
        );
        toast.success("Transcription complete!");
      }, 10000)
    );
  }, []);

  const processingJobs = jobs.filter((j) => j.status === "PROCESSING");
  const completedJobs = jobs.filter((j) => j.status === "COMPLETED");
  const failedJobs = jobs.filter((j) => j.status === "FAILED");

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
          <JobsTable jobs={completedJobs} />
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
