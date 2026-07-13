"use client";

import { FileAudio } from "lucide-react";
import { useRouter } from "next/navigation";
import { JobStatusBadge } from "@/components/job-status/job-status-badge";
import { Progress } from "@/components/ui/progress";
import type { JobStatus, TranscriptionJob } from "@/lib/types";

const TRANSCRIPT_LINK_LABEL: Record<JobStatus, string> = {
  COMPLETED: "View transcript →",
  FAILED: "View details →",
  PENDING: "View status →",
  PROCESSING: "View status →",
};

interface JobsTableProps {
  jobs: TranscriptionJob[];
}

export function JobsTable({ jobs }: JobsTableProps) {
  const router = useRouter();

  if (jobs.length === 0) {
    return (
      <p className="text-center text-muted-foreground py-8">
        No transcription jobs yet. Upload an audio file to get started.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-4 py-3 text-left font-semibold">
              Case reference
            </th>
            <th className="px-4 py-3 text-left font-semibold">File</th>
            <th className="px-4 py-3 text-left font-semibold">Uploaded</th>
            <th className="px-4 py-3 text-left font-semibold">Status</th>
            <th className="px-4 py-3 text-left font-semibold">Transcript</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {jobs.map((job) => (
            <tr
              key={job.id}
              onClick={() => router.push(`/jobs/${job.id}`)}
              className="hover:bg-muted/30 transition-colors cursor-pointer"
            >
              <td className="px-4 py-3 font-medium">{job.caseReference}</td>
              <td className="px-4 py-3 text-muted-foreground">
                <div className="flex items-center gap-2">
                  <FileAudio className="size-4 shrink-0" />
                  <span className="truncate max-w-48">{job.audioFileName}</span>
                </div>
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {new Date(job.uploadedAt).toLocaleString("en-GB", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-col gap-1">
                  <JobStatusBadge status={job.status} />
                  {job.status === "PROCESSING" &&
                    job.progressPercent !== undefined && (
                      <div className="flex items-center gap-2">
                        <Progress
                          value={job.progressPercent}
                          className="w-24"
                        />
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {job.progressPercent}%
                        </span>
                      </div>
                    )}
                </div>
              </td>
              <td className="px-4 py-3">
                <span className="text-primary hover:underline font-medium">
                  {TRANSCRIPT_LINK_LABEL[job.status]}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
