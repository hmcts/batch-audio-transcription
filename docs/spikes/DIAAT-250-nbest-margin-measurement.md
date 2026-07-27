# DIAAT-250 (Spike): measuring nBest availability and top1-top2 confidence margins

**Status:** complete — measurement tooling + procedure delivered; **real dev numbers not yet captured** (auth gap, see Grounding).
**Epic:** DIAAT-225.
**Jira key:** DIAAT-250.
**Related:** DIAAT-245 (confidence-highlighting spike — this quantifies its **option 2**), DIAAT-232 (nBest alternatives persisted), DIAAT-235 (threshold lowered to 0.65).

## TL;DR

- **Goal:** quantify whether the persisted phrase-level nBest alternatives are
  usable as an *extra* low-confidence signal — specifically the **top1-top2
  confidence margin** proposed as DIAAT-245 option 2 (low separation = Azure was
  "torn" = risky even at moderate top-1 confidence).
- **Deliverable shipped:** `scripts/analyze_nbest.py` — a stdlib-only tool that
  takes job-transcript JSON (file, stdin, or by querying the API directly) and
  prints **aggregate-only** stats: candidate-count distribution, top1-top2
  margin distribution, and a cross-tab of margins for phrases already flagged
  (top candidate `< 0.65`).
- **Real dev data: NOT obtained.** The dev API is reachable (`/health` → 200) but
  every authenticated endpoint returns **HTTP 401** with the only credential
  available locally. `.env` is **git-ignored (not committed)**; the committed
  `.env.example` only sets the **local-dev placeholder** `LOCAL_API_KEY=local-dev-key-change-me`
  (`FRONTEND_SERVICE_API_KEY` is left commented out). The real dev key lives in
  Azure Key Vault, not the repo. So the tool has been validated against a
  fixture, and the exact one-command procedure to run it against dev is
  documented below for whoever holds the dev key.
- **Recommendation (provisional, pending real numbers): conditional GO to
  *prototype* option 2, but do NOT ship it as a standalone flag yet.** The margin
  is only defined for phrases with ≥2 candidates, and DIAAT-232 + the Azure docs
  both warn that a **confidently-wrong** substitution (the actual DIAAT-245 pain
  case, "Mr"→"Solicitor") likely returns a **single** candidate — in which case
  the margin signal catches *nothing* on exactly the errors we care about most.
  The measurement below is the gate: run it on real dev data first; only invest
  if a material share of flagged phrases actually have ≥2 candidates with small
  margins.

## Grounding

**No numbers in this document are measured on real HMCTS hearing audio.** This
remains the same blocking gap flagged by DIAAT-232 and DIAAT-245.

| Source | Available? | Used for |
| --- | --- | --- |
| Dev API `GET /api/v1/health` | **Yes — 200** | Confirms the dev service is up and reachable from here. |
| Dev API `GET /api/v1/jobs` (authenticated) | **No — 401** | Would give real jobs+alternatives. Repo credential rejected (see below). |
| Repo credentials | **Placeholder only** | `.env` is git-ignored (not committed). The committed `.env.example` sets only `LOCAL_API_KEY=local-dev-key-change-me` (a local-dev default) and leaves `FRONTEND_SERVICE_API_KEY` commented out. The real dev key is in Key Vault. |
| Recorded real Azure nBest responses in the repo | **No — none exist** | Only synthetic inline dicts in `tests/unit/audio/*`. Same finding as DIAAT-232. |
| Azure v3.2 documented `nBest` example ("hello world", 5 candidates) | **Yes** | Illustrative fixture for validating the tool; **not measured data**. |
| The analysis tool itself (`scripts/analyze_nbest.py`) | **Yes — self-tested** | Produces the aggregate stats; correctness verified on the fixture below. |

**Every number in "Validation run" below is `[fixture]` — illustrative, from the
tool run against Azure's documented example plus synthetic phrases, NOT real
transcripts.**

## Why real dev data was not obtained

