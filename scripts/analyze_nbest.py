#!/usr/bin/env python3
"""Measure Azure Speech Batch nBest availability and top1-top2 confidence margins.

Spike DIAAT-250. Quantifies how usable the persisted phrase-level nBest
alternatives (DIAAT-232) are as an extra low-confidence signal for DIAAT-245
option 2 (phrase-level margin as a flag). It answers three questions over a set
of transcription jobs:

  1. How often does Azure return >1 nBest candidate per phrase?
  2. What is the distribution of the top1-top2 confidence gap (margin)?
  3. For phrases whose TOP candidate is below the 0.65 review threshold (i.e.
     already flagged today), how many have a usable (>=2) candidate set, and
     what do their margins look like?

It prints AGGREGATE statistics only. It never prints raw transcript text or
case references, so its output is safe to paste into a spike write-up. (Pass
--examples to additionally print a few anonymised, text-free illustrative
margins.)

--------------------------------------------------------------------------------
INPUT
--------------------------------------------------------------------------------
The tool accepts the JSON shape returned by the transcription_svc API and is
tolerant of how much of it you feed in. It recursively harvests every
phrase-alternatives group (any object with a "candidates" list) from:

  * a single job object            (GET /api/v1/jobs/{id})
  * a list-jobs response           (GET /api/v1/jobs -> {"jobs": [...]})
  * a bare list of jobs / entries
  * the frontend TranscriptionJob shape (segment.alternatives) -- same
    "candidates" / "confidence" keys, so it works unchanged.

Each group's candidates[0] is Azure's authoritative top reading (never
re-sorted). A candidate's "confidence" may be absent on non-top entries; such
groups are counted but excluded from margin stats (reported separately).

--------------------------------------------------------------------------------
USAGE
--------------------------------------------------------------------------------
  # From a saved JSON file (a single job, a jobs list, etc.)
  python scripts/analyze_nbest.py transcript.json

  # From stdin
  cat transcript.json | python scripts/analyze_nbest.py -

  # Directly from an API (paginates GET /jobs?status=succeeded). The bearer
  # token is read from an env var -- never passed on the command line.
  TRANSCRIPTION_API_KEY=... python scripts/analyze_nbest.py \
      --api-base https://hmcts-batch-transcription-dev.azurewebsites.net/api/v1

  # Options
  --threshold 0.65     Review threshold for the "top candidate below threshold"
                       cross-tab (default 0.65, matching DEFAULT_CONFIDENCE_THRESHOLD).
  --key-env NAME       Env var holding the bearer token (default TRANSCRIPTION_API_KEY).
  --status STATUS      Job status to fetch in API mode (default: succeeded).
  --max-jobs N         Cap on jobs fetched in API mode (default: all).
  --examples           Also print up to 5 anonymised, text-free example margins.
  --json               Emit the aggregate stats as JSON instead of a report.

Stdlib only -- no third-party dependencies.
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Any

DEFAULT_THRESHOLD = 0.65  # matches src/transcription_svc/audio/accuracy.py
DEFAULT_KEY_ENV = "TRANSCRIPTION_API_KEY"


# ---------------------------------------------------------------------------
# Harvesting phrase-alternatives groups from arbitrary API/frontend JSON
# ---------------------------------------------------------------------------


def harvest_groups(node: Any) -> list[list[dict]]:
    """Recursively collect every phrase-alternatives group's candidate list.

    A "group" is any object carrying a "candidates" list (the shape shared by
    the backend PhraseAlternativesResponse and the frontend PhraseAlternatives).
    Recursing over the whole document -- rather than hard-coding a
    jobs[].dialogue_entries[].alternatives[] path -- keeps the tool working
    across the single-job, jobs-list, raw-entries and frontend shapes without
    special-casing each.
    """
    groups: list[list[dict]] = []

    def walk(n: Any) -> None:
        if isinstance(n, dict):
            cands = n.get("candidates")
            if isinstance(cands, list):
                groups.append([c for c in cands if isinstance(c, dict)])
            for value in n.values():
                walk(value)
        elif isinstance(n, list):
            for item in n:
                walk(item)

    walk(node)
    return groups


def _confidence(candidate: dict) -> float | None:
    c = candidate.get("confidence")
    return float(c) if isinstance(c, (int, float)) else None


# ---------------------------------------------------------------------------
# Aggregate statistics
# ---------------------------------------------------------------------------


@dataclass
class Stats:
    total_phrases: int = 0
    count_by_bucket: dict[str, int] = field(
        default_factory=lambda: {"0": 0, "1": 0, "2": 0, "3+": 0}
    )
    multi_candidate_phrases: int = 0  # >=2 candidates
    margins: list[float] = field(default_factory=list)  # top1-top2, both present
    margin_uncomputable: int = 0  # >=2 candidates but a confidence missing

    # Cross-tab: top candidate confidence below the review threshold.
    flagged_phrases: int = 0  # top1 confidence present AND < threshold
    flagged_with_alternatives: int = 0  # of those, with >=2 candidates
    flagged_margins: list[float] = field(default_factory=list)
    example_margins: list[float] = field(default_factory=list)


def _bucket(n: int) -> str:
    if n <= 0:
        return "0"
    if n == 1:
        return "1"
    if n == 2:
        return "2"
    return "3+"


def analyze(groups: list[list[dict]], threshold: float) -> Stats:
    s = Stats()
    for candidates in groups:
        s.total_phrases += 1
        n = len(candidates)
        s.count_by_bucket[_bucket(n)] += 1

        top1 = _confidence(candidates[0]) if n >= 1 else None
        top2 = _confidence(candidates[1]) if n >= 2 else None

        margin: float | None = None
        if n >= 2:
            s.multi_candidate_phrases += 1
            if top1 is not None and top2 is not None:
                margin = top1 - top2
                s.margins.append(margin)
                if len(s.example_margins) < 5:
                    s.example_margins.append(margin)
            else:
                s.margin_uncomputable += 1

        # Cross-tab against the review threshold (top candidate flagged today).
        if top1 is not None and top1 < threshold:
            s.flagged_phrases += 1
            if n >= 2:
                s.flagged_with_alternatives += 1
                if margin is not None:
                    s.flagged_margins.append(margin)
    return s


def _dist(values: list[float]) -> dict[str, float] | None:
    if not values:
        return None
    return {
        "min": min(values),
        "median": statistics.median(values),
        "mean": statistics.fmean(values),
        "max": max(values),
    }


def stats_to_dict(s: Stats, threshold: float) -> dict:
    total = s.total_phrases or 1  # avoid /0 in percentages when empty

    def pct(n: int) -> float:
        return round(100 * n / total, 1)

    return {
        "threshold": threshold,
        "total_phrases": s.total_phrases,
        "candidate_count_distribution": {
            k: {"count": v, "pct": pct(v)} for k, v in s.count_by_bucket.items()
        },
        "multi_candidate_phrases": s.multi_candidate_phrases,
        "multi_candidate_pct": pct(s.multi_candidate_phrases),
        "margin_distribution": _dist(s.margins),
        "margins_computed": len(s.margins),
        "margin_uncomputable_missing_confidence": s.margin_uncomputable,
        "flagged_top_below_threshold": {
            "count": s.flagged_phrases,
            "with_alternatives_ge2": s.flagged_with_alternatives,
            "margin_distribution": _dist(s.flagged_margins),
        },
    }


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------


def _fmt_dist(d: dict[str, float] | None) -> str:
    if d is None:
        return "n/a (no data)"
    return f"min={d['min']:.3f}  median={d['median']:.3f}  mean={d['mean']:.3f}  max={d['max']:.3f}"


def print_report(s: Stats, threshold: float, examples: bool) -> None:
    d = stats_to_dict(s, threshold)
    out = sys.stdout.write

    out("=" * 70 + "\n")
    out("nBest availability & top1-top2 margin  (DIAAT-250)\n")
    out("=" * 70 + "\n\n")

    if s.total_phrases == 0:
        out("No phrase-alternatives groups found in the input.\n")
        out("(Jobs may pre-date DIAAT-232, or the input carries no alternatives.)\n")
        return

    out(f"Total phrases (nBest groups): {s.total_phrases}\n\n")

    out("Candidate-count distribution (per phrase):\n")
    for k in ("0", "1", "2", "3+"):
        b = d["candidate_count_distribution"][k]
        out(f"  {k:>3} candidate(s): {b['count']:>7}  ({b['pct']:>5.1f}%)\n")
    out(
        f"\n  >=2 candidates (usable as a margin signal): "
        f"{s.multi_candidate_phrases} ({d['multi_candidate_pct']:.1f}%)\n\n"
    )

    out("Top1-top2 confidence margin (phrases with >=2 candidates):\n")
    out(f"  computed on {len(s.margins)} phrase(s): {_fmt_dist(d['margin_distribution'])}\n")
    if s.margin_uncomputable:
        out(
            f"  ({s.margin_uncomputable} multi-candidate phrase(s) skipped: "
            "a candidate confidence was absent)\n"
        )
    out("\n")

    ft = d["flagged_top_below_threshold"]
    out(f"Cross-tab: phrases whose TOP candidate is below {threshold} (flagged today):\n")
    out(f"  flagged phrases:            {ft['count']}\n")
    out(f"  of those, with >=2 cands:   {ft['with_alternatives_ge2']}\n")
    out(f"  their margin distribution:  {_fmt_dist(ft['margin_distribution'])}\n\n")

    if examples and s.example_margins:
        out("Illustrative margins (anonymised; no transcript text):\n")
        for m in s.example_margins:
            out(f"  a phrase with >=2 candidates, margin {m:.3f}\n")
        out("\n")


# ---------------------------------------------------------------------------
# Input loading
# ---------------------------------------------------------------------------


def load_from_file_or_stdin(path: str) -> Any:
    if path == "-":
        return json.load(sys.stdin)
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def load_from_api(
    api_base: str,
    token: str,
    status: str,
    max_jobs: int | None,
    page_size: int = 100,
) -> list[dict]:
    """Paginate GET {api_base}/jobs?status=... and return the job objects.

    The list endpoint already embeds each job's dialogue_entries (and their
    alternatives) via _to_response, so no per-job follow-up fetch is needed.
    """
    # Enforce http/https ourselves: urllib.request would otherwise happily
    # open file://, ftp:// etc. from a mistyped/hostile --api-base. Suppressing
    # Ruff S310 is not a substitute for this check.
    scheme = urllib.parse.urlparse(api_base).scheme.lower()
    if scheme not in ("http", "https"):
        raise SystemExit(
            f"--api-base must be an http(s) URL, got scheme '{scheme or '(none)'}': {api_base}"
        )

    base = api_base.rstrip("/")
    jobs: list[dict] = []
    offset = 0
    while True:
        limit = page_size if max_jobs is None else min(page_size, max_jobs - len(jobs))
        if limit <= 0:
            break
        url = f"{base}/jobs?status={status}&limit={limit}&offset={offset}"
        # S310 is suppressed because the scheme is validated to be http(s)
        # above and the base URL is caller-supplied (a CLI operator), not
        # attacker-controlled.
        req = urllib.request.Request(  # noqa: S310
            url, headers={"Authorization": f"Bearer {token}"}
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:  # noqa: S310
                body = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            raise SystemExit(f"API request failed: HTTP {exc.code} {exc.reason} for {url}") from exc
        except urllib.error.URLError as exc:
            raise SystemExit(f"API unreachable: {exc.reason} for {url}") from exc

        page = body.get("jobs", []) if isinstance(body, dict) else []
        jobs.extend(page)
        total = body.get("total", len(jobs)) if isinstance(body, dict) else len(jobs)
        offset += len(page)
        if not page or offset >= total or (max_jobs is not None and len(jobs) >= max_jobs):
            break
    return jobs


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Measure nBest availability and top1-top2 margins (DIAAT-250).",
    )
    parser.add_argument(
        "input",
        nargs="?",
        help="Path to a job-transcript JSON file, or '-' for stdin. Omit when using --api-base.",
    )
    parser.add_argument("--api-base", help="API base URL, e.g. https://.../api/v1")
    parser.add_argument(
        "--key-env",
        default=DEFAULT_KEY_ENV,
        help=f"Env var holding the bearer token (default {DEFAULT_KEY_ENV}).",
    )
    parser.add_argument("--status", default="succeeded", help="Job status to fetch (API mode).")
    parser.add_argument(
        "--max-jobs", type=int, default=None, help="Cap on jobs fetched (API mode)."
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=DEFAULT_THRESHOLD,
        help=f"Review threshold for the cross-tab (default {DEFAULT_THRESHOLD}).",
    )
    parser.add_argument("--examples", action="store_true", help="Print anonymised example margins.")
    parser.add_argument("--json", action="store_true", help="Emit aggregate stats as JSON.")
    args = parser.parse_args(argv)

    # File/stdin input and --api-base are two distinct sources for the same
    # data; accepting both is ambiguous (the path would be silently ignored),
    # so reject it rather than pick one.
    if args.input and args.api_base:
        parser.error("provide either an input file/'-' for stdin OR --api-base, not both")

    if args.api_base:
        import os

        token = os.environ.get(args.key_env)
        if not token:
            raise SystemExit(
                f"Env var {args.key_env} is not set; cannot authenticate to {args.api_base}"
            )
        data: Any = load_from_api(args.api_base, token, args.status, args.max_jobs)
    elif args.input:
        data = load_from_file_or_stdin(args.input)
    else:
        parser.error("provide an input file/'-' for stdin, or --api-base")

    groups = harvest_groups(data)
    stats = analyze(groups, args.threshold)

    if args.json:
        print(json.dumps(stats_to_dict(stats, args.threshold), indent=2))
    else:
        print_report(stats, args.threshold, args.examples)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
