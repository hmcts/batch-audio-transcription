# DIAAT-232 (Spike): Azure Speech Batch alternative-candidate data for low-confidence words

**Status:** complete — implementation landed alongside this write-up.
**Epic:** DIAAT-225. **Unblocks:** DIAAT-233 (hover popup), DIAAT-234 (click-to-resolve menu).

## TL;DR for the DIAAT-233 / DIAAT-234 authors

- **Azure Speech Batch v3.2 has no per-word alternatives.** Alternatives exist
  **only** at the phrase level, as the `nBest` array — a list of whole alternate
  *readings* of the entire recognised phrase ("hello world" / "helloworld" /
  "hello worm"), each with its own single confidence. There is no "here are 3
  candidate words for the word at position 4" data anywhere in the response.
- **Design implication:** DIAAT-233 and DIAAT-234 must present **alternate
  full-phrase readings**, not per-word swaps. A hover popup keyed to one
  low-confidence word should surface the whole-phrase alternatives that phrase
  belongs to; a click-to-resolve menu should let the clerk replace the phrase's
  word-range with a chosen alternate reading (the existing `WordCorrection`
  word-range mechanism is the right fit — see "How to consume it").
- **What is now persisted:** the full `nBest` array is stored per phrase on each
  `DialogueEntry` as a new `alternatives` field. Previously only `nBest[0]`
  (top choice) was kept; every other candidate was discarded at parse time.
- **Grounding / trust level:** the *schema* conclusions (what fields exist,
  phrase-level-only) are **high confidence** — they come from the documented
  Azure v3.2 response schema and are consistent with the shape the existing
  parser already handles. The *quantitative* conclusions (how many candidates a
  low-confidence phrase yields, how close their confidences are) are based on
  **Azure's published example only** — **there is no recorded real Azure
  response anywhere in this repo** to ground them against HMCTS hearing audio.
  See "Grounding" below; DIAAT-233/234 should not hard-code assumptions about
  candidate counts or confidence gaps without capturing real dev data first.

## Grounding: what this is based on

| Source | Available? | Used for |
| --- | --- | --- |
| Current parsing code in this repo (`batch_client.get_batch_results`) | **Yes** | Confirms only `nBest[0]` was consumed; everything else dropped. |
| Recorded/real Azure JSON fixtures in the test suite | **No — none exist** | The only fixtures are hand-written inline dicts in `tests/unit/audio/test_batch_client.py`, synthetic and minimal (e.g. `nBest: [{"display": "Hello world", "words": []}]`). No captured real response, low-confidence or otherwise. |
| Azure Speech Batch v3.2 documented response schema | **Yes** | Field inventory, phrase-level-vs-word-level question, the worked `nBest` example. |
| Git history of the prior "silently dropped word/confidence" bug (`speakers.py`, DIAAT-217, commit `d8ade15`) | **Yes** | Model for not re-introducing the same class of drop-on-post-process bug. |

**Every conclusion below is tagged `[repo]` (grounded in code/fixtures actually
here), `[docs]` (Azure documented behaviour / example), or `[docs-example]`
(a specific number taken from Azure's single published example and therefore
*illustrative, not measured*).**

## The three questions

### Q1. Are there true word-level alternatives, or only phrase-level `nBest`?

**Only phrase-level.** `[docs]`

The v3.2 transcription result file is:

```
recognizedPhrases[]           # one per recognised phrase / speaker turn
  └─ nBest[]                  # THE ONLY alternatives array — alternate whole-phrase readings
       ├─ confidence          # single float for this whole reading
       ├─ lexical             # raw recognised words
       ├─ itn / maskedITN     # normalised / profanity-masked forms
       ├─ display             # punctuated, capitalised form
       ├─ words[]             # per-word breakdown OF THIS candidate reading
       │    └─ word, offsetInTicks, durationInTicks, confidence
       └─ displayWords[]      # only if displayFormWordLevelTimestampsEnabled=true (we do NOT set this)
```

