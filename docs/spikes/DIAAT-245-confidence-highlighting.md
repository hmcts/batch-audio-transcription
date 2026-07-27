# DIAAT-245 (Spike): why low-confidence highlighting flags the wrong words

**Status:** complete — investigation only; no behaviour change in this PR.
**Epic:** DIAAT-225.
**Jira key:** DIAAT-245.
**Related:** DIAAT-235 (lowered the threshold to 0.65), DIAAT-232 (nBest alternatives), DIAAT-228 (baseline WER).

## TL;DR

- The reported case (24-813/v3): "General" was **correct** but highlighted at 22%
  confidence, while "Mr" — a **mistranscription** of "Solicitor" — was **not**
  highlighted.
- **Root cause:** highlighting thresholds Azure Speech's per-word/per-phrase
  `confidence`, which is an **acoustic + language-model posterior — a measure of
  recognition *certainty*, not *correctness*.** The two are independent, so no
  threshold on this single signal can make "highlighted" mean "worth a
  reviewer's attention":
  - **Confident-wrong** ("Mr" for "Solicitor"): a substitution that is a good
    acoustic/LM match to the wrong word scores **high** → above threshold →
    **not flagged**. Structurally impossible to catch from confidence alone.
  - **Unconfident-right** ("General"): a short/ambiguous but correct word scores
    **low** → **flagged**.
- The codebase already says as much: confidence is "not a measurement of
  correctness — nothing has verified it against ground truth"
  (`src/transcription_svc/audio/accuracy.py`).
- **This is a fundamental limitation, not a tuning problem.** The acceptance
  criteria cannot be fully met by thresholding confidence.
- A smaller, in-app amplifier makes the false-positive worse: a display token's
  confidence is the **pessimistic MIN** over an approximate proportional
  word-bucket mapping (`frontend/lib/word-alignment.ts`), so one weak neighbour
  can drag a correct token below threshold.

## Grounding

| Source | Available? | Used for |
| --- | --- | --- |
| Current flagging code (frontend `transcript-segment.tsx`, `word-alignment.ts`; backend `accuracy.py`, `batch_client.py`) | **Yes** | Confirms confidence is the only flagging signal; how the threshold is derived and threaded. |
| Azure Speech per-word/per-phrase `confidence` semantics | **Yes (documented)** | Confirms it is a recognition posterior, orthogonal to correctness. |
| nBest alternatives (DIAAT-232) | **Persisted, phrase-level only** | Candidate extra signal — but no per-word candidates exist in Azure v3.2. |
| Recorded real Azure responses on HMCTS hearing audio | **No — none exist** | The blocking gap for any margin/entropy heuristic (see DIAAT-232 spike). |

## How highlighting decides "low confidence" today

Two mechanisms, same threshold, different granularity:

- **Frontend per-word/token (the path in the report).**
  `frontend/components/transcript/transcript-segment.tsx` — `LOW_CONFIDENCE_THRESHOLD = 0.65`;
  `groupByConfidence` flags a display token when `token.confidence < threshold`
  (unless highlighting is suppressed for the segment, e.g. after an "accept all").
  A display token's `.confidence` is the **MIN** confidence of the lexical words
  proportionally mapped to it (`frontend/lib/word-alignment.ts`). The threshold
  is threaded from the backend (`job.accuracy.confidenceThreshold`, a 0–100
  percent, divided by 100 in `job-detail-view.tsx`).
- **Backend per-phrase "needs review" list.**
  `src/transcription_svc/audio/accuracy.py` — `DEFAULT_CONFIDENCE_THRESHOLD = 0.65`
  (DIAAT-235 lowered it from 0.85 because the list was dominated by
  correctly-recognised short/common words). `needs_review` selects whole entries
  whose confidence is present and `< threshold`, excluding entries already
  accepted or corrected. Per-word confidence originates in
  `batch_client.py` from Azure's `words[].confidence`; per-phrase from
  `nBest[0].confidence`.

**Confidence is the only signal used to decide what gets flagged.** The nBest
alternatives (DIAAT-232) are shown only *after* a word is flagged (hover popup /
resolve menu); they play no part in the flagging decision.

