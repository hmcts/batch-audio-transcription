"use client";

import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatTime } from "@/lib/mock-data";

interface AudioPlayerBarProps {
  duration: number;
}

export function AudioPlayerBar({ duration }: AudioPlayerBarProps) {
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);

  return (
    <div className="bg-white border-b border-border px-4 py-3 flex items-center gap-3">
      {/* Skip back */}
      <Button
        variant="ghost"
        size="icon"
        className="size-8 text-xs"
        onClick={() => setPosition((p) => Math.max(0, p - 10))}
        aria-label="Skip back 10 seconds"
      >
        <SkipBack className="size-4" />
        <span className="sr-only">−10s</span>
      </Button>

      {/* Play/pause */}
      <Button
        size="icon"
        className="size-10 rounded-full bg-primary"
        onClick={() => setPlaying((p) => !p)}
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? (
          <Pause className="size-4 fill-white text-white" />
        ) : (
          <Play className="size-4 fill-white text-white" />
        )}
      </Button>

      {/* Skip forward */}
      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        onClick={() => setPosition((p) => Math.min(duration, p + 10))}
        aria-label="Skip forward 10 seconds"
      >
        <SkipForward className="size-4" />
        <span className="sr-only">+10s</span>
      </Button>

      {/* Time */}
      <span className="text-sm font-mono text-muted-foreground w-10">
        {formatTime(position)}
      </span>

      {/* Waveform placeholder */}
      <div
        className="flex-1 h-8 rounded overflow-hidden bg-muted cursor-pointer relative"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const pct = (e.clientX - rect.left) / rect.width;
          setPosition(Math.round(pct * duration));
        }}
        aria-label="Audio timeline"
      >
        <div
          className="absolute inset-y-0 left-0 bg-primary/20"
          style={{
            width: `${duration > 0 ? (position / duration) * 100 : 0}%`,
          }}
        />
        {/* Decorative waveform bars */}
        <div className="absolute inset-0 flex items-center gap-px px-1">
          {Array.from({ length: 80 }).map((_, i) => (
            <div
              key={i}
              className="flex-1 rounded-full bg-primary/40"
              style={{
                height: `${20 + Math.sin(i * 0.4) * 15 + Math.cos(i * 0.7) * 10}%`,
              }}
            />
          ))}
        </div>
      </div>

      {/* Total duration */}
      <span className="text-sm font-mono text-muted-foreground w-10 text-right">
        {formatTime(duration)}
      </span>

      {/* Speed selector */}
      <select
        className="text-sm border rounded px-1 py-0.5 bg-background"
        defaultValue="1"
        aria-label="Playback speed"
      >
        <option value="0.5">0.5×</option>
        <option value="1">1×</option>
        <option value="1.5">1.5×</option>
        <option value="2">2×</option>
      </select>
    </div>
  );
}
