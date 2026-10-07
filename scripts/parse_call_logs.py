#!/usr/bin/env python3
"""
Deterministically compute a date's call-logs.json body from the raw Telair PBX
CSV exports (ExportCallRecords, InboundCalls_*_Detailed, CallQueue_Detailed_*
per queue) dropped into the Call_Logs_Automation SharePoint folder, instead of
extracting the numbers from the rendered PDF's text.

Usage:
    python3 -I scripts/parse_call_logs.py --date 2026-10-06 \
        --inbound InboundCalls_20261006_20261006_Detailed.csv \
        --outbound ExportCallRecords_20261006_20261006.csv \
        --queue "Appointments=CallQueue_Detailed_20261006_20261006_Appointments.csv" \
        --queue "General Enquiries=CallQueue_Detailed_20261006_20261006_General_Enquiries.csv" \
        --queue "Canberra Vasectomy=CallQueue_Detailed_20261006_20261006_Canberra_Vasectomy.csv" \
        [--prev assets/data/reports/2026-10-02/call-logs.json] \
        [--out assets/data/reports/2026-10-06/call-logs.json]

Prints the computed JSON body to stdout when --out is omitted. This script
only computes hard numbers; the narrative "_source"/"_note" fields the rest
of this project's data files carry are added separately at commit time.
"""
import argparse
import csv
import glob
import json
import statistics
from pathlib import Path

ALL_QUEUES = ["Appointments", "General Enquiries", "Health Professionals", "Canberra Vasectomy"]


def read_rows(path):
    with open(path, newline="", encoding="utf-8-sig") as f:
        return [row for row in csv.DictReader(f) if any(v.strip() for v in row.values() if v is not None)]


def load_known_staff(reports_dir):
    """The raw outbound PBX export (ExportCallRecords) covers every extension in
    the building, not just reception — a doctor's room calling a pharmacy shows
    up with the same shape as a receptionist's call. There's no clean field to
    tell them apart, so the known-staff roster is built from every name this
    project has ever actually committed for inbound/outbound/email handling —
    accumulated ground truth beats guessing at name patterns."""
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


def mins(seconds_total, count):
    return round(seconds_total / 60) if count else 0


def parse_queue_file(path):
    """One CallQueue_Detailed_*.csv: per-call rows for a single queue."""
    rows = read_rows(path)
    accepted = [r for r in rows if r["CallAnsweredInQueue"] == "1"]
    missed = [r for r in rows if r["CallTimedOutOrExit"] == "1"]
    wait_times = [int(r["CallTimeToAnswer"]) for r in accepted if r["CallTimeToAnswer"]]
    avg_wait = round(statistics.mean(wait_times)) if wait_times else 0

    longest = max(rows, key=lambda r: int(r["CallTimeToAnswer"] or 0), default=None)
    longest_wait = None
    if longest and int(longest["CallTimeToAnswer"] or 0) > 0:
        wait_sec = int(longest["CallTimeToAnswer"])
        m, s = divmod(wait_sec, 60)
        longest_wait = {
            "waitSec": wait_sec,
            "time": format_time(longest["CallDateTime"]),
            "name": longest["FirstUserName"].strip() or None,
            "waitLabel": f"{m} min {s} sec",
        }

    return {
        "accepted": len(accepted),
        "missed": len(missed),
        "avgWaitSec": avg_wait,
        "longestWait": longest_wait,
        "rows": rows,
    }


def format_time(dt_str):
    # "6/10/2026 7:49:03 AM" -> "7:49 AM"
    _, time_part = dt_str.split(" ", 1)
    hm, ampm = time_part.rsplit(" ", 1)
    h, m, *_ = hm.split(":")
    return f"{int(h)}:{m} {ampm}"