- Dev base `https://hmcts-batch-transcription-dev.azurewebsites.net/api/v1` is
  live: `GET /health` returns `200 {"status":"ok"}`.
- Auth is `Authorization: Bearer <key>` (see `frontend/lib/api-client.ts`
  `rawBackendFetch`, and backend `api/dependencies.py` `get_caller`). In a
  deployed (non-local) environment the backend validates the token against
  **bcrypt-hashed keys in its Postgres DB**; the plaintext frontend key is
  injected from **Azure Key Vault** at runtime.
- No usable key is committed to the repo: `.env` is git-ignored (`.gitignore`
  covers `.env` / `.env.*`, excluding only `.env.example`), and the committed
  `.env.example` sets just the local-dev placeholder
  `LOCAL_API_KEY=local-dev-key-change-me`, with `FRONTEND_SERVICE_API_KEY` left
  commented out (`# FRONTEND_SERVICE_API_KEY=change-me`). A developer's local,
  uncommitted `.env` likewise only carries local-dev placeholder values.
- The only key material available anywhere locally is that placeholder; used as
  a bearer token against dev `GET /jobs` it returns
  **HTTP 401 `{"detail":"Invalid API key"}`** — expected, since the dev DB has no
  caller row hashing to the local placeholder.
- **Conclusion:** capturing real numbers needs the actual dev API key (from Key
  Vault, or an operator running the tool from an environment that has it). The
  tool is ready; only the credential is missing. **Mode ended up in: fixture +
  documented procedure.**

## The tool: `scripts/analyze_nbest.py`

Stdlib-only Python. Recursively harvests every phrase-alternatives group (any
object with a `candidates` list) from whatever JSON you give it, so it works on a
single job (`GET /jobs/{id}`), a jobs list (`GET /jobs`), raw dialogue entries,
or the frontend `TranscriptionJob` shape — all share the `candidates` /
`confidence` keys. Candidate order is treated as Azure-authoritative (never
re-sorted); `candidates[0]` is the top reading.

It computes and prints **aggregate statistics only** (no transcript text, no case
references), so its output is safe to paste into Jira:

- **total phrases** (= nBest groups);
- **candidate-count distribution:** % of phrases with 0 / 1 / 2 / 3+ candidates;
- among phrases with **≥2 candidates:** min / median / mean / max of the
  **top1-top2 margin** (`candidates[0].confidence − candidates[1].confidence`);
- **cross-tab:** for phrases whose **top candidate is below the 0.65 threshold**
  (i.e. flagged today), how many have ≥2 candidates and their margin
  distribution.

A candidate `confidence` is optional on non-top entries (DIAAT-232); such
multi-candidate phrases are counted but excluded from the margin stats and
reported separately (`margin_uncomputable_missing_confidence`).

### How to run it against real dev data (the missing step)

```bash
# With the REAL dev API key (from Key Vault; not in the repo):
export TRANSCRIPTION_API_KEY='<dev-frontend-service-api-key>'
python scripts/analyze_nbest.py \
    --api-base https://hmcts-batch-transcription-dev.azurewebsites.net/api/v1 \
    --status succeeded --examples
```

The list endpoint already embeds each job's `dialogue_entries` (and their
`alternatives`) via `_to_response`, so a single paginated `GET /jobs` is
sufficient — no per-job follow-up call. Add `--json` for machine-readable output,
`--max-jobs N` to cap, `--threshold X` to vary the cutoff. Offline equivalents:

```bash
python scripts/analyze_nbest.py saved-jobs.json           # a file
some-producer | python scripts/analyze_nbest.py -          # stdin
```

The output is aggregate-only and contains no case data, so it can be pasted
straight into this doc / the ticket once captured.

## Validation run `[fixture]`

Run against a fixture combining Azure's documented 5-candidate "hello world"
example (top 0.564, runner-up 0.177 → margin **0.387**), one clean
single-candidate phrase, one deliberately "torn" 2-candidate phrase (0.52/0.48 →
margin **0.040**), and one 2-candidate phrase missing a runner-up confidence:

