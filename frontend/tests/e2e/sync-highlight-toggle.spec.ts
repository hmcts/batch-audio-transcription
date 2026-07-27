import { expect, test } from "@playwright/test";

// Exercises the DIAAT-246 audio/transcript sync-highlight toggle against a
// running backend. Like the other real-job specs (segment-accept.spec.ts,
// low-confidence-resolve.spec.ts), it depends on a real COMPLETED job with
// audio available, so it's opt-in: set E2E_SYNC_HIGHLIGHT_JOB_ID to the id of
// such a job. The backend must be reachable by the frontend
// (BACKEND_INTERNAL_URL) and the job must belong to the caller the frontend
// authenticates as. It only toggles a client-side preference (persisted in
// localStorage) — no server state is mutated.
const JOB_ID = process.env.E2E_SYNC_HIGHLIGHT_JOB_ID;

test.describe("Audio/transcript sync-highlight toggle", () => {
  test.skip(
    !JOB_ID,
    "Set E2E_SYNC_HIGHLIGHT_JOB_ID to a seeded COMPLETED job with audio to run this test"
  );

  test("toggles the sync highlight and persists the choice across reloads", async ({
    page,
  }) => {
    await page.goto(`/batch/jobs/${JOB_ID}`);

    // The transcript (and therefore the audio player bar) must have rendered.
    await expect(
      page.getByRole("heading", { name: "Transcript", exact: true })
    ).toBeVisible();

    const toggle = page.getByRole("button", {
      name: /highlight words with audio/i,
    });
    await expect(toggle).toBeVisible();

    // Defaults on.
    await expect(toggle).toHaveAttribute("aria-pressed", "true");

    // Turning it off flips aria-pressed.
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");

    // The choice persists across a reload (localStorage-backed).
    await page.reload();
    const toggleAfterReload = page.getByRole("button", {
      name: /highlight words with audio/i,
    });
    await expect(toggleAfterReload).toHaveAttribute("aria-pressed", "false");
  });
});
