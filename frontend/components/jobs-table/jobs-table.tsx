"use client";

import {
  ChevronDown,
  ChevronsUpDown,
  ChevronUp,
  FileAudio,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { JobProgress } from "@/components/job-status/job-progress";
import { JobStatusBadge } from "@/components/job-status/job-status-badge";
import {
  hasRunMetadata,
  JobMetadataPopover,
} from "@/components/jobs-table/job-metadata-popover";
import type { JobStatus, TranscriptionJob } from "@/lib/types";

const TRANSCRIPT_LINK_LABEL: Record<JobStatus, string> = {
  COMPLETED: "View transcript →",
  FAILED: "View details →",
  PENDING: "View status →",
  PROCESSING: "View status →",
};

export type JobsSortKey = "caseReference" | "uploadedAt" | "status";
export type SortDirection = "asc" | "desc";

interface JobsTableProps {
  jobs: TranscriptionJob[];
  sortKey?: JobsSortKey;
  sortDirection?: SortDirection;
  onSortChange?: (key: JobsSortKey) => void;
}

function SortableHeader({
  label,
  sortKeyId,
  activeSortKey,
  sortDirection,
  onSortChange,
}: {
  label: string;
  sortKeyId: JobsSortKey;
  activeSortKey?: JobsSortKey;
  sortDirection?: SortDirection;
  onSortChange?: (key: JobsSortKey) => void;
}) {
  if (!onSortChange) {
    return <th className="px-4 py-3 text-left font-semibold">{label}</th>;
  }

  const isActive = activeSortKey === sortKeyId;
  const Icon = isActive
    ? sortDirection === "asc"
      ? ChevronUp
      : ChevronDown
    : ChevronsUpDown;

  return (
    <th className="px-4 py-3 text-left font-semibold">
      <button
        type="button"
        onClick={() => onSortChange(sortKeyId)}
        className={`flex items-center gap-1 hover:text-foreground ${
          isActive ? "text-foreground" : "text-muted-foreground"
        }`}
      >
        {label}
        <Icon className="size-3.5" />
      </button>
    </th>
  );
}

export function JobsTable({
  jobs,
  sortKey,
  sortDirection,
  onSortChange,
}: JobsTableProps) {
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
            <SortableHeader
              label="Case reference"
              sortKeyId="caseReference"
              activeSortKey={sortKey}
              sortDirection={sortDirection}
              onSortChange={onSortChange}
            />
            <th className="px-4 py-3 text-left font-semibold">File</th>
            <SortableHeader
              label="Uploaded"
              sortKeyId="uploadedAt"
              activeSortKey={sortKey}
              sortDirection={sortDirection}
              onSortChange={onSortChange}
            />
            <SortableHeader
              label="Status"
              sortKeyId="status"
              activeSortKey={sortKey}
              sortDirection={sortDirection}
              onSortChange={onSortChange}
            />
            <th className="px-4 py-3 text-left font-semibold">Transcript</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {jobs.map((job) => (
            <tr
              key={job.id}
              // Mouse convenience only — clicking anywhere on the row
              // navigates. Keyboard/assistive-tech users get a real <Link>
              // in the last cell instead (overriding <tr>'s role here would
              // destroy its table-row semantics for the cells within it).
              onClick={() => router.push(`/jobs/${job.id}`)}
              className="hover:bg-muted/30 transition-colors cursor-pointer"
            >
              <td className="px-4 py-3 font-medium">{job.caseReference}</td>
              <td className="px-4 py-3 text-muted-foreground">
                <div className="flex items-center gap-2 min-w-0">
                  <FileAudio className="size-4 shrink-0" />
                  {hasRunMetadata(job) ? (
                    <JobMetadataPopover job={job} />
                  ) : (
                    <span className="truncate max-w-48">
                      {job.audioFileName}
                    </span>
                  )}
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
                  {job.status === "PROCESSING" && (
                    <JobProgress job={job} compact />
                  )}
                </div>
              </td>
              <td className="px-4 py-3">
                <Link
                  href={`/jobs/${job.id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="text-primary hover:underline font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
                >
                  {TRANSCRIPT_LINK_LABEL[job.status]}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
