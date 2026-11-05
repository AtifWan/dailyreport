#!/usr/bin/env python3
"""
Builds one date's call-logs.json, cloop.json, tasks.json and leave.json from
the raw files already saved locally by scripts/upload_server.py's "Upload
today's files" section, plus the Cloop dates and Total Cases to Date numbers
the Report Checklist page tracks for that day. Writes straight into
assets/data/reports/<date>/ — never commits anything to git, never updates
index.json, and never writes overview.json.

Why no overview.json: every overview.json committed this season has needed a
real judgement call (which anomaly is worth flagging, how to phrase a
discrepancy) — a script can't safely invent that without risking exactly the
kind of fabricated claim this project's standing data-integrity rule warns
against. Same reasoning as why Staff and Drs Leaves screenshots are read by
Claude rather than OCR'd. So Generate hands back the four files it CAN
produce deterministically, and says plainly that overview.json (and then
index.json, once overview.json exists) still need a short follow-up.

Deterministic numbers only: reuses parse_call_logs.build_call_logs() and
parse_cloop.build_cloop() exactly as the daily automated routine (and the
now-removed "Generate from raw files" panel) did, so there's one
implementation of the actual math. The one thing this module adds on top of
those two functions is the "labels" arrays each trend chart needs — the
parser scripts don't produce these themselves; every date committed by hand
this season added them as a separate step too.

Narrative fields (every key starting with "_", e.g. "_summaryVsGrandTotalNote")
are intentionally left out of the generated files. Per PHASE-2.md, "The
`_source` field in each file is a comment for humans, not read by the app" —
true of every underscore-prefixed field, so the dashboard renders correctly
without them. A short, honest "_source" noting how the file was produced is
still included; the richer per-call anomaly narrative seen in hand-built
dates is not fabricated here and can be added afterward if wanted.

Which physical file to use for each slot (Outbound, Inbound, each Cloop
file, ...) is NOT re-guessed from what's sitting in Call Logs/ or Cloop/ —
several physical files can exist there for one slot if a wrong upload was
later replaced (see checklist.js's own replace-on-reupload behaviour for
singular slots), and only the browser's own up-to-date readiness tracking
actually knows which one is current. So the caller (the Report Checklist
page) passes the exact {subtypeKey, savedAs} pairs it currently considers
ready; this module resolves those to paths rather than scanning and
reclassifying the folder itself.

One exception to "never touches index.json": this DOES add the new date to
the manifest's "dates" array (sorted insert, never a duplicate) so the
generated files are immediately reachable through the dashboard's own
navigation (#/call-logs/<date>, #/cloop/<date>, ...) for a real preview —
the whole point of Step 4. It deliberately leaves "latest" untouched, since
this date isn't the reviewed, production-ready "current" report yet
(overview.json doesn't exist for it, and nothing here has been committed or
pushed) — exactly the same distinction the manifest already draws between
"a report that exists" and "the one considered current". A date added this
way that falls in a later calendar month than "latest" won't be reachable
via the in-page month-picker's forward button (it's bounded by
manifest.latest's month), but the direct #/<route>/<date> link always works
regardless.
"""
import csv
import json
import sys
from datetime import date as date_cls, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
import parse_call_logs  # noqa: E402
import parse_cloop  # noqa: E402

CALL_LOGS_FOLDER = REPO_ROOT / "Call Logs"
CLOOP_FOLDER = REPO_ROOT / "Cloop"
REPORTS_DIR = REPO_ROOT / "assets" / "data" / "reports"

SYDNEY = ZoneInfo("Australia/Sydney")

