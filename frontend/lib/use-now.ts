"use client";

import { useSyncExternalStore } from "react";

// A single, process-wide "current time" clock shared by every subscriber.
// Rendering many live-updating components (e.g. one JobProgress per PROCESSING
// row on the dashboard) must not each spin up their own setInterval — that's
// N timers firing N re-renders a second. Instead they all read from this one
// store, which runs exactly one interval while at least one component is
// mounted and stops it once the last unmounts.

const TICK_INTERVAL_MS = 1000;

let now = new Date();
const listeners = new Set<() => void>();
let intervalId: ReturnType<typeof setInterval> | null = null;

function tick(): void {
  now = new Date();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (intervalId === null) {
    // Refresh immediately so the first subscriber isn't stuck on a stale
    // timestamp left over from a previous mount, then start the shared tick.
    now = new Date();
    intervalId = setInterval(tick, TICK_INTERVAL_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };
}

function getSnapshot(): Date {
  return now;
}

/**
 * Returns the current time, re-rendering the caller roughly once a second.
 * All callers share a single underlying interval (see module comment).
 */
export function useNow(): Date {
  // getServerSnapshot mirrors getSnapshot so this is SSR-safe; the value is
  // stable per render on the server (no interval runs there).
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