The `words[]` array under each `nBest` entry is a **decomposition of that one
candidate reading** (its word timings/confidences), *not* a set of alternatives
for a word. There is no `word.nBest`, no `word.alternatives`, no per-word
candidate list anywhere in the schema. `[docs]` So the only "why is this word
low-confidence, and what else could it be?" signal Azure gives is: *the whole
phrase has these N alternate readings, and here is each word's individual
confidence within the top reading.* `[docs]`

Practically, a single low-confidence **word** is diagnosed by combining two
things we already persist: the per-word `confidence` in `words[]` (which word is
weak), and the phrase-level `nBest` alternatives (what the whole phrase could
otherwise have been). `[repo]`

### Q2. How many `nBest` entries for a low-confidence phrase, and how do confidences compare?

**From Azure's documented example** `[docs-example]` — a deliberately
ambiguous "hello world" phrase returned **5** candidates:

| # | display | confidence |
| --- | --- | --- |
| 0 (top) | `Hello world.` | 0.564 |
| 1 | `helloworld` | 0.177 |
| 2 | `hello worlds` | 0.500 |
| 3 | `hello worm` | 0.500 |
| 4 | `hello word` | 0.494 |

Notable properties, all of which DIAAT-233/234 UI must tolerate `[docs-example]`:

- Confidences **do not sum to 1** and are **not monotonically decreasing** —
  candidate 0 is the top choice by Azure's own ranking even though candidates 2
  and 3 have numerically higher-looking values than candidate 1. Treat
  `nBest[0]` as authoritative for ordering; **do not re-sort by confidence.**
- For a genuinely low-confidence phrase the **runner-up confidences can be very
  close to the top** (here 0.50 vs 0.56) — exactly the case a clerk most wants
  alternatives for.
- Candidate `confidence` is occasionally **absent** on non-top entries in the
  wild, so the field is modelled as optional (`float | None`). `[docs]`

**Caveat:** count and spread are audio-dependent. A clean phrase often returns
**one** `nBest` entry; the "5 close candidates" picture is Azure's worked
example, **not measured on HMCTS hearing audio** (none captured — see
Grounding). DIAAT-233/234 should capture a handful of real dev-environment
responses before tuning any "show alternatives when gap < X" heuristic.

### Q3. What other diagnostic data was being dropped?

Before this change the parser kept, from `nBest[0]` only: `display` (→ `text`),
`confidence`, and `words[]`. **Everything else was discarded at parse time.**
`[repo]` Dropped data that is genuinely useful downstream:

- **All non-top `nBest` candidates** (candidates 1..N) — the actual subject of
  this spike. **Now persisted.** `[repo→now fixed]`
- **Per-candidate `lexical`** (raw recognised form) — useful for showing a clerk
  the un-prettified reading. **Now persisted** (`NBestCandidate.lexical`).
- `itn` / `maskedITN` per candidate — inverse-text-normalised and
  profanity-masked variants. **Deliberately NOT persisted:** redundant for the
  en-GB legal-transcript use case and the service already runs
  `profanityFilterMode=None`. Easy to add later if a need appears. `[docs]`
- `displayWords[]` — **never present in our responses**: it requires
  `displayFormWordLevelTimestampsEnabled=true`, which this service does not set
  (it sets `wordLevelTimestampsEnabled=true` instead). Out of scope. `[repo]`
- There is **no separate "punctuation confidence" field** in v3.2. Punctuation
  is baked into `display`/`displayWords`; the only confidence signals are
  per-phrase (`nBest[].confidence`) and per-word (`words[].confidence`). `[docs]`

## What was implemented

1. **New model types** (`database/models.py`):
   - `NBestCandidate` — `text` (display form, British-spelling-normalised),
     `confidence: float | None`, `lexical: str | None`.
   - `PhraseAlternatives` — `candidates: list[NBestCandidate]` plus optional
     `start_word_index` / `end_word_index` (inclusive) locating which words of
     the (possibly speaker-merged) entry these alternatives cover, using the
     **same word-index convention as `WordCorrection`**.
   - `DialogueEntry.alternatives: list[PhraseAlternatives] | None` — a list so
     that speaker-turn merging (which concatenates several phrases into one
     entry) keeps each original phrase's alternatives as its own group with its
     own word range.
