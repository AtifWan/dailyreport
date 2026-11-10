"""
On-demand "Save this week's leave" endpoint: takes the typed weekly leave
grid from the Report Checklist page's Staff & Drs Leave form and commits
leave.json straight to GitHub. Unlike Call Logs/Cloop (which need a Python
CSV parser running somewhere), the grid is just typed data, so this can run
entirely on Vercel — no local server, nothing on anyone's own machine, no
ThreatLocker/file-approval dance.

Commits to BOTH the daily pipeline branch (so the daily automated routine's
own carry-forward/trend-chaining logic, which reads assets/data/reports/
off that branch, sees this date already has a leave.json "home") AND
directly to main (so the live site shows it immediately, without waiting
for the usual daily-branch -> main merge step). A failure on the main-branch
half is reported but doesn't undo the daily-branch commit, which is the
source of truth.

POST body (JSON):
  {
    "date": "2026-11-10",
    "groups": [
      {"group": "Doctor", "people": [{"name": "...", "site": null, "status": ["leave","available","available","available","available"]}]},
      {"group": "Staff", "people": [...]}
    ],
    "longTerm": [{"name": "...", "note": "...", "from": "YYYY-MM-DD", "to": "YYYY-MM-DD"}, ...]
  }
"""
import json
import os
import sys
from datetime import date as date_cls, timedelta
from http.server import BaseHTTPRequestHandler
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
import generate_lib as lib  # noqa: E402

OWNER = os.environ.get("GITHUB_OWNER", "AtifWan")
REPO = os.environ.get("GITHUB_REPO", "dailyreport")
DAILY_BRANCH = os.environ.get("GITHUB_BRANCH", "claude/zip-component-analysis-0jm9or")
MAIN_BRANCH = "main"

ALLOWED_STATUS = {"leave", "available", "public_holiday"}


def ordinal_date_title(iso_date):
    """'2026-11-10' -> 'Daily Operations Report - 10th November 2026' — matches
    this project's established reportTitle convention for a date with no
    source PDF to take the real title from."""
    d = date_cls.fromisoformat(iso_date)
    day = d.day
    suffix = "th" if 11 <= day <= 13 else {1: "st", 2: "nd", 3: "rd"}.get(day % 10, "th")
    return f"Daily Operations Report - {day}{suffix} {d.strftime('%B %Y')}"


def run(payload):
    date = payload["date"]
    groups = payload["groups"]
    long_term = payload.get("longTerm", [])
    github_token = os.environ["GITHUB_TOKEN"]

    d = date_cls.fromisoformat(date)

    for g in groups:
        for p in g.get("people", []):
            status = p.get("status")
            if not isinstance(status, list) or len(status) != 5 or any(s not in ALLOWED_STATUS for s in status):
                raise ValueError(f"bad_status_for: {p.get('name')!r}")

    week_start = d - timedelta(days=d.weekday())  # Monday
    week_end = week_start + timedelta(days=4)  # Friday

    result = {
        "_source": "Entered directly through the Report Checklist page's Staff & Drs Leave weekly grid, saved straight from the website — no screenshot or PDF for this date.",
        "reportTitle": ordinal_date_title(date),
        "reportDate": date,
        "weekStart": week_start.isoformat(),
        "weekEnd": week_end.isoformat(),
        "days": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        "groups": groups,
        "longTerm": long_term,
        "legend": [
            {"key": "leave", "label": "On Leave"},
            {"key": "available", "label": "Available"},
            {"key": "public_holiday", "label": "Public Holiday"},
        ],
    }
    body = json.dumps(result, ensure_ascii=False, indent=2)
    path = f"assets/data/reports/{date}/leave.json"
    message = f"Add leave.json for {date} (typed weekly grid, via website)"

    # The daily branch is the source of truth every other data file in this
    # project goes through — a failure here is a hard failure, not reported
    # as a partial success.
    daily_commit = lib.github_commit_file(OWNER, REPO, DAILY_BRANCH, path, body, message, github_token)

    main_commit, main_error = None, None
    try:
        main_commit = lib.github_commit_file(OWNER, REPO, MAIN_BRANCH, path, body, message, github_token)
    except Exception as e:  # noqa: BLE001 - the daily-branch commit above already succeeded; don't lose that
        main_error = str(e)

    return {
        "ok": True,
        "date": date,
        "relativePath": path,
        "weekStart": result["weekStart"],
        "weekEnd": result["weekEnd"],
        "dailyBranchCommit": daily_commit,
        "mainBranchCommit": main_commit,
        "mainBranchError": main_error,
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
        except Exception as e:  # noqa: BLE001 — always return JSON, never a raw 500 page
            status, body = 400, {"ok": False, "error": str(e)}

        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(body).encode())
