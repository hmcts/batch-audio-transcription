"use client";

import type { ChangeEvent } from "react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TranscriptAccuracy as TranscriptAccuracyType } from "@/lib/types";

interface TranscriptAccuracyProps {
  accuracy: TranscriptAccuracyType;
  // Omitted in places this panel is rendered read-only (e.g. tests that
  // only care about the numbers) — the upload button still renders but is
  // disabled, so it can't trigger an upload with no handler wired up.
  onUploadBaseline?: (file: File) => Promise<void>;
}

export function TranscriptAccuracy({
  accuracy,
  onUploadBaseline,
}: TranscriptAccuracyProps) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // A real word error rate needs a human-verified reference transcript,
  // which only exists once a clerk has corrected at least one segment.
  // Until then, all we have is Azure's own confidence score — showing that
  // as "accuracy" or "WER" would overstate how verified it is.
  const showWer =
    accuracy.hasCorrections && accuracy.wordErrorRate !== undefined;
  const showBaselineWer =
    accuracy.hasBaseline && accuracy.baselineWordErrorRate !== undefined;

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset immediately so selecting the same file again still fires onChange.
    event.target.value = "";
    if (!file || !onUploadBaseline) return;

    setUploading(true);
    setUploadError(null);
    try {
      await onUploadBaseline(file);
    } catch (err) {
      console.error("Failed to upload baseline transcript", err);
      setUploadError("Failed to upload baseline transcript. Please try again.");
    } finally {
      setUploading(false);
    }
  };

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

        <div className="border-t pt-3 space-y-3">
          {showBaselineWer ? (
            <div className="flex justify-between items-start">
              <div>
                <p className="text-sm text-muted-foreground">Baseline WER</p>
                {/* Distinguishing this from the correction-based WER is the
                    whole point of this metric — same acronym, different (and
                    independent) measurement. The clarification is shown
                    whether or not a correction-based WER is currently
                    displayed, so the two are never silently conflated. */}
                <p className="text-xs text-muted-foreground">
                  {showWer
                    ? "Against your uploaded reference transcript, covering the whole transcript — independent of the correction-based WER above and unaffected by any corrections."
                    : "Against your uploaded reference transcript, covering the whole transcript — independent of any corrections made here."}
                </p>
              </div>
              <span className="text-2xl font-bold text-primary">
                {accuracy.baselineWordErrorRate?.toFixed(1)}%
              </span>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Upload a reference transcript to measure accuracy against the
              whole transcription — independent of any corrections made here.
            </p>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,text/plain"
            aria-label="Baseline transcript file input"
            className="hidden"
            onChange={handleFileChange}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full"
            disabled={uploading || !onUploadBaseline}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading
              ? "Uploading…"
              : accuracy.hasBaseline
                ? "Replace baseline transcript"
                : "Upload baseline transcript"}
          </Button>
          {uploadError && (
            <p className="text-xs text-destructive">{uploadError}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