2. **Parser** (`batch_client.get_batch_results`): builds a `PhraseAlternatives`
   from the **full** `nBest` array per phrase, anchored to `[0, len(words)-1]`
   when word-level detail is present (word range `None` otherwise). Top choice
   is still surfaced as `text`/`confidence`/`words` exactly as before — the
   array is stored *in addition*, not instead.
3. **Post-processing** (`speakers.py`): all three speaker transforms now
   propagate `alternatives`. On a speaker-turn **merge**, each merged-in phrase's
   word-index ranges are **offset** by the running word count so they still point
   at the right words in the merged `words` list. When word-alignment breaks
   (one side lacks `words`, mirroring the existing rule that nulls `words`), the
   candidates are **kept but their index range is cleared to `None`** — they are
   *not* silently dropped. **This is the specific bug class from DIAAT-217**
   (commit `d8ade15`, where the same three transforms dropped `confidence`/`words`
   entirely); regression tests now cover `alternatives` through the full
   `process_speakers` pipeline the same way.
4. **API** (`api/routes.py`): `alternatives` round-trips out through
   `GET /jobs/{id}` (`PhraseAlternativesResponse` / `NBestCandidateResponse`)
   and is preserved when reconstructing entries for correction endpoints.
5. **Migration** `006_dialogue_entries_gin_index.py` (revision 006):
   `dialogue_entries` is
   schemaless JSONB, so no column change is needed to start storing the field
   (existing rows read back as `None`). The migration adds a GIN index on the
   column ahead of DIAAT-233/234 querying into the now-larger payload.

## How DIAAT-233 / DIAAT-234 should consume it

- **Data shape:** `dialogueEntry.alternatives` is an array of groups. Each group
  = one original recognised phrase, with `candidates` (index 0 = the reading
  already shown as the segment text) and an optional `[startWordIndex,
  endWordIndex]` range into that entry's `words`.
- **DIAAT-233 (hover popup):** on hovering a low-confidence word, find the
  `alternatives` group whose word-range contains that word's index, and show its
  `candidates[1:]` as "Azure also heard…". Show each candidate's `confidence`
  when present; render the top choice (index 0) as the current value. Do not
  re-sort.
- **DIAAT-234 (click-to-resolve):** offer `candidates` as menu options; applying
  one is a **word-range correction** over the group's `[startWordIndex,
  endWordIndex]` using the existing `WordCorrection` mechanism — this is why the
  ranges are persisted in the same index space `WordCorrection` already uses.
  When a group's range is `None` (alignment lost in a merge), fall back to a
  whole-segment correction for that alternative rather than a word-range one.
- **Don't assume ≥2 candidates.** Many phrases return a single candidate; only
  render the alternatives affordance when `candidates.length > 1`.
- **Before shipping:** capture a few real dev-environment transcription results
  (there are none in the repo today) to validate candidate counts / confidence
  gaps against actual hearing audio, and to tune any "worth offering an
  alternative" threshold.

## Testing

- `tests/unit/audio/test_batch_client.py` — full `nBest` array parsed into
  `alternatives`; word-range anchoring present vs. `None`; single-candidate case.
- `tests/unit/audio/test_speakers.py` — propagation through all three transforms;
  word-index offsetting on merge; graceful degrade (candidates kept, range
  nulled) when alignment breaks; full-pipeline survival.
- `tests/unit/database/test_models.py` — `model_dump()` → reconstruct round-trip.
- `tests/integration/test_dialogue_entries_persistence.py` — **real Postgres**
  JSONB round-trip via `save_job_results` + fresh `get_job_by_id` read
  (auto-skips when no DB reachable).
- `tests/unit/api/test_routes.py` — `alternatives` round-trips through
  `GET /jobs/{id}`; `None` when absent.
- **Manual:** Azure's documented 5-candidate "hello world" example was run
  through the real `get_batch_results` → `process_speakers` → `model_dump`
  pipeline; all 5 candidates (top 0.564, alternates down to 0.494) persist
  intact in the stored JSONB, anchored to word range `[0, 1]`.
