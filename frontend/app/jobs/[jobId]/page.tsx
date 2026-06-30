import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AudioPlayerBar } from "@/components/transcript/audio-player-bar";
import { NeedsReviewPanel } from "@/components/transcript/needs-review-panel";
import { TranscriptAccuracy } from "@/components/transcript/transcript-accuracy";
import { TranscriptSegment } from "@/components/transcript/transcript-segment";
import { getMockJobById } from "@/lib/mock-data";

interface PageProps {
  params: Promise<{ jobId: string }>;
}

export default async function TranscriptPage({ params }: PageProps) {
  const { jobId } = await params;
  const job = getMockJobById(jobId);

  if (!job || job.status !== "COMPLETED" || !job.segments || !job.accuracy) {
    notFound();
  }

  const totalDuration = job.segments.reduce(
    (max, s) => Math.max(max, s.startTime + s.duration),
    0
  );

  return (
    <main className="min-h-screen bg-background">
      {/* Audio player */}
      <AudioPlayerBar duration={totalDuration} />

      <div className="max-w-5xl mx-auto px-4 py-6">
        {/* Back link */}
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline mb-4"
        >
          <ChevronLeft className="size-4" />
          Back to hearing list
        </Link>

        {/* Heading */}
        <p className="text-sm text-primary mb-1">{job.tribunal}</p>
        <h1 className="text-3xl font-bold mb-6">{job.caseReference}</h1>

        {/* Two-column layout */}
        <div className="flex gap-6 items-start">
          {/* Transcript (left) */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold">Transcript</h2>
              <p className="text-sm text-muted-foreground">
                Click a timestamp to jump the audio · {job.segments.length}{" "}
                segments
              </p>
            </div>
            <div className="border border-border rounded-lg divide-y divide-border">
              {job.segments.map((segment) => (
                <TranscriptSegment key={segment.id} segment={segment} />
              ))}
            </div>
          </div>

          {/* Sidebar (right) */}
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
        </div>
      </div>
    </main>
  );
}
