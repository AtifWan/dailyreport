"""
On-demand "Generate today's report" endpoint, website-only version: takes
the raw Call Logs/Cloop CSV text the Report Checklist page has read straight
from the browser's file picker (no local upload server, nothing saved to
anyone's own machine), builds call-logs.json + cloop.json, carries forward
tasks.json and leave.json the same way the local script did, and commits all
of it straight to GitHub (the daily pipeline branch, and main so the live
site shows it immediately) — mirroring scripts/generate_report.py, but
sourcing files from the request body instead of local disk, and committing
via the GitHub API instead of writing to a folder.

The report's date is NEVER taken from "today" (the day someone clicks
Generate) or from a guessed/defaulted business day — it's read straight out
of the Call Logs' own InboundCalls_Detailed CSV (its CallDateTime column),
the one genuinely trustworthy source. Call Logs are typically uploaded a day
(or, after a weekend, several days) after the date they actually cover, so
"today" is routinely wrong; this showed up as a real bug (reports always
landing a day behind, or on the prior Friday after a weekend) before this
fix. Only Cloop's Real-Time snapshot date and Total Cases to Date's "today"
label are genuinely about today, so those are computed here from the
server's own clock, not trusted from the client either — the Historical
reports are overridden to the same date as Call Logs, since both describe
the same completed business day.

Still deliberately does NOT build overview.json or bump index.json's
"latest" — see generate_report.py's own docstring for why (needs a human
judgement call this button can't safely invent). It does add the date to
index.json's "dates" array on both branches, same as the local version, so
the new files are immediately reachable via the dashboard's own navigation.

POST body (JSON):
  {
    "callLogs": {
      "inbound": "<InboundCalls_Detailed.csv text>",
      "outbound": "<ExportCallRecords.csv text>",
      "queues": ["<CallQueue_Detailed.csv text>", ...]
    },
    "cloop": {
      "realtime": "<Real-Time Metrics Report.csv text>",
      "queueHistorical": "<Historical Metrics Report (queue).csv text>",
      "agentHistorical": "<Historical Metrics Report (agent).csv text>",
      "totalCasesToDate": {"totalOverallCases": 123, "totalInProgress": 45, "totalOpenCases": 6}
    }
  }
"""
import csv
import io
import json
import os
import sys
import tempfile
from datetime import date as date_cls, datetime
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
import generate_lib as lib  # noqa: E402
import parse_call_logs  # noqa: E402
import parse_cloop  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
OWNER = os.environ.get("GITHUB_OWNER", "AtifWan")
REPO = os.environ.get("GITHUB_REPO", "dailyreport")
DAILY_BRANCH = os.environ.get("GITHUB_BRANCH", "claude/zip-component-analysis-0jm9or")
MAIN_BRANCH = "main"
KNOWN_STAFF_DIR = str(REPO_ROOT / "assets" / "data" / "reports")

SYDNEY = ZoneInfo("Australia/Sydney")

