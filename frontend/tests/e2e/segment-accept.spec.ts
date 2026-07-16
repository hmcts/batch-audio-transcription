import { expect, test } from "@playwright/test";

// Exercises the segment-level "accept all" action (DIAAT-229) against a
// running backend. Like the real-pipeline test in dashboard.spec.ts, this
// depends on a real job existing, so it's opt-in: set E2E_ACCEPT_JOB_ID to
// the id of a COMPLETED job whose FIRST segment (index 0) is low-confidence
// and not yet accepted/corrected. The backend must be reachable by the
// frontend (BACKEND_INTERNAL_URL) and the job must belong to the caller the
// frontend authenticates as. It mutates state (accepting is persisted), so
// re-seed the job before re-running.
const JOB_ID = process.env.E2E_ACCEPT_JOB_ID;

test.describe("Segment accept-all", () => {
  test.skip(
    !JOB_ID,
    "Set E2E_ACCEPT_JOB_ID to a seeded low-confidence job id to run this test"
  );

  test("accepting a segment clears it from review without editing the text", async ({
    page,
  }) => {
    await page.goto(`/batch/jobs/${JOB_ID}`);

    // The transcript must have rendered.
    await expect(
      page.getByRole("heading", { name: "Transcript", exact: true })
    ).toBeVisible();

    // The low-confidence first segment appears in the "Needs review" sidebar
    // before it is accepted.
    const needsReview = page.getByText(/needs review/i).first();
    await expect(needsReview).toBeVisible();

    // The accept control is offered for the low-confidence segment.
    const acceptButton = page
      .getByRole("button", { name: /accept segment as-is/i })
      .first();
    await expect(acceptButton).toBeVisible();

    // Capture the segment text so we can prove it is unchanged afterwards.
    const segmentText = "Good morning everyone";
    await expect(page.getByText(segmentText).first()).toBeVisible();

    await acceptButton.click();

    // An "Accepted" badge now marks the segment...
    await expect(page.getByText(/^Accepted$/).first()).toBeVisible();
    // ...the accept button is gone (the segment no longer needs review)...
    await expect(
      page.getByRole("button", { name: /accept segment as-is/i })
    ).toHaveCount(0);
    // ...and the underlying text is untouched.
    await expect(page.getByText(segmentText).first()).toBeVisible();

    // The change is recorded in the history as an "accept" action, distinct
    // from a correction — open the history panel and check the label.
    await page
      .getByLabel(/show change history/i)
      .first()
      .click();
    await expect(page.getByText(/accepted as-is/i)).toBeVisible();
  });
});
