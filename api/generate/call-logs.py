"""
On-demand "Generate" endpoint: takes the raw Call Logs CSVs uploaded straight
through the dashboard, runs the exact same scripts/parse_call_logs.py logic
the daily automated routine uses, and — if assets/data/reports/<date>/ already
has tasks.json + leave.json committed (the PDF pipeline has a home for this
date) — commits the resulting call-logs.json straight to GitHub. Always
updates the Vercel KV checklist doc either way, same as the routine's own
relay. Runs alongside the daily OneDrive-based routine, not instead of it,
until this is proven out (see commit history for why).

POST body (JSON):
  {
    "date": "2026-10-07",
    "inbound": "<InboundCalls_Detailed.csv text>",
    "outbound": "<ExportCallRecords.csv text>",
    "queues": {"Appointments": "<csv text>", "General Enquiries": "<csv text>", ...}
  }
"""
import json
import os
import sys
import tempfile
from datetime import date as date_cls
from http.server import BaseHTTPRequestHandler
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
import generate_lib as lib  # noqa: E402
import parse_call_logs  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
OWNER = os.environ.get("GITHUB_OWNER", "AtifWan")
REPO = os.environ.get("GITHUB_REPO", "dailyreport")
BRANCH = os.environ.get("GITHUB_BRANCH", "claude/zip-component-analysis-0jm9or")


def ordinal_date_title(iso_date):
    """'2026-10-07' -> 'Daily Operations Report - 7th October 2026', matching
    this project's established reportTitle convention (there's no PDF for a
    manually-uploaded date to take the real title from)."""
    d = date_cls.fromisoformat(iso_date)
    day = d.day
    suffix = "th" if 11 <= day <= 13 else {1: "st", 2: "nd", 3: "rd"}.get(day % 10, "th")
    return f"Daily Operations Report - {day}{suffix} {d.strftime('%B %Y')}"


def write_temp(name, content):
    d = tempfile.mkdtemp(prefix="callogs-")
    p = Path(d) / name
    p.write_text(content, encoding="utf-8")
    return str(p)


def run(payload):
    date = payload["date"]
    github_token = os.environ["GITHUB_TOKEN"]
    kv_url = os.environ["KV_REST_API_URL"]
    kv_token = os.environ["KV_REST_API_TOKEN"]

    inbound_path = write_temp("inbound.csv", payload["inbound"])
    outbound_path = write_temp("outbound.csv", payload["outbound"])
    queue_files = {name: write_temp(f"queue-{i}.csv", text) for i, (name, text) in enumerate(payload["queues"].items())}

    manifest = lib.get_manifest(REPO_ROOT, OWNER, REPO, BRANCH, github_token)
    prev_date, prev = lib.find_prev_committed(REPO_ROOT, OWNER, REPO, BRANCH, github_token, manifest, date, "call-logs.json")

    result = parse_call_logs.build_call_logs(
        date, inbound_path, outbound_path, queue_files,
        prev=prev, known_staff_dir=str(REPO_ROOT / "assets/data/reports"),
    )
    result["_source"] = (
        "Deterministic parse of raw Telair PBX CSV exports, uploaded directly through the "
        "dashboard's Report checklist page and run via scripts/parse_call_logs.py (the same "
        "logic the daily automated routine uses), rather than extracted from the PDF."
    )
    result["reportTitle"] = ordinal_date_title(date)

    committed = lib.has_committed_date(REPO_ROOT, OWNER, REPO, BRANCH, github_token, date)
    commit_info = None
    if committed:
        path = f"assets/data/reports/{date}/call-logs.json"
        body = json.dumps(result, ensure_ascii=False, indent=2)
        commit_info = lib.github_commit_file(
            OWNER, REPO, BRANCH, path, body,
            f"Generate call-logs.json for {date} from uploaded raw files", github_token,
        )

    checklist_patch = {"callLogsDone": True, "callLogsDate": date}
    if not committed:
        checklist_patch["note"] = (
            f"Call logs for {date} parsed and verified from uploaded raw CSVs — no home yet in "
            f"the dashboard (tasks/leave not committed for this date yet)."
        )
    checklist = lib.kv_update_checklist(checklist_patch, kv_url, kv_token)

    return {
        "ok": True,
        "date": date,
        "committed": committed,
        "commit": commit_info,
        "prevDateUsed": prev_date,
        "summary": result["summary"],
        "checklist": checklist,
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