def parse_inbound(path):
    rows = read_rows(path)
    answered = [r for r in rows if r["FirstUserName"].strip()]
    missed = [r for r in rows if not r["FirstUserName"].strip()]

    by_staff = {}
    for r in answered:
        name = r["FirstUserName"].strip()
        by_staff.setdefault(name, {"calls": 0, "seconds": 0})
        by_staff[name]["calls"] += 1
        by_staff[name]["seconds"] += int(r["TotalTalkTimeAllUsers"] or 0)
    inbound_by_staff = sorted(
        [{"name": n, "calls": v["calls"], "durationMins": mins(v["seconds"], v["calls"])} for n, v in by_staff.items()],
        key=lambda x: -x["calls"],
    )

    talk_times = [int(r["TotalTalkTimeAllUsers"] or 0) for r in answered]
    # Overall average/longest wait are pooled across every call this file covers
    # (every queue together) — NOT an average of each queue's own longest wait,
    # which would overstate it by an order of magnitude.
    answered_wait_times = [int(r["CallTimeToAnswer"] or 0) for r in answered if r["CallTimeToAnswer"]]
    all_wait_times = [int(r["CallTimeToAnswer"] or 0) for r in rows if r["CallTimeToAnswer"]]
    longest_call = max(answered, key=lambda r: int(r["TotalTalkTimeAllUsers"] or 0), default=None)

    return {
        "total": len(rows),
        "accepted": len(answered),
        "missed": len(missed),
        "missedGuids": {r["CallGUID"] for r in missed},
        "inboundByStaff": inbound_by_staff,
        "avgCallHandlingSec": round(statistics.mean(talk_times)) if talk_times else 0,
        "overallAvgWaitSec": round(statistics.mean(answered_wait_times)) if answered_wait_times else 0,
        "longestCallDurationSec": int(longest_call["TotalTalkTimeAllUsers"]) if longest_call else 0,
        "longestCallAt": format_time(longest_call["CallDateTime"]) if longest_call else None,
        "longestCallAgent": longest_call["FirstUserName"].strip() if longest_call else None,
        "longestWaitingTimeSec": max(all_wait_times) if all_wait_times else 0,
    }


def parse_outbound(path, known_staff):
    rows = [r for r in read_rows(path) if r["Direction"] == "Out" and r["UserName"].strip()]
    by_staff = {}
    other_by_staff = {}
    for r in rows:
        name = r["UserName"].strip()
        bucket = by_staff if (not known_staff or name in known_staff) else other_by_staff
        bucket.setdefault(name, {"calls": 0, "seconds": 0})
        bucket[name]["calls"] += 1
        bucket[name]["seconds"] += int(r["BillableTime"] or 0)

    def to_rows(d):
        return sorted(
            [{"name": n, "calls": v["calls"], "durationMins": mins(v["seconds"], v["calls"])} for n, v in d.items()],
            key=lambda x: -x["calls"],
        )

    outbound_by_staff = to_rows(by_staff)
    other_extensions = to_rows(other_by_staff)
    return {
        "total": sum(r["calls"] for r in outbound_by_staff),
        "outboundByStaff": outbound_by_staff,
        "otherExtensionsTotal": sum(r["calls"] for r in other_extensions),
        "otherExtensions": other_extensions,
    }


