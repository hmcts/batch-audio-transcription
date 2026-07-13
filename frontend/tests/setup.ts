import { afterEach, beforeAll, vi } from "vitest";

// The real "server-only" package throws on import unless resolved with the
// "react-server" condition (which Next.js's bundler sets but Vitest doesn't),
// so stub it out for tests that exercise lib/api-client.ts directly.
vi.mock("server-only", () => ({}));

beforeAll(() => {
  process.env.NEXT_PUBLIC_API_URL = "http://localhost:8000";
  process.env.BACKEND_INTERNAL_URL = "http://localhost:8001";
  process.env.TRANSCRIPTION_API_KEY = "test-api-key";
});

afterEach(() => {
  vi.clearAllMocks();
});

global.URL.createObjectURL = vi.fn(() => "blob:mock-url");
global.URL.revokeObjectURL = vi.fn();

if (typeof localStorage.clear !== "function") {
  const store: Record<string, string> = {};
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
    key: (i: number) => Object.keys(store)[i] ?? null,
    get length() {
      return Object.keys(store).length;
    },
  });
}
