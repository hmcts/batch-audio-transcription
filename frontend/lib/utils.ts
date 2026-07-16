import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Human-readable duration for run metadata (audio length, transcription
// time) — e.g. "1h 5m 3s", "12m 34s", "8s". Unlike mock-data's formatTime
// (mm:ss, built for a scrubber alongside playback), this reads naturally in
// a popover with no visual timeline for context, and covers audio far longer
// than an hour. Lives here rather than in mock-data.ts so importing it never
// pulls in fixture data.
export function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined || Number.isNaN(seconds)) return "—";
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (hours > 0 || minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);
  return parts.join(" ");
}

export default cn;
