#!/usr/bin/env python3
"""
Scan assets/data/source-pdfs/ for report PDFs the user has dropped in, work out
each one's report date and version (long/full vs. short) from its own title text
— never its filename — and report what's pending.

This does NOT extract the report's data (streaks, call volumes, etc.) — that
step still needs a human/Claude to read and verify the numbers, the same way
the 8 September 2026 report was done. What this script automates is the
bookkeeping that used to require the user to organise files themselves: which
PDFs pair up into a single report date, which dates are already in the
manifest (assets/data/reports/index.json) and can be skipped, and which are
new and need extracting.

Usage:
    python3 scripts/detect_reports.py

Run from anywhere; paths are resolved relative to this file's repo root.
"""
import json
import re
import sys
from pathlib import Path

try:
    import pdfplumber
except ImportError:
    print("pdfplumber is required: pip install pdfplumber", file=sys.stderr)
    sys.exit(1)

ROOT = Path(__file__).resolve().parent.parent
INBOX = ROOT / "assets/data/source-pdfs"
REPORTS_DIR = ROOT / "assets/data/reports"
MANIFEST = REPORTS_DIR / "index.json"

MONTHS = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
}

# Matches the title's date phrase, e.g. "8th September 2026" — day-ordinal, full
# month name, four-digit year — same form the "YYYY-MM-DD" folder name comes from.
DATE_PHRASE_RE = re.compile(
    r"(\d{1,2})(?:st|nd|rd|th)\s+(" + "|".join(MONTHS) + r")\s+(\d{4})",
    re.IGNORECASE,
)
TITLE_RE = re.compile(r"Daily Operations Report\s*-\s*(.+)", re.IGNORECASE)


def parse_title(text):
    """Return (iso_date, is_short) from a PDF's first-page text, or None if the
    title doesn't match the expected "Daily Operations Report - ..." pattern."""
    m = TITLE_RE.search(text)
    if not m:
        return None
    rest = m.group(1)
    is_short = bool(re.search(r"\(\s*short\s*version\s*\)", rest, re.IGNORECASE))
    date_m = DATE_PHRASE_RE.search(rest)
    if not date_m:
        return None
    day, month_name, year = date_m.groups()
    month = MONTHS[month_name.lower()]
    iso = f"{int(year):04d}-{month:02d}-{int(day):02d}"
    return iso, is_short


def first_page_text(pdf_path):
    with pdfplumber.open(pdf_path) as pdf:
        return pdf.pages[0].extract_text() or ""


def load_manifest():
    if not MANIFEST.exists():
        return {"dates": [], "latest": None}
    return json.loads(MANIFEST.read_text())


def main():
    if not INBOX.exists():
        print(f"No inbox folder at {INBOX}")
        return

    pdfs = sorted(p for p in INBOX.glob("*.pdf") if p.is_file())
    if not pdfs:
        print(f"No PDFs waiting in {INBOX} (drop the long + short version pair in there).")
        return

    manifest = load_manifest()
    known_dates = set(manifest.get("dates", []))

    # date -> {"long": Path|None, "short": Path|None}
    groups = {}
    unrecognized = []

    for pdf_path in pdfs:
        try:
            text = first_page_text(pdf_path)
        except Exception as e:
            unrecognized.append((pdf_path, f"couldn't read PDF: {e}"))
            continue
        parsed = parse_title(text)
        if not parsed:
            unrecognized.append((pdf_path, "title doesn't match \"Daily Operations Report - [date]\""))
            continue
        iso, is_short = parsed
        slot = groups.setdefault(iso, {"long": None, "short": None})
        key = "short" if is_short else "long"
        if slot[key] is not None:
            unrecognized.append((pdf_path, f"duplicate {key} version for {iso} (already have {slot[key].name})"))
            continue
        slot[key] = pdf_path

    print(f"Scanned {len(pdfs)} PDF(s) in {INBOX.relative_to(ROOT)}\n")

    if not groups and not unrecognized:
        return

    for iso in sorted(groups):
        slot = groups[iso]
        already_done = iso in known_dates
        status = "ALREADY IN MANIFEST — skip" if already_done else (
            "READY — both versions present, extract this one"
            if slot["long"] and slot["short"]
            else "INCOMPLETE — missing " + ("short version" if slot["long"] else "long/full version")
        )
        print(f"{iso}  [{status}]")
        print(f"    long/full : {slot['long'].name if slot['long'] else '(missing)'}")
        print(f"    short     : {slot['short'].name if slot['short'] else '(missing)'}")

    if unrecognized:
        print("\nCouldn't classify:")
        for path, reason in unrecognized:
            print(f"    {path.name} — {reason}")

    pending = [iso for iso in groups if iso not in known_dates and groups[iso]["long"] and groups[iso]["short"]]
    if pending:
        print(f"\n{len(pending)} report date(s) ready to extract: {', '.join(sorted(pending))}")
        print("Ask Claude to process these — it will read both PDFs, verify the figures, write")
        print(f"assets/data/reports/<date>/*.json, update {MANIFEST.relative_to(ROOT)}, and move")
        print(f"the source PDFs into {INBOX.relative_to(ROOT)}/processed/.")


if __name__ == "__main__":
    main()
