"""
On-demand "Generate" endpoint for Cloop — see call-logs.py's own docstring
for the shared design (same GitHub-commit-if-a-home-exists-else-checklist-only
behaviour, same daily-routine-parity goal).

POST body (JSON):
  {
    "date": "2026-10-08",            # the day the Real-Time snapshot was taken
    "historicalDate": "2026-10-07",  # the day the two Historical reports cover
    "realtime": "<Real Time Metrics Report.csv text>",
    "queueHistorical": "<Historical Metrics Report (queue).csv text>",
    "agentHistorical": "<Historical Metrics Report (agent).csv text>"
  }

Total Cases to Date has no raw export (Cloop doesn't offer one — see
parse_cloop.py's own note) — same as the automated routine, this endpoint
leaves those fields out entirely rather than guessing; they're still only
ever entered by hand via the checklist's own "Enter Total Cases to Date" form.
"""
import json
import os
import sys
import tempfile
from http.server import BaseHTTPRequestHandler
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
import generate_lib as lib  # noqa: E402
import parse_cloop  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
OWNER = os.environ.get("GITHUB_OWNER", "AtifWan")
REPO = os.environ.get("GITHUB_REPO", "dailyreport")
BRANCH = os.environ.get("GITHUB_BRANCH", "claude/zip-component-analysis-0jm9or")


def write_temp(name, content):
    d = tempfile.mkdtemp(prefix="cloop-")
    p = Path(d) / name
    p.write_text(content, encoding="utf-8")
    return str(p)


def run(payload):
    date = payload["date"]
    historical_date = payload["historicalDate"]
    github_token = os.environ["GITHUB_TOKEN"]
    kv_url = os.environ["KV_REST_API_URL"]
    kv_token = os.environ["KV_REST_API_TOKEN"]

    realtime_path = write_temp("realtime.csv", payload["realtime"])
    queue_hist_path = write_temp("queue_historical.csv", payload["queueHistorical"])
    agent_hist_path = write_temp("agent_historical.csv", payload["agentHistorical"])

    manifest = lib.get_manifest(REPO_ROOT, OWNER, REPO, BRANCH, github_token)
    # Chained on historical_date, same as the daily routine's own --prev:
    # cloop.json's own trends are keyed to the period the Historical reports
    # cover, not the day the Real-Time snapshot was taken.
    prev_date, prev = lib.find_prev_committed(REPO_ROOT, OWNER, REPO, BRANCH, github_token, manifest, historical_date, "cloop.json")

    result, unmatched = parse_cloop.build_cloop(
        date, realtime_path, historical_date, queue_hist_path, agent_hist_path,
        prev=prev, known_staff_dir=str(REPO_ROOT / "assets/data/reports"),
    )
    result["_source"] = (
        "Real-Time + two Historical Metrics Reports from Cloop's own raw CSV exports, uploaded "
        "directly through the dashboard's Report checklist page and run via scripts/parse_cloop.py "
        "(the same logic the daily automated routine uses), rather than extracted from the PDF. "
        "Total Cases to Date has no raw export and is entered separately via the checklist's own form."
    )

    committed = lib.has_committed_date(REPO_ROOT, OWNER, REPO, BRANCH, github_token, historical_date)
    commit_info = None
    if committed:
        path = f"assets/data/reports/{historical_date}/cloop.json"
        body = json.dumps(result, ensure_ascii=False, indent=2)
        commit_info = lib.github_commit_file(
            OWNER, REPO, BRANCH, path, body,
            f"Generate cloop.json for {historical_date} from uploaded raw files", github_token,
        )

    checklist_patch = {"cloopDone": True, "cloopDate": historical_date}
    note_parts = []
    if not committed:
        note_parts.append(f"no home yet in the dashboard for {historical_date} (tasks/leave not committed yet)")
    if unmatched:
        note_parts.append(f"{len(unmatched)} agent email(s) unmatched: {', '.join(unmatched)}")
    if note_parts:
        checklist_patch["note"] = "Cloop parsed and verified from uploaded raw CSVs — " + "; ".join(note_parts) + "."
    checklist = lib.kv_update_checklist(checklist_patch, kv_url, kv_token)

    return {
        "ok": True,
        "date": date,
        "historicalDate": historical_date,
        "committed": committed,
        "commit": commit_info,
        "prevDateUsed": prev_date,
        "unmatchedAgentNames": unmatched,
        "realTimeSummary": result["realTimeSummary"],
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
