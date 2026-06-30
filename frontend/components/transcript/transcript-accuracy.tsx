import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { TranscriptAccuracy as TranscriptAccuracyType } from "@/lib/types";

interface TranscriptAccuracyProps {
  accuracy: TranscriptAccuracyType;
}

export function TranscriptAccuracy({ accuracy }: TranscriptAccuracyProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Transcript accuracy</CardTitle>
        <p className="text-xs text-muted-foreground">
          Auto-generated. Not yet reviewed by a clerk.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex justify-between items-start">
          <div>
            <p className="text-sm text-muted-foreground">
              Word error rate (WER)
            </p>
            <p className="text-xs text-muted-foreground">
              Est. against {accuracy.samplePercent}% sampled
            </p>
          </div>
          <span className="text-2xl font-bold text-primary">
            {accuracy.wordErrorRate}%
          </span>
        </div>

        <div className="flex justify-between items-center border-t pt-3">
          <div>
            <p className="text-sm text-muted-foreground">Words transcribed</p>
            <p className="text-xs text-muted-foreground">
              {accuracy.lowConfidenceCount} segments below{" "}
              {accuracy.confidenceThreshold}%
            </p>
          </div>
          <span className="text-2xl font-bold">
            {accuracy.wordsTranscribed.toLocaleString()}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
