import { expect, test } from "@playwright/test";

// Exercises the DIAAT-233 hover popup that explains why a word was flagged
// low-confidence, against a running backend. Like the other real-job specs
// (segment-accept.spec.ts), this depends on a real COMPLETED job existing, so
// it is opt-in: set E2E_HOVER_JOB_ID to the id of a job that has at least one
// low-confidence (orange-highlighted) word. The backend must be reachable by
// the frontend (BACKEND_INTERNAL_URL) and the job must belong to the caller
// the frontend authenticates as. Hovering takes no action, so this test does
// not mutate state and is safe to re-run.
const JOB_ID = process.env.E2E_HOVER_JOB_ID;

test.describe("Low-confidence hover popup", () => {
  test.skip(
    !JOB_ID,
    "Set E2E_HOVER_JOB_ID to a job with a low-confidence word to run this test"
  );

  test("hovering a low-confidence word explains why it was flagged, and dismisses on mouse-out", async ({
    page,
  }) => {
    await page.goto(`/batch/jobs/${JOB_ID}`);

    await expect(
      page.getByRole("heading", { name: "Transcript", exact: true })
    ).toBeVisible();

    // The first low-confidence (orange) word/phrase in the transcript.
    const lowConfidenceWord = page.locator("p span.bg-orange-100").first();
    await expect(lowConfidenceWord).toBeVisible();

    // No popup until the clerk hovers.
    await expect(page.getByRole("tooltip")).toHaveCount(0);

    await lowConfidenceWord.hover();

    // The popup appears and explains the problem (always includes a
    // confidence figure; the "Azure also heard" section only when Azure
    // returned alternate readings).
    const popup = page.getByRole("tooltip");
    await expect(popup).toBeVisible();
    await expect(popup).toContainText(/low confidence/i);
    await expect(popup).toContainText(/%/);

    // Purely informational: hovering must not open the inline editor.
    await expect(page.getByRole("textbox")).toHaveCount(0);

    // Dismisses cleanly on mouse-out.
    await page
      .getByRole("heading", { name: "Transcript", exact: true })
      .hover();
    await expect(page.getByRole("tooltip")).toHaveCount(0);

    // Click-to-edit is still intact after hovering.
    await lowConfidenceWord.click();
    await expect(page.getByRole("textbox")).toBeVisible();
  });
});
