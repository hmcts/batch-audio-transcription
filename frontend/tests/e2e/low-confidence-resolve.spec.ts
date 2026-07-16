import { expect, test } from "@playwright/test";

// Exercises the DIAAT-234 click-to-resolve menu against a running backend.
// Like the other real-job specs (low-confidence-hover.spec.ts,
// segment-accept.spec.ts) it depends on a real COMPLETED job, so it is opt-in.
//
// - E2E_RESOLVE_JOB_ID: a job with at least one low-confidence
//   (orange-highlighted) word/phrase that HAS Azure alternatives, so clicking
//   it opens the resolve menu with a "Suggested" list. This test PICKS a
//   suggested alternative, which mutates the job (adds a word-range
//   correction), so point it at a disposable/re-seedable job.
// - E2E_RESOLVE_NO_ALT_JOB_ID (optional): a job whose first low-confidence
//   word has NO alternatives, to verify the menu is skipped and Edit opens
//   directly.
//
// The backend must be reachable by the frontend (BACKEND_INTERNAL_URL) and the
// jobs must belong to the caller the frontend authenticates as.
const JOB_ID = process.env.E2E_RESOLVE_JOB_ID;
const NO_ALT_JOB_ID = process.env.E2E_RESOLVE_NO_ALT_JOB_ID;

test.describe("Low-confidence click-to-resolve menu", () => {
  test.skip(
    !JOB_ID,
    "Set E2E_RESOLVE_JOB_ID to a job with a low-confidence word that has alternatives to run this test"
  );

  test("clicking a low-confidence word with alternatives opens a menu offering Edit and Suggested", async ({
    page,
  }) => {
    await page.goto(`/batch/jobs/${JOB_ID}`);
    await expect(
      page.getByRole("heading", { name: "Transcript", exact: true })
    ).toBeVisible();

    const lowConfidenceWord = page.locator("p span.bg-orange-100").first();
    await expect(lowConfidenceWord).toBeVisible();

    // No menu until the clerk clicks (hover is informational only — DIAAT-233).
    await expect(page.getByRole("menu", { name: /resolve/i })).toHaveCount(0);

    await lowConfidenceWord.click();

    const menu = page.getByRole("menu", { name: /resolve/i });
    await expect(menu).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /edit/i })).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: /suggested/i })
    ).toBeVisible();

    // Edit preserves today's inline text box.
    await page.getByRole("menuitem", { name: /edit/i }).click();
    await expect(page.getByRole("textbox")).toBeVisible();
    // Cancel out without changing anything.
    await page.getByRole("button", { name: /cancel/i }).click();
    await expect(page.getByRole("textbox")).toHaveCount(0);
  });

  test("picking a suggested alternative applies it as a correction that persists in history", async ({
    page,
  }) => {
    await page.goto(`/batch/jobs/${JOB_ID}`);
    await expect(
      page.getByRole("heading", { name: "Transcript", exact: true })
    ).toBeVisible();

    const lowConfidenceWord = page.locator("p span.bg-orange-100").first();
    await expect(lowConfidenceWord).toBeVisible();
    await lowConfidenceWord.click();

    await page.getByRole("menuitem", { name: /suggested/i }).click();
    const suggestions = page.getByRole("menu", {
      name: /suggested alternatives/i,
    });
    await expect(suggestions).toBeVisible();

    // Pick the first offered alternate reading and remember its text.
    const firstCandidate = suggestions.getByRole("menuitem").first();
    const candidateText = ((await firstCandidate.textContent()) ?? "").replace(
      /\s+\d+%\s*$/,
      ""
    );
    await firstCandidate.click();

    // The correction is saved exactly like a typed one: the segment now shows
    // an "Edited" badge and the change appears in the change-history panel.
    await expect(page.getByText("Edited").first()).toBeVisible();

    await page
      .getByLabel(/show change history/i)
      .first()
      .click();
    await expect(page.getByText(/change history/i).first()).toBeVisible();
    // The applied phrase (quotes/percent stripped) shows as the new value.
    const cleaned = candidateText.replace(/[“”"]/g, "").trim().slice(0, 12);
    if (cleaned) {
      await expect(page.getByText(new RegExp(cleaned)).first()).toBeVisible();
    }
  });

  test("a low-confidence word without alternatives skips the menu and opens Edit directly", async ({
    page,
  }) => {
    test.skip(
      !NO_ALT_JOB_ID,
      "Set E2E_RESOLVE_NO_ALT_JOB_ID to a job whose first low-confidence word has no alternatives"
    );
    await page.goto(`/batch/jobs/${NO_ALT_JOB_ID}`);
    await expect(
      page.getByRole("heading", { name: "Transcript", exact: true })
    ).toBeVisible();

    const lowConfidenceWord = page.locator("p span.bg-orange-100").first();
    await expect(lowConfidenceWord).toBeVisible();
    await lowConfidenceWord.click();

    // No resolve menu — straight to the inline editor, preserving today's
    // behaviour. Scoped by name so unrelated menus elsewhere on the page
    // (e.g. header dropdowns) can't make this flaky.
    await expect(page.getByRole("menu", { name: /resolve/i })).toHaveCount(0);
    await expect(page.getByRole("textbox")).toBeVisible();
  });
});
