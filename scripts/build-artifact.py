#!/usr/bin/env python3
"""
Rebuild the single-file Claude Artifact bundle of the dashboard from the current
state of this repo. The published Artifact can't `fetch()` local files (it's a
sandboxed static page), so every report JSON under assets/data/reports/ gets
embedded inline as EMBEDDED_DATA, and every JS module gets concatenated (import/
export stripped) with fetchJSON patched to read EMBEDDED_DATA before falling
back to a real fetch(). This is a read-only pass over the repo — it never
writes into assets/, only to the --out path.

Usage:
    python3 scripts/build-artifact.py [--out PATH]

Then publish the resulting HTML file with the Artifact tool, targeting the
existing artifact's URL so it updates in place rather than creating a new one.

Run from anywhere; paths are resolved relative to this file's repo root.
"""
import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

JS_ORDER = [
    "assets/js/util.js",
    "assets/js/workdays.js",
    "assets/js/charts.js",
    "assets/js/calendarview.js",
    "assets/js/datepicker.js",
    "assets/js/pages/overview.js",
    "assets/js/pages/tasks.js",
    "assets/js/pages/call-logs.js",
    "assets/js/pages/cloop.js",
    "assets/js/pages/leave.js",
    "assets/js/pages/checklist.js",
    "assets/js/app.js",
]
DATA_FILES = ["overview", "tasks", "call-logs", "cloop", "leave"]


def read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


def build():
    # ---- 1. CSS ----
    css = read("design-system/css/styles.css") + "\n\n" + read("assets/css/app.css")

    # ---- 2. EMBEDDED_DATA ----
    data = {}
    manifest_path = "assets/data/reports/index.json"
    manifest = json.loads(read(manifest_path))
    data[manifest_path] = manifest

    for date in manifest["dates"]:
        for fname in DATA_FILES:
            rel = f"assets/data/reports/{date}/{fname}.json"
            if (ROOT / rel).exists():
                data[rel] = json.loads(read(rel))

    embedded_json = json.dumps(data, ensure_ascii=False, indent=2)
    print(f"Embedded {len(data)} JSON files, {len(manifest['dates'])} dates, {len(embedded_json)} chars")

    # ---- 3. JS bundle ----
    # Concatenating ES modules into one flat <script> (no module wrapping) means
    # every top-level const/let/function/class name must be unique across ALL of
    # JS_ORDER — two files can each validly declare the same name in real module
    # scope (e.g. two unrelated calendar widgets both naming a local MONTH_LABELS)
    # and still silently break this bundle: a duplicate top-level declaration is a
    # hard SyntaxError that aborts the entire script, which (since index.html's own
    # static markup already shows "Loading…" as a placeholder) looks exactly like
    # the page hanging forever rather than an obvious crash. Caught once already
    # (2026-10-07) only by chance; check for it on every build instead.
    decl_re = re.compile(r'^(?:export\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][A-Za-z0-9_$]*)')
    owners = {}
    js_parts = []
    for path in JS_ORDER:
        out_lines = []
        for line in read(path).split("\n"):
            if re.match(r'^\s*import\s', line):
                continue  # drop import lines entirely
            m = decl_re.match(line)
            if m:
                name = m.group(1)
                if name in owners:
                    raise SystemExit(
                        f"build-artifact.py: '{name}' is declared at top level in both "
                        f"{owners[name]} and {path} — fine as separate ES modules, but this "
                        f"bundler flattens them into one scope, so this is a SyntaxError "
                        f"once concatenated. Rename one of them before building."
                    )
                owners[name] = path
            out_lines.append(re.sub(r'^export\s+', '', line))
        js_parts.append(f"\n// ---- {path} ----\n" + "\n".join(out_lines))
    js_bundle = "\n".join(js_parts)

    # Patch fetchJSON to check EMBEDDED_DATA first
    js_bundle = js_bundle.replace(
        "async function fetchJSON(path) {\n  const res = await fetch(path);",
        "async function fetchJSON(path) {\n  if (EMBEDDED_DATA[path]) return JSON.parse(JSON.stringify(EMBEDDED_DATA[path]));\n  const res = await fetch(path);",
    )

    # ---- 4. App markup (body content, minus <script> tag) ----
    index_html = read("index.html")
    m = re.search(r'<body>\n(.*)\n<script', index_html, re.S)
    app_markup = m.group(1)

    # ---- 5. Assemble final artifact file ----
    return f"""<title>Daily Operations Report</title>
<style>
{css}
</style>

{app_markup}

<script>
const EMBEDDED_DATA = {embedded_json};

{js_bundle}
</script>
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="/tmp/dashboard-build/dashboard.html")
    args = parser.parse_args()

    final = build()
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(final, encoding="utf-8")
    print(f"Wrote {out_path}, {len(final)} chars, {len(final) / 1024:.1f} KB")


if __name__ == "__main__":
    main()
