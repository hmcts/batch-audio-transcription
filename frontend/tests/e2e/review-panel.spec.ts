import { expect, test } from "@playwright/test";

// DIAAT-236: the "Needs review" / accuracy sidebar must stay in view while
// the user scrolls a long transcript (potentially ~15,000 words), instead
// of scrolling off the top of the page.
//
// This needs a real COMPLETED job with an accuracy-scored transcript to
// render the sidebar at all. There's no fixed job id against a real
// backend (see transcript.spec.ts), so this test is opt-in: point it at a
// seeded/known COMPLETED job via E2E_REVIEW_PANEL_JOB_ID. Locally, seed a
// long job directly in the DB and export that id before running
// `pnpm run test:e2e`. Without the env var the test skips, so it never
// fails the CI e2e run (which has no such job).
const JOB_ID = process.env.E2E_REVIEW_PANEL_JOB_ID;

test.describe("Review panel stays visible while scrolling", () => {
  test.skip(
    !JOB_ID,
    "Set E2E_REVIEW_PANEL_JOB_ID to a COMPLETED job's id (with accuracy data) to run this test"
  );

  test("the review panel remains within the viewport after scrolling to the bottom", async ({
    page,
  }) => {
    await page.goto(`/batch/jobs/${JOB_ID}`);

    // The sidebar only renders once accuracy data is present.
    const panel = page.getByRole("heading", { name: /needs review/i });
    await expect(panel).toBeVisible();

    const sidebar = page.locator("aside").filter({ has: panel });
    await expect(sidebar).toBeVisible();

    const viewport = page.viewportSize();
    if (!viewport) throw new Error("viewport size unavailable");

    // Sanity check: the transcript must actually be long enough that a
    // non-sticky sidebar would scroll out of view — otherwise this test
    // would pass trivially and prove nothing.
    const scrollHeight = await page.evaluate(
      () => document.documentElement.scrollHeight
    );
    expect(scrollHeight).toBeGreaterThan(viewport.height * 2);

    // Scroll to the very bottom of the (very long) transcript.
    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight)
    );
    // Let the sticky reposition settle.
    await page.waitForTimeout(200);

    // The sidebar must still be within the viewport bounds — i.e. it stuck
    // rather than scrolling away with the transcript.
    const box = await sidebar.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeLessThan(viewport.height);
    // Its top edge should be pinned near the top of the viewport (it sticks
    // just below the audio player bar), not pushed off the bottom.
    expect(box.y).toBeLessThan(viewport.height / 2);

    // And Playwright agrees it's visible after the scroll.
    await expect(panel).toBeInViewport();
  });
});
