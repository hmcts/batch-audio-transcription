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
    intervalId = setInterval(tick, TICK_INTERVAL_MS);
    // Tick once right away so the first subscriber isn't left on a stale
    // timestamp from a previous mount. This both refreshes `now` and notifies
    // the just-added listener, so React re-reads the snapshot immediately
    // rather than waiting up to a full second for the first interval tick.
    tick();
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

// The server (and the first client render during hydration) must produce
// identical markup, so we can't feed it a live timestamp — that would make
// server output depend on server wall-clock time and cause hydration
// mismatches. Returning null here is a stable sentinel: callers render their
// static content on the server and only add time-based readouts once the
// client takes over and getSnapshot supplies a real Date.
function getServerSnapshot(): Date | null {
  return null;
}

/**
 * Returns the current time, re-rendering the caller roughly once a second,
 * or null during SSR / the first hydration render. All callers share a single
 * underlying interval (see module comment).
 */
export function useNow(): Date | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