## Signals already available (and their limits)

- **nBest phrase alternatives (DIAAT-232)** — persisted per phrase, but
  **phrase-level only**; Azure v3.2 exposes no per-word candidate list, so a
  per-word top1–top2 margin is not computable. Candidate confidences are
  non-monotonic and don't sum to 1, and a clean phrase often returns a single
  candidate. Critically, **no real Azure nBest response has ever been captured
  on HMCTS hearing audio**, so we don't know how often >1 candidate is returned
  or how separated their confidences are.
- **Per-word timing/duration** (`Word.startTime/endTime`) — available now; could
  detect speaking-rate outliers, but lexical errors like "Mr"/"Solicitor" aren't
  primarily timing anomalies.
- **Per-candidate `lexical` form** — persisted; currently only shown in the
  resolve menu.
- **Baseline WER (DIAAT-228)** — real correctness signal, but only exists once a
  clerk uploads a reference transcript; not general.
- **No domain/legal lexicon** exists in the codebase today.

## Options considered (ranked by value-for-effort)

1. **(Recommended, cheap) Reviewer UX + de-pessimise the token MIN.** Reframe the
   orange highlight as "scan these", surface the already-persisted nBest
   alternatives more prominently, and revisit the display-token **MIN**-confidence
   rule (`word-alignment.ts`) that can over-flag a correct token like "General"
   because of a weak neighbour. No new signal; all data already in the UI.
2. **(Needs data first) Phrase-level top1–top2 nBest margin / entropy** as an
   extra flag — low separation = Azure was "torn" = risky even at moderate top-1
   confidence. Must be validated against **captured real dev responses** before
   building (per DIAAT-232). For a confidently-wrong word Azure likely returns a
   single candidate, so this may catch nothing — validate before investing.
3. **Word duration / speaking-rate outliers** — weak/indirect for lexical
   substitutions; high false-positive risk.
4. **Domain / legal-term lexicon** — the only approach that could *directly*
   address "Mr → Solicitor", but done properly it means Azure Custom Speech /
   phrase-list biasing at recognition time: large effort, no infra today.
5. **Flag-on-plausible-alternative** — a cruder variant of (2); lowest precision.

## Recommendation

1. **Do now (small, prototype-worthy):** a follow-up story for the UX reframing +
   investigating whether softening the display-token MIN rule reduces false
   positives like "General" — a small, contained change needing no new signal.
2. **Prerequisite spike before any detection change:** capture a handful of real
   dev-environment transcription responses (including known mistranscriptions)
   and measure nBest candidate counts and top1–top2 confidence spread. Only then
   is option (2) worth prototyping.

Do **not** invest in options 3–5 yet.

## Not solvable with current Azure data

- Detecting confident-wrong substitutions ("Mr" → "Solicitor") from confidence
  alone — impossible in principle (confidence ≠ correctness).
- Per-word alternatives / per-word margins — Azure v3.2 provides alternatives
  only at the whole-phrase level (DIAAT-232).
- Any general correctness measure without ground truth — only baseline WER
  (needs an uploaded reference) or clerk corrections give that, and neither is
  available at initial transcription time.

## Key references

- `frontend/components/transcript/transcript-segment.tsx` — `LOW_CONFIDENCE_THRESHOLD`, `groupByConfidence`, `buildRuns`.
- `frontend/lib/word-alignment.ts` — per-display-token confidence = MIN of mapped lexical words.
- `frontend/lib/alternatives.ts`, `frontend/lib/api-client.ts` (`toAlternatives`), `frontend/components/transcript/job-detail-view.tsx` (threshold threading).
- `src/transcription_svc/audio/accuracy.py` — `DEFAULT_CONFIDENCE_THRESHOLD`, `needs_review`.
- `src/transcription_svc/audio/batch_client.py` — per-word/per-phrase confidence + nBest parsing.
- `docs/spikes/DIAAT-232-nbest-alternatives.md` — nBest availability + the "capture real data first" caveat.
