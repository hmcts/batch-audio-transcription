"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import {
  type JobsSortKey,
  JobsTable,
  type SortDirection,
} from "@/components/jobs-table/jobs-table";
import type { JobStatus, TranscriptionJob } from "@/lib/types";

const STATUS_LABELS: Record<JobStatus, string> = {
  PENDING: "Pending",
  PROCESSING: "Processing",
  COMPLETED: "Completed",
  FAILED: "Failed",
};

const STATUS_ORDER: JobStatus[] = [
  "PENDING",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
];

interface FilterableJobsSectionProps {
  title: string;
  jobs: TranscriptionJob[];
}

export function FilterableJobsSection({
  title,
  jobs,
}: FilterableJobsSectionProps) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<JobsSortKey>("uploadedAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  // null = no explicit filter applied yet, i.e. "show every status present".
  const [selectedStatuses, setSelectedStatuses] = useState<JobStatus[] | null>(
    null
  );

  const availableStatuses = useMemo(
    () => STATUS_ORDER.filter((s) => jobs.some((j) => j.status === s)),
    [jobs]
  );
  const effectiveSelected = selectedStatuses ?? availableStatuses;

  const toggleStatus = (status: JobStatus) => {
    setSelectedStatuses((prev) => {
      const current = prev ?? availableStatuses;
      return current.includes(status)
        ? current.filter((s) => s !== status)
        : [...current, status];
    });
  };

  const handleSortChange = (key: JobsSortKey) => {
    if (key === sortKey) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection("asc");
    }
  };

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return jobs.filter((job) => {
      if (!effectiveSelected.includes(job.status)) return false;
      if (!term) return true;
      return (
        job.caseReference.toLowerCase().includes(term) ||
        job.audioFileName.toLowerCase().includes(term)
      );
    });
  }, [jobs, search, effectiveSelected]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      let cmp: number;
      switch (sortKey) {
        case "caseReference":
          cmp = a.caseReference.localeCompare(b.caseReference);
          break;
        case "status":
          cmp = a.status.localeCompare(b.status);
          break;
        default:
          cmp =
            new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime();
      }
      return sortDirection === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sortKey, sortDirection]);

  return (
    <section>
      <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
        <h2 className="text-lg font-semibold">
          {title} ({jobs.length})
        </h2>
        <div className="flex items-center gap-4 flex-wrap">
          {availableStatuses.length > 1 && (
            <div className="flex items-center gap-3">
              {availableStatuses.map((status) => (
                <label
                  key={status}
                  className="flex items-center gap-1.5 text-sm text-muted-foreground cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={effectiveSelected.includes(status)}
                    onChange={() => toggleStatus(status)}
                    className="size-3.5 rounded border-border accent-primary"
                  />
                  {STATUS_LABELS[status]}
                </label>
              ))}
            </div>
          )}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search case or file…"
              aria-label={`Search ${title.toLowerCase()}`}
              className="pl-8 pr-3 py-1.5 text-sm border border-border rounded-md w-56 focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>
      </div>
      <JobsTable
        jobs={sorted}
        sortKey={sortKey}
        sortDirection={sortDirection}
        onSortChange={handleSortChange}
      />
    </section>
  );
}
