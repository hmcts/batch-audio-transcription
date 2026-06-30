import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { confidencePercent, formatTime } from "@/lib/mock-data";
import type { LowConfidenceSegment } from "@/lib/types";

interface NeedsReviewPanelProps {
  items: LowConfidenceSegment[];
  threshold?: number;
}

export function NeedsReviewPanel({
  items,
  threshold = 85,
}: NeedsReviewPanelProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Needs review</CardTitle>
        <p className="text-xs text-muted-foreground">
          {items.length} low-confidence or unresolved segments.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y divide-border">
          {items.map((item, i) => (
            <li
              key={`${item.speaker}-${item.startTime}-${i}`}
              className="flex items-center justify-between px-6 py-2"
            >
              <div className="flex items-center gap-2">
                <span
                  className="inline-block w-3 h-3 rounded-sm shrink-0"
                  style={{ backgroundColor: item.speakerColor }}
                />
                <span className="text-sm">{item.speaker}</span>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={`text-sm font-semibold ${
                    confidencePercent(item.confidence) < threshold
                      ? "text-destructive"
                      : "text-muted-foreground"
                  }`}
                >
                  {confidencePercent(item.confidence)}%
                </span>
                <span className="text-sm text-primary font-mono hover:underline cursor-pointer">
                  {formatTime(item.startTime)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
