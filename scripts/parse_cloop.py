#!/usr/bin/env python3
"""
Deterministically compute a date's cloop.json body from the raw Cloop CSV
exports (Real-Time Metrics, and the two Historical Metrics reports — queue
and agent) instead of extracting the numbers from the rendered PDF's text.

"Total Cases to Date" (Total Overall/In Progress/Open Cases) has no raw
export at all — Cloop doesn't offer one — so it is intentionally left out
here; it's entered by hand through the dashboard's Report Checklist page
instead and merged in separately at commit time.

Usage:
    python3 -I scripts/parse_cloop.py \
        --date 2026-10-07 \
        --realtime "Real Time Metrics Report.csv" \
        --historical-date 2026-10-06 \
        --queue-historical "Historical Metrics Report (queue).csv" \
        --agent-historical "Historical Metrics Report (agent).csv" \
        [--prev assets/data/reports/2026-10-02/cloop.json] \
        [--out assets/data/reports/2026-10-07/cloop.json]

--date is the day the Real-Time snapshot was taken (today, in the live
pipeline). --historical-date is the day the two Historical reports cover —
Cloop always reports on the most recently completed BUSINESS day, so this
is "yesterday" most days but a preceding Friday after a weekend or holiday;
pass it explicitly rather than guessing from the filename, which only
carries an export timestamp, not the period the data covers.
"""
import argparse
import csv
import glob
import json
from pathlib import Path


def load_known_staff(reports_dir):
    names = set()
    for path in glob.glob(f"{reports_dir}/*/call-logs.json"):
        try:
            d = json.loads(Path(path).read_text())
        except (OSError, json.JSONDecodeError):
            continue
        for key in ("inboundByStaff", "outboundByStaff"):
            for row in d.get(key, []):
                names.add(row["name"].strip())
    for path in glob.glob(f"{reports_dir}/*/cloop.json"):
        try:
            d = json.loads(Path(path).read_text())
        except (OSError, json.JSONDecodeError):
            continue
        for row in d.get("emailsHandledYesterday", []):
            names.add(row["agent"].strip())
    return names


def name_from_email(email, known_staff):
    """Cloop's own exports key agents by email, not display name. Match
    against the project's accumulated real roster rather than guessing from
    the email alone — "de.renfree@ygp.au" only matches "De Ang Renfree" once
    a middle name is allowed to drop out, and "lehpeng.goh@ygp.au" only
    matches "Leh Peng Goh" once the whole name is squashed together, so both
    candidate forms are tried before falling back to a plain, flagged guess."""
    local = email.split("@", 1)[0]
    key = local.replace(".", "").replace("_", "").lower()
    for name in known_staff:
        words = name.split()
        candidates = {"".join(words).lower()}
        if len(words) > 2:
            candidates.add((words[0] + words[-1]).lower())
        if key in candidates:
            return name, True
    # Unmatched: best-effort title case from the email itself, flagged as unverified.
    guess = " ".join(w.capitalize() for w in local.replace("_", ".").split("."))
    return guess, False


def hms_to_days(s):
    """'186:39:58' (H:MM:SS, hours can exceed 24) -> days as a float."""
    s = s.strip()
    if not s or s == "-":
        return 0.0
    h, m, sec = (int(p) for p in s.split(":"))
    return round((h * 3600 + m * 60 + sec) / 86400, 2)


def parse_realtime(path):
    """"Failed Communication" is an automated-retry queue, not a customer
    contact waiting for a reply — the rendered report has always excluded it
    (and every other zero-count queue) from both the panel and its own
    Summary row, so the raw export's own "Summary" row (which includes it)
    can't be trusted directly: it would inflate inQueue by an order of
    magnitude the moment that queue holds anything. Recompute the summary
    from the filtered queue list instead of reading the file's own Summary
    row."""
    with open(path, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.reader(f))
    # Row 0: "Queues" title. Row 1: group header. Row 2: column header
    # ("Name,Online,On contact,...,Active,In queue,Oldest,Scheduled,Queued,
    # Handled,Abandoned,AHT,SL 60 secs"). Data rows follow; "Summary" closes it.
    data_rows = [r for r in rows[3:] if r and r[0].strip()]
    queues = []
    for r in data_rows:
        name, in_queue, oldest = r[0].strip(), int(r[9]), hms_to_days(r[10])
        if name in ("Summary", "Failed Communication") or in_queue == 0:
            continue
        queues.append({"queue": name, "inQueue": in_queue, "oldestDays": oldest})
    summary = {
        "inQueue": sum(q["inQueue"] for q in queues),
        "oldestDays": max((q["oldestDays"] for q in queues), default=0.0),
    }
    return queues, summary


