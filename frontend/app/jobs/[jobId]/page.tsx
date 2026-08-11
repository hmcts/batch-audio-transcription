import { notFound } from "next/navigation";
import { JobDetailView } from "@/components/transcript/job-detail-view";
import { getJob } from "@/lib/api-client";
import { getServerComponentAuthContext } from "@/lib/auth-utils";

interface PageProps {
  params: Promise<{ jobId: string }>;
}

export default async function TranscriptPage({ params }: PageProps) {
  const { jobId } = await params;
  // Forward the Easy Auth identity from the incoming request, otherwise the
  // backend rejects this server-side fetch with 401 (it requires the
  // X-Ms-Client-Principal header).
  const auth = await getServerComponentAuthContext();
  const job = await getJob(jobId, auth);

  if (!job) {
    notFound();
  }

  return <JobDetailView jobId={jobId} initialJob={job} />;
}