_WEEKDAY_ABBR = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
_MONTH_ABBR = [None, "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
_WEEKDAY_FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
_MONTH_FULL = [None, "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]


class GenerateError(Exception):
    """A clear, user-facing reason generation can't proceed — never a raw
    traceback. Always caught and returned as {"ok": False, "error": ...}."""


def day_label(date_iso):
    """'2026-11-05' -> 'Wed 5 Nov' — this project's established trend-chart
    label format (see any committed tenDayTrend.labels)."""
    d = date_cls.fromisoformat(date_iso)
    return f"{_WEEKDAY_ABBR[d.weekday()]} {d.day} {_MONTH_ABBR[d.month]}"


def full_date_label(iso_date):
    """'2026-11-05' -> 'Thursday 5 November 2026' — matches extractedAtLabel's
    established date portion in every committed cloop.json."""
    d = date_cls.fromisoformat(iso_date)
    return f"{_WEEKDAY_FULL[d.weekday()]} {d.day} {_MONTH_FULL[d.month]} {d.year}"


def ordinal_date_title(iso_date):
    """'2026-11-05' -> 'Daily Operations Report - 5th November 2026' — matches
    this project's established reportTitle convention for a date with no
    source PDF to take the real title from (same helper api/generate/*.py
    used to carry)."""
    d = date_cls.fromisoformat(iso_date)
    day = d.day
    suffix = "th" if 11 <= day <= 13 else {1: "st", 2: "nd", 3: "rd"}.get(day % 10, "th")
    return f"Daily Operations Report - {day}{suffix} {d.strftime('%B %Y')}"


def shift_list(prev_list, new_value):
    """Drop the oldest point, append the new one — the rolling-10 convention
    every committed trend array already follows (same as parse_call_logs.py's
    and parse_cloop.py's own shift_trend)."""
    if prev_list is None:
        return [new_value] * 10
    return (prev_list + [new_value])[-10:]


def read_json(path):
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return None


def read_manifest():
    data = read_json(REPORTS_DIR / "index.json")
    return data if data else {"dates": [], "latest": None}


def find_prev(manifest, date, filename):
    """The latest date strictly before `date` in the manifest whose own
    <date>/<filename> exists — mirrors generate_lib.find_prev_committed's own
    convention (chain from the most recent actual file, not just the
    immediately-preceding calendar date)."""
    candidates = sorted(d for d in manifest.get("dates", []) if d < date)
    for d in reversed(candidates):
        data = read_json(REPORTS_DIR / d / filename)
        if data:
            return d, data
    return None, None


def _resolve_path(folder, saved_as):
    path = folder / saved_as
    if not path.exists():
        raise GenerateError(f"Expected file not found on disk: {path.relative_to(REPO_ROOT)} — try re-uploading it.")
    return path


def resolve_call_logs_files(entries):
    """entries: [{subtypeKey, savedAs}, ...] — exactly what the checklist
    page's own readiness tracking currently considers valid for today (see
    this module's own docstring for why that, not a folder scan)."""
    inbound = outbound = None
    queue_paths = {}
    for e in entries:
        path = _resolve_path(CALL_LOGS_FOLDER, e["savedAs"])
        if e["subtypeKey"] == "inbound":
            inbound = path
        elif e["subtypeKey"] == "outbound":
            outbound = path
        elif e["subtypeKey"] == "queue":
            with open(path, newline="", encoding="utf-8-sig") as f:
                rows = list(csv.DictReader(f))
            queue_name = rows[0]["CallQueueName"].strip() if rows else None
            if queue_name:
                queue_paths[queue_name] = path
    return inbound, outbound, queue_paths


def resolve_cloop_files(entries):
    by_key = {}
    for e in entries:
        by_key[e["subtypeKey"]] = _resolve_path(CLOOP_FOLDER, e["savedAs"])
    return by_key.get("realtime"), by_key.get("queueHistorical"), by_key.get("agentHistorical")


def build_call_logs_json(date, entries, manifest):
    inbound, outbound, queue_paths = resolve_call_logs_files(entries)
    if not inbound or not outbound or not queue_paths:
        missing = [n for n, v in [("Inbound", inbound), ("Outbound", outbound)] if not v]
        if not queue_paths:
            missing.append("Queue")
        raise GenerateError(f"Call Logs: missing {', '.join(missing)} file(s) for {date}")

    prev_date, prev = find_prev(manifest, date, "call-logs.json")
    result = parse_call_logs.build_call_logs(
        date, str(inbound), str(outbound), {name: str(p) for name, p in queue_paths.items()},
        prev=prev, known_staff_dir=str(REPORTS_DIR),
    )
    label = day_label(date)
    labels = shift_list((prev or {}).get("tenDayTrend", {}).get("labels"), label)
    result["tenDayTrend"]["labels"] = labels
    result["outboundTenDayTrend"]["labels"] = labels
    result["_source"] = (
        "Deterministic parse of raw Telair PBX CSV exports (saved via the Report Checklist's "
        "local upload section) via scripts/parse_call_logs.py"
        + (f", chained against assets/data/reports/{prev_date}/call-logs.json." if prev_date else ". No previous date to chain trends against.")
    )
    return result


def build_cloop_json(date, entries, manifest, realtime_date, historical_date, total_cases):
    if not realtime_date or not historical_date:
        raise GenerateError("Cloop: both dates (Real-Time snapshot date, Historical reports cover date) are required.")
    realtime, queue_hist, agent_hist = resolve_cloop_files(entries)
    missing = [n for n, v in [("Real-Time", realtime), ("Historical (queue)", queue_hist), ("Historical (agent)", agent_hist)] if not v]
    if missing:
        raise GenerateError(f"Cloop: missing {', '.join(missing)} file(s) for {date}")
    for key in ("totalOverallCases", "totalInProgress", "totalOpenCases"):
        if total_cases.get(key) is None:
            raise GenerateError("Cloop: Total Cases to Date is incomplete — fill in all three fields first.")

    prev_date, prev = find_prev(manifest, historical_date, "cloop.json")
    result, unmatched = parse_cloop.build_cloop(
        realtime_date, str(realtime), historical_date, str(queue_hist), str(agent_hist),
        prev=prev, known_staff_dir=str(REPORTS_DIR),
    )
    hist_label = day_label(historical_date)
    extraction_label = day_label(realtime_date)
    result["contactsQueuedTenDayTrend"]["labels"] = shift_list(
        (prev or {}).get("contactsQueuedTenDayTrend", {}).get("labels"), hist_label,
    )

    overall, in_progress, open_cases = (int(total_cases[k]) for k in ("totalOverallCases", "totalInProgress", "totalOpenCases"))
    result["totalCasesToDate"] = {"date": historical_date, "totalOverallCases": overall, "totalInProgress": in_progress, "totalOpenCases": open_cases}
    result["inProgressTenDayTrend"] = {
        "labels": shift_list((prev or {}).get("inProgressTenDayTrend", {}).get("labels"), extraction_label),
        "totals": shift_list((prev or {}).get("inProgressTenDayTrend", {}).get("totals"), in_progress),
    }
    result["openCasesTenDayTrend"] = {
        "labels": shift_list((prev or {}).get("openCasesTenDayTrend", {}).get("labels"), extraction_label),
        "totals": shift_list((prev or {}).get("openCasesTenDayTrend", {}).get("totals"), open_cases),
    }
    result["_source"] = (
        "Real-Time + two Historical Metrics Reports from Cloop's own raw CSV exports (saved via "
        "the Report Checklist's local upload section) via scripts/parse_cloop.py. Total Cases to "
        "Date has no raw export and was typed in directly on the checklist page."
    )
    result["reportTitle"] = ordinal_date_title(historical_date)

    # cloop.js's own KPI card reads extractedAtLabel directly with no fallback
    # (see "extracted ${d.extractedAtLabel}"), so this can't be left out. Every
    # previous date derived it by hand from each raw CSV's own embedded
    # generation metadata — real archaeology this module doesn't attempt here.
    # Using "when Generate was run" instead is honest about what it actually
    # is, rather than fabricating a precise export time this button can't see.
    now = datetime.now(SYDNEY)
    hour12 = now.hour % 12 or 12
    result["extractedAt"] = now.isoformat()
    result["extractedAtLabel"] = f"{hour12}:{now.minute:02d} {'AM' if now.hour < 12 else 'PM'}, {full_date_label(realtime_date)}"
    result["_extractedAtNote"] = (
        "No raw Cloop export carries its own exact extraction timestamp, and this file wasn't "
        "fetched via SharePoint. Earlier dates' extractedAt was inferred by hand from each raw "
        "CSV's own embedded generation metadata; this one is simply when the Report Checklist's "
        "Generate button was run, which may be later than when the files were actually exported "
        "from Cloop."
    )
    return result, unmatched


def build_tasks_json(date, manifest):
    prev_date, prev = find_prev(manifest, date, "tasks.json")
    if not prev:
        raise GenerateError(f"Tasks: no earlier tasks.json to carry forward — {date} needs a first one built by hand.")
    result = json.loads(json.dumps(prev))
    result["reportDate"] = date
    result["reportTitle"] = ordinal_date_title(date)
    result["trendDates"] = shift_list(prev.get("trendDates"), day_label(date))
    for checklist in result.get("checklists", []):
        if "trend" in checklist:
            checklist["trend"] = shift_list(checklist["trend"], checklist.get("completionPct"))
    result["_source"] = (
        f"No source PDF for this date — carried forward from assets/data/reports/{prev_date}/tasks.json "
        "by the Report Checklist's Generate button, per this project's standing carry-forward "
        "convention. Trend windows slide forward to end on this date; streak/checklist values "
        "themselves are unchanged."
    )
    return result


def build_leave_json(date, manifest):
    existing = read_json(REPORTS_DIR / date / "leave.json")
    if existing:
        return existing, "existing"

    prev_date, prev = find_prev(manifest, date, "leave.json")
    if not prev:
        raise GenerateError(f"Leave: no earlier leave.json to carry forward, and none exists yet for {date}.")

    week_start, week_end = prev.get("weekStart"), prev.get("weekEnd")
    if week_start and week_end and week_start <= date <= week_end:
        result = json.loads(json.dumps(prev))
        result["reportDate"] = date
        result["reportTitle"] = ordinal_date_title(date)
        result["_source"] = (
            f"Carried forward from assets/data/reports/{prev_date}/leave.json by the Report "
            "Checklist's Generate button — same working week, only reportDate/reportTitle updated."
        )
        return result, "carried-forward"

    raise GenerateError(
        f"Leave: {date} looks like a new working week (most recent leave.json covers "
        f"{week_start}–{week_end}) — ask Claude to build this week's leave.json from the "
        'screenshots in "Staff and Drs Leaves/" first, then Generate again.'
    )


def generate(date, call_logs_entries, cloop_entries, cloop_dates, total_cases):
    manifest = read_manifest()

    call_logs_json = build_call_logs_json(date, call_logs_entries, manifest)
    cloop_json, unmatched_agents = build_cloop_json(
        date, cloop_entries, manifest, cloop_dates.get("realtimeDate"), cloop_dates.get("historicalDate"), total_cases,
    )
    tasks_json = build_tasks_json(date, manifest)
    leave_json, leave_mode = build_leave_json(date, manifest)

    out_dir = REPORTS_DIR / date
    out_dir.mkdir(parents=True, exist_ok=True)
    written = {}
    for name, data in [
        ("call-logs.json", call_logs_json), ("cloop.json", cloop_json),
        ("tasks.json", tasks_json), ("leave.json", leave_json),
    ]:
        path = out_dir / name
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        written[name] = str(path.relative_to(REPO_ROOT))

    manifest_path = REPORTS_DIR / "index.json"
    if date not in manifest["dates"]:
        manifest["dates"] = sorted(set(manifest["dates"]) | {date})
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        written["index.json"] = str(manifest_path.relative_to(REPO_ROOT)) + " (added this date only — \"latest\" left unchanged)"

    return {
        "ok": True,
        "date": date,
        "written": written,
        "leaveMode": leave_mode,
        "unmatchedAgentNames": unmatched_agents,
        "summary": {
            "callLogsSummary": call_logs_json["summary"],
            "cloopRealTimeSummary": cloop_json["realTimeSummary"],
            "totalCasesToDate": cloop_json["totalCasesToDate"],
        },
        "stillNeeded": [
            "overview.json — needs a quick read-through with Claude (it draws on judgement, e.g. flagging anomalies, that this button can't safely invent). The Overview page for this date won't work until it's added.",
            "Once overview.json is ready, this date can be set as assets/data/reports/index.json's \"latest\" (it's already in \"dates\" so other pages can be previewed now).",
        ],
    }