```
Total phrases (nBest groups): 4
Candidate-count distribution:  1→25.0%   2→50.0%   3+→25.0%   (>=2: 75.0%)
Top1-top2 margin (>=2 cands):  min=0.040  median=0.213  mean=0.213  max=0.387
                               (1 phrase skipped: a candidate confidence absent)
Cross-tab, top candidate < 0.65 (flagged today):
  flagged phrases: 3    of those with >=2 cands: 3
  margins:         min=0.040  median=0.213  max=0.387
```

This confirms the tool computes margins correctly, buckets candidate counts,
handles missing confidences, and produces the flagged-phrase cross-tab. **These
percentages are properties of the synthetic fixture, not of real audio** — a real
corpus is expected to be dominated by **1-candidate** phrases (a clean phrase
usually returns a single reading; DIAAT-232 `[docs]`).

## Interpretation for DIAAT-245 option 2 (margin-as-a-flag)

What the eventual real numbers must clear for option 2 to be worth building:

1. **Availability.** The margin only exists for phrases with **≥2 candidates**.
   If real audio returns a single candidate for most phrases (the DIAAT-232
   expectation), the signal is *absent* on most of the transcript and can only
   ever be a supplementary flag, never a primary one.
2. **The confident-wrong blind spot.** DIAAT-245's root cause is that a
   confidently-wrong substitution scores *high* on the top candidate. Azure is
   most likely to return a **single** candidate for exactly those — so a
   margin-based flag would add nothing on the very errors that motivated it. The
   cross-tab ("flagged phrases *with* ≥2 candidates") measures how much overlap
   there actually is.
3. **Separation.** Even where ≥2 candidates exist, the margins must cluster low
   enough for a threshold to separate "torn" from "confident-with-a-near-tie"
   without drowning reviewers in false positives — and candidate confidences are
   non-monotonic and don't sum to 1 (DIAAT-232), so a margin is a rough proxy,
   not a calibrated probability.

## Recommendation

**Conditional GO to prototype, NO-GO to ship blind.**

- **Do first (the gate):** run `scripts/analyze_nbest.py` against real dev data
  (needs the Key Vault dev key) and record the three aggregate numbers here.
  This is now a one-command step.
- **GO to prototype option 2 only if** a material share of currently-flagged
  phrases (top < 0.65) *also* have ≥2 candidates with small margins — i.e. the
  margin catches errors confidence alone rates as borderline. Then it is worth
  trialling as a *secondary* flag alongside the existing threshold.
- **NO-GO / de-prioritise if** flagged phrases are overwhelmingly single-candidate
  (the likely outcome): the margin would flag almost nothing new, and effort is
  better spent on DIAAT-245 option 1 (reviewer-UX reframing + de-pessimising the
  display-token MIN rule), which needs no new signal.
- Regardless of the numbers, the margin is **at best a supplementary** signal: it
  cannot detect confident-wrong substitutions (single-candidate, high top-1),
  which remain unsolvable from Azure confidence data alone (DIAAT-245).

## Key references

- `scripts/analyze_nbest.py` — the measurement tool (this spike).
- `docs/spikes/DIAAT-245-confidence-highlighting.md` — option 2 this quantifies.
- `docs/spikes/DIAAT-232-nbest-alternatives.md` — nBest schema + "capture real data first" caveat.
- `src/transcription_svc/api/routes.py` — `GET /jobs` embeds `dialogue_entries[].alternatives[].candidates[]`.
- `src/transcription_svc/api/dependencies.py` — bearer-token auth (`get_caller`).
- `src/transcription_svc/audio/accuracy.py` — `DEFAULT_CONFIDENCE_THRESHOLD = 0.65`.
- `frontend/lib/api-client.ts` (`toAlternatives`), `frontend/lib/alternatives.ts` — frontend alternatives shape.