_WEEKDAY_ABBR = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
_MONTH_ABBR = [None, "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
_WEEKDAY_FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
_MONTH_FULL = [None, "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]


class GenerateError(Exception):
    """A clear, user-facing reason generation can't proceed — never a raw traceback."""


def day_label(date_iso):
    d = date_cls.fromisoformat(date_iso)
    return f"{_WEEKDAY_ABBR[d.weekday()]} {d.day} {_MONTH_ABBR[d.month]}"


def full_date_label(iso_date):
    d = date_cls.fromisoformat(iso_date)
    return f"{_WEEKDAY_FULL[d.weekday()]} {d.day} {_MONTH_FULL[d.month]} {d.year}"


def ordinal_date_title(iso_date):
    d = date_cls.fromisoformat(iso_date)
    day = d.day
    suffix = "th" if 11 <= day <= 13 else {1: "st", 2: "nd", 3: "rd"}.get(day % 10, "th")
    return f"Daily Operations Report - {day}{suffix} {d.strftime('%B %Y')}"


def shift_list(prev_list, new_value):
    if prev_list is None:
        return [new_value] * 10
    return (prev_list + [new_value])[-10:]


def write_temp(name, content):
    d = tempfile.mkdtemp(prefix="generate-report-")
    p = Path(d) / name
    p.write_text(content, encoding="utf-8")
    return str(p)


def extract_call_logs_date(inbound_text):
    """The one trustworthy date for this whole report: InboundCalls_Detailed's
    own CallDateTime column, e.g. "10/11/2026 7:00:41 AM" (day/month/year,
    matching every other date field this project's raw PBX exports use — see
    scripts/parse_call_logs.py's own format_time). Deliberately NOT "today" —
    Call Logs are routinely uploaded a day, or after a weekend several days,
    after the date they actually cover."""
    rows = list(csv.DictReader(io.StringIO(inbound_text)))
    if not rows or not rows[0].get("CallDateTime"):
        raise GenerateError("Call Logs: couldn't read a date — the Inbound file has no CallDateTime column or no data rows.")
    date_part = rows[0]["CallDateTime"].split(" ", 1)[0]
    try:
        day, month, year = (int(x) for x in date_part.split("/"))
        return date_cls(year, month, day).isoformat()
    except Exception as e:  # noqa: BLE001
        raise GenerateError(f"Call Logs: couldn't read a date from the Inbound file's own CallDateTime column ({date_part!r}).") from e


def json_at(repo_root, token, branch, path):
    text = lib.read_local_or_github(repo_root, OWNER, REPO, branch, token, path)
    return json.loads(text) if text else None


def find_prev(token, branch, manifest, date, filename):
    candidates = sorted(d for d in manifest.get("dates", []) if d < date)
    for d in reversed(candidates):
        data = json_at(REPO_ROOT, token, branch, f"assets/data/reports/{d}/{filename}")
        if data:
            return d, data
    return None, None


def build_call_logs_json(date, call_logs, token, branch, manifest):
    inbound_text = call_logs.get("inbound")
    outbound_text = call_logs.get("outbound")
    queue_texts = call_logs.get("queues") or []
    missing = [n for n, v in [("Inbound", inbound_text), ("Outbound", outbound_text)] if not v]
    if not queue_texts:
        missing.append("Queue")
    if missing:
        raise GenerateError(f"Call Logs: missing {', '.join(missing)} file(s) for {date}")

    inbound_path = write_temp("inbound.csv", inbound_text)
    outbound_path = write_temp("outbound.csv", outbound_text)
    queue_paths = {}
    for i, text in enumerate(queue_texts):
        rows = list(csv.DictReader(io.StringIO(text)))
        queue_name = rows[0]["CallQueueName"].strip() if rows and "CallQueueName" in rows[0] else None
        if not queue_name:
            raise GenerateError(f"Call Logs: one of the Queue files doesn't look like a CallQueue_Detailed export (no CallQueueName column)")
        queue_paths[queue_name] = write_temp(f"queue-{i}.csv", text)

    prev_date, prev = find_prev(token, branch, manifest, date, "call-logs.json")
    result = parse_call_logs.build_call_logs(
        date, inbound_path, outbound_path, queue_paths,
        prev=prev, known_staff_dir=KNOWN_STAFF_DIR,
    )
    label = day_label(date)
    labels = shift_list((prev or {}).get("tenDayTrend", {}).get("labels"), label)
    result["tenDayTrend"]["labels"] = labels
    result["outboundTenDayTrend"]["labels"] = labels
    result["_source"] = (
        "Deterministic parse of raw Telair PBX CSV exports, uploaded directly through the "
        "dashboard's Report Checklist page and run via scripts/parse_call_logs.py"
        + (f", chained against assets/data/reports/{prev_date}/call-logs.json." if prev_date else ". No previous date to chain trends against.")
    )
    return result


def build_cloop_json(date, cloop, token, branch, manifest):
    realtime_date = cloop.get("realtimeDate")
    historical_date = cloop.get("historicalDate")
    if not realtime_date or not historical_date:
        raise GenerateError("Cloop: both dates (Real-Time snapshot date, Historical reports cover date) are required.")
    realtime_text = cloop.get("realtime")
    queue_hist_text = cloop.get("queueHistorical")
    agent_hist_text = cloop.get("agentHistorical")
    missing = [n for n, v in [("Real-Time", realtime_text), ("Historical (queue)", queue_hist_text), ("Historical (agent)", agent_hist_text)] if not v]
    if missing:
        raise GenerateError(f"Cloop: missing {', '.join(missing)} file(s) for {date}")
    total_cases = cloop.get("totalCasesToDate") or {}
    for key in ("totalOverallCases", "totalInProgress", "totalOpenCases"):
        if total_cases.get(key) is None:
            raise GenerateError("Cloop: Total Cases to Date is incomplete — fill in all three fields first.")

    realtime_path = write_temp("realtime.csv", realtime_text)
    queue_hist_path = write_temp("historical-queue.csv", queue_hist_text)
    agent_hist_path = write_temp("historical-agent.csv", agent_hist_text)

    prev_date, prev = find_prev(token, branch, manifest, historical_date, "cloop.json")
    result, unmatched = parse_cloop.build_cloop(
        realtime_date, realtime_path, historical_date, queue_hist_path, agent_hist_path,
        prev=prev, known_staff_dir=KNOWN_STAFF_DIR,
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
        "Real-Time + two Historical Metrics Reports from Cloop's own raw CSV exports, uploaded "
        "directly through the dashboard's Report Checklist page, via scripts/parse_cloop.py. "
        "Total Cases to Date has no raw export and was typed in directly on the checklist page."
    )
    result["reportTitle"] = ordinal_date_title(historical_date)

    now = datetime.now(SYDNEY)
    hour12 = now.hour % 12 or 12
    result["extractedAt"] = now.isoformat()
    result["extractedAtLabel"] = f"{hour12}:{now.minute:02d} {'AM' if now.hour < 12 else 'PM'}, {full_date_label(realtime_date)}"
    result["_extractedAtNote"] = (
        "No raw Cloop export carries its own exact extraction timestamp, and this file wasn't "
        "fetched via SharePoint. This is simply when the Report Checklist's Generate button was "
        "run, which may be later than when the files were actually exported from Cloop."
    )
    return result, unmatched


def build_tasks_json(date, token, branch, manifest):
    prev_date, prev = find_prev(token, branch, manifest, date, "tasks.json")
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


def build_leave_json(date, token, branch, manifest):
    existing = json_at(REPO_ROOT, token, branch, f"assets/data/reports/{date}/leave.json")
    if existing:
        return existing, "existing"

    prev_date, prev = find_prev(token, branch, manifest, date, "leave.json")
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
        f"{week_start}–{week_end}) — use the Staff & Drs Leave grid above to enter this "
        "week's leave first, then Generate again."
    )


def commit_to_both_branches(path, body, message, token):
    daily_commit = lib.github_commit_file(OWNER, REPO, DAILY_BRANCH, path, body, message, token)
    main_error = None
    try:
        lib.github_commit_file(OWNER, REPO, MAIN_BRANCH, path, body, message, token)
    except Exception as e:  # noqa: BLE001 - the daily-branch commit above already succeeded
        main_error = str(e)
    return daily_commit, main_error


def add_date_to_manifest(date, token):
    """Mirrors generate_report.py's own index.json behaviour: adds the date
    to "dates" (sorted, no duplicate) on BOTH branches independently, never
    touching "latest" — each branch's own current index.json is read fresh
    rather than assuming the two are identical."""
    main_errors = []
    for branch in (DAILY_BRANCH, MAIN_BRANCH):
        manifest = json_at(REPO_ROOT, token, branch, "assets/data/reports/index.json") or {"dates": [], "latest": None}
        if date in manifest.get("dates", []):
            continue
        manifest["dates"] = sorted(set(manifest.get("dates", [])) | {date})
        body = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
        try:
            lib.github_commit_file(OWNER, REPO, branch, "assets/data/reports/index.json", body, f"Add {date} to index.json's dates ({branch})", token)
        except Exception as e:  # noqa: BLE001
            main_errors.append(f"{branch}: {e}")
    return main_errors


def run(payload):
    github_token = os.environ["GITHUB_TOKEN"]
    call_logs_payload = payload.get("callLogs") or {}
    if not call_logs_payload.get("inbound"):
        raise GenerateError("Call Logs: missing Inbound file(s) — needed to read this report's date, not just to build call-logs.json.")
    date = extract_call_logs_date(call_logs_payload["inbound"])

    # Cloop's Historical reports describe the same completed business day as
    # Call Logs — always this date, never a client-supplied or guessed one.
    # Its Real-Time snapshot and Total Cases to Date genuinely are "today",
    # read from this server's own clock rather than trusting the browser's.
    cloop_payload = dict(payload.get("cloop") or {})
    cloop_payload["historicalDate"] = date
    cloop_payload["realtimeDate"] = datetime.now(SYDNEY).strftime("%Y-%m-%d")

    manifest = lib.get_manifest(REPO_ROOT, OWNER, REPO, DAILY_BRANCH, github_token)

    call_logs_json = build_call_logs_json(date, call_logs_payload, github_token, DAILY_BRANCH, manifest)
    cloop_json, unmatched_agents = build_cloop_json(date, cloop_payload, github_token, DAILY_BRANCH, manifest)
    tasks_json = build_tasks_json(date, github_token, DAILY_BRANCH, manifest)
    leave_json, leave_mode = build_leave_json(date, github_token, DAILY_BRANCH, manifest)

    written = {}
    main_errors = []
    for name, data, mode_skip in [
        ("call-logs.json", call_logs_json, False), ("cloop.json", cloop_json, False),
        ("tasks.json", tasks_json, False), ("leave.json", leave_json, leave_mode == "existing"),
    ]:
        path = f"assets/data/reports/{date}/{name}"
        if mode_skip:
            written[name] = f"{path} (already existed — not re-written)"
            continue
        body = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
        _, main_error = commit_to_both_branches(path, body, f"Add {name} for {date} (via website Generate)", github_token)
        if main_error:
            main_errors.append(f"{name}: {main_error}")
        written[name] = path

    manifest_errors = add_date_to_manifest(date, github_token)
    if manifest_errors:
        main_errors.extend(manifest_errors)
    else:
        written["index.json"] = "assets/data/reports/index.json (added this date only — \"latest\" left unchanged)"

    return {
        "ok": True,
        "date": date,
        "written": written,
        "leaveMode": leave_mode,
        "unmatchedAgentNames": unmatched_agents,
        "mainBranchErrors": main_errors or None,
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


class handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            result = run(payload)
            status, body = 200, result
        except GenerateError as e:
            status, body = 422, {"ok": False, "error": str(e)}
        except Exception as e:  # noqa: BLE001 — always return JSON, never a raw 500 page
            status, body = 400, {"ok": False, "error": str(e)}

        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(body).encode())