def shift_trend(prev_list, new_value):
    """Drop the oldest point, append the new one — same rolling-10 convention
    every committed date's trend array already follows."""
    if prev_list is None:
        return [new_value] * 10  # no history yet: flat-fill rather than guess
    return (prev_list + [new_value])[-10:]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", required=True)
    ap.add_argument("--inbound", required=True)
    ap.add_argument("--outbound", required=True)
    ap.add_argument("--queue", action="append", required=True, help="QueueName=path/to/file.csv")
    ap.add_argument("--prev", help="Previous date's committed call-logs.json, for trend chaining")
    ap.add_argument("--known-staff-dir", default="assets/data/reports",
                     help="Root of committed report dates, used to tell reception-team outbound calls apart from direct room/doctor-extension calls")
    ap.add_argument("--out")
    args = ap.parse_args()

    queue_files = {}
    for spec in args.queue:
        name, path = spec.split("=", 1)
        queue_files[name] = path

    known_staff = load_known_staff(args.known_staff_dir)
    inbound = parse_inbound(args.inbound)
    outbound = parse_outbound(args.outbound, known_staff)

    queues = {}
    for name in ALL_QUEUES:
        if name in queue_files:
            queues[name] = parse_queue_file(queue_files[name])
        else:
            queues[name] = {"accepted": 0, "missed": 0, "avgWaitSec": 0, "longestWait": None, "rows": []}

    queue_report = [{"queue": n, "accepted": q["accepted"], "missed": q["missed"]} for n, q in queues.items()]
    grand_total = {
        "accepted": sum(q["accepted"] for q in queues.values()),
        "missed": sum(q["missed"] for q in queues.values()),
    }

    # Some missed calls never reach any queue at all (the caller hangs up during
    # the opening IVR/menu) — real calls, just not attributable to a queue, so
    # queueReport/grandTotal will never sum to summary.missed. Surface the size
    # of that gap explicitly rather than let it look like an unexplained mismatch.
    queue_call_guids = {r["CallGUID"] for q in queues.values() for r in q["rows"]}
    pre_queue_abandoned = len(inbound["missedGuids"] - queue_call_guids)

    accepted_pct = round(100 * inbound["accepted"] / inbound["total"]) if inbound["total"] else 0


    prev = json.loads(Path(args.prev).read_text()) if args.prev else None

    def prev_trend(path_keys, default=None):
        node = prev
        for k in path_keys:
            if node is None:
                return None
            node = node.get(k)
        return node

    result = {
        "reportDate": args.date,
        "summary": {
            "totalInbound": inbound["total"],
            "accepted": inbound["accepted"],
            "missed": inbound["missed"],
            "acceptedPct": accepted_pct,
            "missedPct": 100 - accepted_pct if inbound["total"] else 0,
            "totalOutbound": outbound["total"],
        },
        "queueReport": queue_report,
        "grandTotal": grand_total,
        "preQueueAbandoned": pre_queue_abandoned,
        "tenDayTrend": {
            "accepted": shift_trend(prev_trend(["tenDayTrend", "accepted"]), inbound["accepted"]),
            "missed": shift_trend(prev_trend(["tenDayTrend", "missed"]), inbound["missed"]),
            "answerRatePct": shift_trend(prev_trend(["tenDayTrend", "answerRatePct"]), accepted_pct),
            "overallAvgWaitSec": shift_trend(
                prev_trend(["tenDayTrend", "overallAvgWaitSec"]), inbound["overallAvgWaitSec"],
            ),
        },
        "queues": {
            name: {
                "accepted": shift_trend(prev_trend(["queues", name, "accepted"]), q["accepted"]),
                "missed": shift_trend(prev_trend(["queues", name, "missed"]), q["missed"]),
                "avgWaitSec": shift_trend(prev_trend(["queues", name, "avgWaitSec"]), q["avgWaitSec"]),
            }
            for name, q in queues.items()
        },
        "patientServiceKpi": {
            "longestCallDurationSec": inbound["longestCallDurationSec"],
            "longestCallAt": inbound["longestCallAt"],
            "longestCallAgent": inbound["longestCallAgent"],
            "longestWaitingTimeSec": inbound["longestWaitingTimeSec"],
            "avgCallHandlingSec": inbound["avgCallHandlingSec"],
        },
        "longestWaitPerQueue": [
            {"queue": name, **(q["longestWait"] or {"waitSec": 0, "time": None, "name": None, "waitLabel": "0 min 0 sec"})}
            for name, q in queues.items()
        ],
        "inboundByStaff": inbound["inboundByStaff"],
        "outboundByStaff": outbound["outboundByStaff"],
        "outboundOtherExtensionsTotal": outbound["otherExtensionsTotal"],
        "outboundOtherExtensions": outbound["otherExtensions"],
        "outboundTenDayTrend": {
            "totals": shift_trend(prev_trend(["outboundTenDayTrend", "totals"]), outbound["total"]),
        },
    }

    out = json.dumps(result, ensure_ascii=False, indent=2)
    if args.out:
        Path(args.out).write_text(out, encoding="utf-8")
        print(f"Wrote {args.out}")
    else:
        print(out)


if __name__ == "__main__":
    main()
