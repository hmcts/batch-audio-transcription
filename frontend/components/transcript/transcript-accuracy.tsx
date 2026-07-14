import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TranscriptAccuracy as TranscriptAccuracyType } from "@/lib/types";

interface TranscriptAccuracyProps {
  accuracy: TranscriptAccuracyType;
}

export function TranscriptAccuracy({ accuracy }: TranscriptAccuracyProps) {
  // A real word error rate needs a human-verified reference transcript,
  // which only exists once a clerk has corrected at least one segment.
  // Until then, all we have is Azure's own confidence score — showing that
  // as "accuracy" or "WER" would overstate how verified it is.
  const showWer =
    accuracy.hasCorrections && accuracy.wordErrorRate !== undefined;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          {showWer ? "Transcript accuracy" : "Transcript confidence"}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {showWer
            ? `Measured against clerk corrections (${Math.round(accuracy.correctedPercent ?? 0)}% of segments reviewed).`
            : "Auto-generated. Not yet reviewed by a clerk."}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex justify-between items-start">
          <div>
            <p className="text-sm text-muted-foreground">
              {showWer ? "Word error rate (WER)" : "Avg. word confidence"}
            </p>
            {!showWer && (
              <p className="text-xs text-muted-foreground">
                Not yet a verified accuracy measurement
              </p>
            )}
          </div>
          <span className="text-2xl font-bold text-primary">
            {showWer
              ? `${accuracy.wordErrorRate?.toFixed(1)}%`
              : `${Math.round(accuracy.confidenceScore)}%`}
          </span>
        </div>

        <div className="flex justify-between items-center border-t pt-3">
          <div>
            <p className="text-sm text-muted-foreground">Words transcribed</p>
            <p className="text-xs text-muted-foreground">
              {accuracy.lowConfidenceCount} segments below{" "}
              {Math.round(accuracy.confidenceThreshold)}% confidence
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
