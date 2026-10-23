"""DIAAT-287 AC3: scan everything a test exported for prohibited content.

Independent of the service's redaction rules: if a rule is removed or a new code path
logs something it should not, the scan still fails. Two kinds of check:

* seeded values: the realistic case data the validation scenarios feed in (file
  names with a case reference and party names, transcript text, speaker names, blob
  paths, SAS signatures, emails, Azure's free-text error message, a bearer token).
  None of them may appear anywhere;
* pattern classes: emails, UK case references, SAS signatures, bearer tokens and JWTs,
  UK postcodes and National Insurance numbers. No match may appear anywhere, whatever
  the value.

Findings name the seed or pattern and where it was found, never the matched text, so
the evidence file can be attached to the release evidence as it is.

Every seeded value is built at runtime (concatenation): a literal in a source line
would reach telemetry through any exception's stack trace and fail the scan for the
wrong reason.
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any

from hmcts_otel import conventions as c
from hmcts_otel.testing import TelemetryCapture

# Seeded values ----------------------------------------------------------------------------

CASE_REFERENCE = "PA" + "/50123/" + "2024"  # an Immigration and Asylum Chamber appeal
CASE_REFERENCE_IN_FILE = "PA" + "_50123_" + "2024"
APPELLANT_GIVEN_NAME = "Ade" + "bayo"  # one word: fits identifier-shaped attributes
APPELLANT = APPELLANT_GIVEN_NAME + " Okonkwo-" + "Hargreaves"
APPELLANT_SURNAME = "Okonkwo-" + "Hargreaves"
RESPONDENT = "Secretary of State " + "for the Home Department"
SPEAKER_NAME = "Judge " + "Fairweather-Lindqvist"
USER_EMAIL = "clerk." + "one" + "@" + "justice.example"
PARTY_EMAIL = "adebayo.okonkwo" + "@" + "mail.example"
POSTCODE = "SW1A" + " 2AA"
NI_NUMBER = "AB" + " 12 34 56 " + "C"
SAS_SIGNATURE = "c2VjcmV0" + "LXNpZ25hdHVyZS1mb3ItdGVzdA"
SPEECH_KEY = "5f1e0c" + "9a7b3d4e8f2a6c1b0d9e7f3a"  # the Azure Speech subscription key
BEARER_TOKEN = (
    "eyJ" + "hbGciOiJSUzI1NiJ9" + "." + "eyJ" + "zdWIiOiJjbGVyayJ9" + "." + "c2lnbmF0dXJlLXZhbHVl"
)

# What the user's file is called, and what the upload stores it as.
ORIGINAL_FILE_NAME = f"{CASE_REFERENCE_IN_FILE} {APPELLANT} v Home Office.mp3"
FILE_STEM = f"{CASE_REFERENCE_IN_FILE}_" + APPELLANT.replace(" ", "_") + "_v_Home_Office"
TRANSCRIPT_TEXT = (
    f"My name is {APPELLANT}. I live at 4 Acacia Avenue, {POSTCODE}. "
    f"My national insurance number is {NI_NUMBER} and my email is {PARTY_EMAIL}."
)
SPEAKER_TEXT = (
    f"I am {SPEAKER_NAME} and this is the appeal of {APPELLANT} against the {RESPONDENT}."
)
AZURE_ERROR_MESSAGE = (
    f"Cannot transcribe {FILE_STEM}.wav for {APPELLANT}: the recordings URI "
    f"https://teststorage.blob.core.windows.net/x/{FILE_STEM}.wav"
    f"?sv=2024-05-04&sig={SAS_SIGNATURE} "
    "contains invalid data"
)

# label -> value. Labels go in the evidence; values never do.
SEEDED: dict[str, str] = {
    "case_reference": CASE_REFERENCE,
    "case_reference_in_file_name": CASE_REFERENCE_IN_FILE,
    "appellant_name": APPELLANT,
    "appellant_given_name": APPELLANT_GIVEN_NAME,
    "appellant_surname": APPELLANT_SURNAME,
    "respondent_name": RESPONDENT,
    "speaker_name": SPEAKER_NAME,
    "original_file_name": ORIGINAL_FILE_NAME,
    "stored_file_stem": FILE_STEM,
    "transcript_text": TRANSCRIPT_TEXT,
    "speaker_text": SPEAKER_TEXT,
    "user_email": USER_EMAIL,
    "party_email": PARTY_EMAIL,
    "postcode": POSTCODE,
    "ni_number": NI_NUMBER,
    "sas_signature": SAS_SIGNATURE,
    "bearer_token": BEARER_TOKEN,
    "speech_subscription_key": SPEECH_KEY,
    "azure_error_message": AZURE_ERROR_MESSAGE,
}

# Pattern classes --------------------------------------------------------------------------

PATTERNS: dict[str, re.Pattern[str]] = {
    "email": re.compile(
        r"[A-Za-z0-9._%+'-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})*\.[A-Za-z]{2,24}"
    ),
    # IAC appeal references (PA/50123/2024, PA_50123_2024 in file names), Crown Court
    # case numbers (T20247001) and county/family court case numbers (ZW24C50012).
    "uk_case_reference": re.compile(
        r"(?i:(?<![A-Za-z0-9])[A-Z]{2}[/_ ]\d{5}[/_ ]\d{4}(?![0-9]))"
        r"|\bT\d{8}\b"
        r"|\b[A-Z]{2}\d{2}[A-Z]\d{5}\b"
    ),
    # A SAS token's signature value; "sig=[REDACTED]" is the redacted form, allowed.
    "sas_signature": re.compile(r"(?i)\bsig=[A-Za-z0-9%+/]{8,}"),
    "bearer_token": re.compile(r"(?i)\bbearer\s{1,8}[A-Za-z0-9._~+/-]{16,}"),
    "jwt": re.compile(r"\beyJ[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}\."),
    "uk_postcode": re.compile(r"\b(?:[A-PR-UWYZ][A-HK-Y]?\d[A-Z\d]?) ?\d[ABD-HJLNP-UW-Z]{2}\b"),
    "ni_number": re.compile(
        r"\b(?!BG|GB|NK|KN|TN|NT|ZZ)[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z]"
        r" ?\d{2} ?\d{2} ?\d{2} ?[A-D]\b"
    ),
}


# Collection -------------------------------------------------------------------------------


@dataclass(frozen=True)
class Exported:
    """One exported string and where it came from (e.g. "log attribute")."""

    where: str
    text: str


@dataclass
class Counts:
    spans: int = 0
    span_events: int = 0
    log_records: int = 0
    custom_events: int = 0
    metric_points: int = 0
    attributes: int = 0

    def add(self, other: Counts) -> None:
        for name in self.__dataclass_fields__:
            setattr(self, name, getattr(self, name) + getattr(other, name))


def _attribute_items(where: str, attributes: Any, counts: Counts) -> Iterator[Exported]:
    for key, value in dict(attributes or {}).items():
        counts.attributes += 1
        yield Exported(f"{where} key", str(key))
        text = value if isinstance(value, str) else json.dumps(value, default=str)
        yield Exported(where, text)


def exported_items(tel: TelemetryCapture) -> tuple[list[Exported], Counts]:
    """Every string the capture would export: spans (name, attributes, status, events and
    their attributes, links' attributes), log records (body, attributes, so custom events
    too), metric data point attributes, and the resource attributes exported with each
    of the three signals (service name, environment, anything from
    OTEL_RESOURCE_ATTRIBUTES). Each distinct resource is scanned once per signal."""
    counts = Counts()
    items: list[Exported] = []
    seen_resources: set[tuple[str, int]] = set()

    def resource_items(signal: str, resource: Any) -> None:
        if resource is None or (signal, id(resource)) in seen_resources:
            return
        seen_resources.add((signal, id(resource)))
        items.extend(_attribute_items(f"{signal} resource attribute", resource.attributes, counts))

    for span in tel.finished_spans():
        counts.spans += 1
        items.append(Exported("span name", span.name))
        items.extend(_attribute_items("span attribute", span.attributes, counts))
        if span.status.description:
            items.append(Exported("span status", span.status.description))
        for event in span.events:
            counts.span_events += 1
            items.append(Exported("span event name", event.name))
            items.extend(_attribute_items("span event attribute", event.attributes, counts))
        for link in span.links:
            items.extend(_attribute_items("span link attribute", link.attributes, counts))
        resource_items("span", span.resource)
    for readable in tel.logs.get_finished_logs():
        resource_items("log", getattr(readable, "resource", None))
    for record in tel.log_records():
        counts.log_records += 1
        attributes = dict(record.attributes or {})
        if attributes.get(c.CUSTOM_EVENT_NAME) is not None:
            counts.custom_events += 1
        items.append(Exported("log body", str(record.body)))
        items.extend(_attribute_items("log attribute", attributes, counts))
    data = tel.metrics.get_metrics_data()
    if data is not None:
        for resource_metrics in data.resource_metrics:
            resource_items("metric", resource_metrics.resource)
            for scope_metrics in resource_metrics.scope_metrics:
                for metric in scope_metrics.metrics:
                    for point in metric.data.data_points:
                        counts.metric_points += 1
                        items.extend(_attribute_items("metric attribute", point.attributes, counts))
    return items, counts


@dataclass(frozen=True)
class Finding:
    kind: str  # "seeded" or "pattern"
    name: str  # the seed label or pattern name: never the matched text
    where: str

    def as_dict(self) -> dict[str, str]:
        return {"kind": self.kind, "name": self.name, "where": self.where}


@dataclass
class ScanResult:
    counts: Counts
    findings: list[Finding] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return not self.findings

    def summary(self) -> str:
        return ", ".join(sorted({f"{f.kind} '{f.name}' in {f.where}" for f in self.findings}))


def scan(
    tel: TelemetryCapture,
    seeded: dict[str, str] | None = None,
    patterns: dict[str, re.Pattern[str]] | None = None,
) -> ScanResult:
    """Every seeded value and pattern class, over everything the capture exported."""
    seeded = SEEDED if seeded is None else seeded
    patterns = PATTERNS if patterns is None else patterns
    items, counts = exported_items(tel)
    findings: set[Finding] = set()
    for item in items:
        for label, value in seeded.items():
            if value and value in item.text:
                findings.add(Finding("seeded", label, item.where))
        for name, pattern in patterns.items():
            if pattern.search(item.text):
                findings.add(Finding("pattern", name, item.where))
    return ScanResult(counts, sorted(findings, key=lambda f: (f.kind, f.name, f.where)))
