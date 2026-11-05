#!/usr/bin/env python3
"""
Local-only file intake server for the Report Checklist tab's "Upload today's
files" section, plus its "Generate today's report" button.

Why this exists: a browser page can't write to arbitrary folders on disk by
itself. This tiny, dependency-free HTTP server runs on the same machine as
the person using the dashboard; the checklist page POSTs each uploaded file
to it, and this script does the actual write — straight to a folder inside
this repo, never to any outside service. The same server also exposes
/generate, which builds that day's call-logs.json/cloop.json/tasks.json/
leave.json from those saved files (see scripts/generate_report.py for the
actual logic). Nothing here talks to GitHub, Vercel, or any other network
destination; it only listens on 127.0.0.1.

Usage:
    python3 scripts/upload_server.py [--port 8787]

Then open the dashboard as usual (python3 -m http.server 8000) and use the
Report Checklist tab's upload section. Leave this running in a second
terminal the whole time you're uploading.

Folder mapping (created automatically, relative to the repo root):
    call-logs -> "Call Logs/"
    cloop     -> "Cloop/"
    leave     -> "Staff and Drs Leaves/"

Storage rule: every saved file is named "<upload-date>_<original filename>",
upload-date being today's date in the Australia/Sydney timezone (this
project's standing timezone rule — see README.md — never the server
process's own local/system timezone, which may not be Sydney). Nothing is
ever overwritten: a same-day re-upload of the same original filename gets
" (1)", " (2)", etc. appended before the extension.
"""
import argparse
import json
import re
import sys
import traceback
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from zoneinfo import ZoneInfo

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
import generate_report  # noqa: E402

SYDNEY = ZoneInfo("Australia/Sydney")

CATEGORY_FOLDERS = {
    "call-logs": "Call Logs",
    "cloop": "Cloop",
    "leave": "Staff and Drs Leaves",
}

# Windows/macOS/Linux all reject these in filenames; strip defensively since
# the original filename comes from the browser (the user's own machine, but
# still worth not trusting blindly).
_UNSAFE_CHARS = re.compile(r'[\\/:*?"<>|]')


def today_sydney_iso():
    return datetime.now(SYDNEY).strftime("%Y-%m-%d")


def safe_original_name(name):
    name = Path(name).name  # drop any path components the client sent
    name = _UNSAFE_CHARS.sub("_", name).strip()
    return name or "upload"


def unique_destination(folder, stamped_name):
    """stamped_name already has the date prefix. If it exists, insert
    ' (1)', ' (2)', ... before the extension until a free name is found —
    never overwrite, never skip the upload."""
    candidate = folder / stamped_name
    if not candidate.exists():
        return candidate
    stem, suffix = Path(stamped_name).stem, Path(stamped_name).suffix
    n = 1
    while True:
        candidate = folder / f"{stem} ({n}){suffix}"
        if not candidate.exists():
            return candidate
        n += 1


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f"[upload-server] {self.address_string()} - {fmt % args}")

    def _cors(self):
        # Local-only server (binds 127.0.0.1), reachable only from this
        # machine — wildcard origin is fine, same reasoning as api/_lib/cors.js.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, status, body):
        payload = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            return self._json(200, {"ok": True})
        return self._json(404, {"ok": False, "error": "not_found"})

    def do_POST(self):
        if self.path == "/upload":
            return self._handle_upload()
        if self.path == "/generate":
            return self._handle_generate()
        return self._json(404, {"ok": False, "error": "not_found"})

    def _handle_upload(self):
        length = int(self.headers.get("Content-Length", 0))
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            category = payload["category"]
            filename = payload["filename"]
            content_b64 = payload["contentBase64"]
        except Exception as e:  # noqa: BLE001 - always return JSON, never crash the server
            return self._json(400, {"ok": False, "error": f"bad_request: {e}"})

        if category not in CATEGORY_FOLDERS:
            return self._json(400, {"ok": False, "error": f"unknown_category: {category}"})

        import base64
        try:
            raw = base64.b64decode(content_b64)
        except Exception as e:  # noqa: BLE001
            return self._json(400, {"ok": False, "error": f"bad_content: {e}"})

        folder_name = CATEGORY_FOLDERS[category]
        folder = REPO_ROOT / folder_name
        folder.mkdir(parents=True, exist_ok=True)

        date_prefix = today_sydney_iso()
        stamped_name = f"{date_prefix}_{safe_original_name(filename)}"
        dest = unique_destination(folder, stamped_name)
        dest.write_bytes(raw)

        print(f"[upload-server] saved {dest.relative_to(REPO_ROOT)} ({len(raw)} bytes)")
        return self._json(200, {
            "ok": True,
            "savedAs": dest.name,
            "folder": folder_name,
            "relativePath": str(dest.relative_to(REPO_ROOT)),
        })

    def _handle_generate(self):
        length = int(self.headers.get("Content-Length", 0))
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            date = payload["date"]
        except Exception as e:  # noqa: BLE001
            return self._json(400, {"ok": False, "error": f"bad_request: {e}"})

        try:
            result = generate_report.generate(
                date,
                payload.get("callLogsFiles", []),
                payload.get("cloopFiles", []),
                payload.get("cloopDates", {}),
                payload.get("totalCasesToDate", {}),
            )
            print(f"[upload-server] generated report for {date}: {sorted(result['written'])}")
            return self._json(200, result)
        except generate_report.GenerateError as e:
            return self._json(422, {"ok": False, "error": str(e)})
        except Exception as e:  # noqa: BLE001 - never crash the server on a bad report day
            traceback.print_exc()
            return self._json(500, {"ok": False, "error": f"unexpected_error: {e}"})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8787)
    args = parser.parse_args()

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"Upload server listening on http://127.0.0.1:{args.port} (local only)")
    print(f"Saving into: {REPO_ROOT}/Call Logs/, {REPO_ROOT}/Cloop/, {REPO_ROOT}/Staff and Drs Leaves/")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping.")


if __name__ == "__main__":
    main()