def parse_queue_historical(path):
    with open(path, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    contacts = [{"queue": r["Queue"].strip(), "count": int(r["Contacts queued"] or 0)} for r in rows]
    return sorted(contacts, key=lambda x: -x["count"])


def parse_agent_historical(path, known_staff):
    with open(path, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    out = []
    unmatched = []
    for r in rows:
        name, matched = name_from_email(r["Agent"].strip(), known_staff)
        if not matched:
            unmatched.append(name)
        out.append({
            "agent": name,
            "incoming": int(r["Contacts handled incoming"] or 0),
            "outbound": int(r["Contacts handled outbound"] or 0),
            "total": int(r["Contacts handled"] or 0),
        })
    out.sort(key=lambda x: -x["total"])
    return out, unmatched


def shift_trend(prev_list, new_value):
    if prev_list is None:
        return [new_value] * 10
    return (prev_list + [new_value])[-10:]


def build_cloop(date, realtime_path, historical_date, queue_historical_path, agent_historical_path,
                 prev=None, known_staff_dir="assets/data/reports"):
    """Core computation, callable directly (e.g. by api/generate.py) as well as
    from the CLI below — one implementation, so the on-demand "Generate" button
    and the daily automated routine can never quietly drift apart.

    prev: the previous committed date's own cloop.json, already parsed (a
    dict), or None if there isn't one yet. Returns (result, unmatched) — the
    result dict and the list of agent emails that couldn't be matched to a
    known name, so callers can decide how loudly to surface that.
    """
    known_staff = load_known_staff(known_staff_dir)
    real_time_queues, real_time_summary = parse_realtime(realtime_path)
    contacts_queued = parse_queue_historical(queue_historical_path)
    emails_handled, unmatched = parse_agent_historical(agent_historical_path, known_staff)

    def prev_trend(path_keys):
        node = prev
        for k in path_keys:
            if node is None:
                return None
            node = node.get(k)
        return node

    contacts_queued_total = sum(r["count"] for r in contacts_queued)

    result = {
        "reportDate": date,
        "realTimeQueues": real_time_queues,
        "realTimeSummary": real_time_summary,
        "contactsQueuedYesterday": contacts_queued,
        "contactsQueuedTenDayTrend": {
            "totals": shift_trend(prev_trend(["contactsQueuedTenDayTrend", "totals"]), contacts_queued_total),
        },
        "emailsHandledYesterday": emails_handled,
        "_historicalDate": historical_date,
        "_unmatchedAgentNames": unmatched,
    }
    return result, unmatched


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", required=True, help="Date the Real-Time snapshot was taken")
    ap.add_argument("--realtime", required=True)
    ap.add_argument("--historical-date", required=True, help="Date the two Historical reports cover (most recent business day)")
    ap.add_argument("--queue-historical", required=True)
    ap.add_argument("--agent-historical", required=True)
    ap.add_argument("--known-staff-dir", default="assets/data/reports")
    ap.add_argument("--prev", help="Previous date's committed cloop.json, for trend chaining")
    ap.add_argument("--out")
    args = ap.parse_args()

    prev = json.loads(Path(args.prev).read_text()) if args.prev else None

    result, unmatched = build_cloop(
        args.date, args.realtime, args.historical_date, args.queue_historical, args.agent_historical,
        prev=prev, known_staff_dir=args.known_staff_dir,
    )

    out = json.dumps(result, ensure_ascii=False, indent=2)
    if args.out:
        Path(args.out).write_text(out, encoding="utf-8")
        print(f"Wrote {args.out}")
    else:
        print(out)
    if unmatched:
        print(f"WARNING: {len(unmatched)} agent email(s) could not be matched to a known staff name: {unmatched}")


if __name__ == "__main__":
    main()
