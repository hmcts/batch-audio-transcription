import { notFound } from "next/navigation";
import { JobDetailView } from "@/components/transcript/job-detail-view";
import { getJob } from "@/lib/api-client";

interface PageProps {
  params: Promise<{ jobId: string }>;
}

export default async function TranscriptPage({ params }: PageProps) {
  const { jobId } = await params;
  const job = await getJob(jobId);

  if (!job) {
    notFound();
  }

  return <JobDetailView jobId={jobId} initialJob={job} />;
}
