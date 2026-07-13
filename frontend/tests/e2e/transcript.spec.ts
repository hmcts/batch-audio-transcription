import { expect, test } from "@playwright/test";

// These E2E tests require a running server with a real backend behind it —
// there is no more mock data, so there's no fixed job id to test against
// directly. The real "upload -> view transcript" path is covered by
// dashboard.spec.ts's "Real transcription pipeline" test instead; this file
// only covers the parts that don't depend on a specific job existing.
// Run with: pnpm run test:e2e (not included in pnpm run test:unit)

test.describe("Transcript page", () => {
  test("unknown job id shows 404 page", async ({ page }) => {
    await page.goto("/batch/jobs/does-not-exist");
    await expect(page.getByText(/transcript not found/i)).toBeVisible();
  });

  test("back to dashboard link from the 404 page works", async ({ page }) => {
    await page.goto("/batch/jobs/does-not-exist");
    await page.getByRole("link", { name: /back to dashboard/i }).click();
    await expect(page).toHaveURL("/batch");
  });
});
