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

# The reception/front-desk roster, taken verbatim (trailing spaces in some raw
# names stripped) from the Source_Table sheet of the official
# YourGP_CallLogs_DataProcessor workbook — the same lookup table it uses to
# tag each call's "Agent Type" (practice). A one-time snapshot, not a live
# daily feed, so it's hardcoded here as the authoritative baseline and
# unioned with KNOWN_STAFF_FROM_HISTORY below for anyone hired since.
KNOWN_RECEPTION_STAFF = {
    "Andrew Davies", "Lucinda Gonzalez", "Bianca Mitchell", "David Antioch",
    "Emily Pettett", "Ella Blackmore", "Georgia Moore", "Hannah Leitch",
    "Hannah Searle", "Holly Archer", "Jasmine Deery", "Mikayla Jenkins",
    "Shae Connors", "Jessica Hinchy", "Isaac Davis", "Kiara Pfeffer",
    "Andrew Gunn", "Pawanni Chandrasegaran", "Frances Doble", "Lily Willmott",
    "De Ang Renfree", "Mel Deery", "Crace - Rec 1", "Kate Chin", "Pinky De Paz",
    "Apurva Pathak", "Ambrosie Brassil", "Samantha Cooper", "Rebecca Quinn",
    "Megan Wright", "Aiden Chang", "Atif Wan", "Lyneham - Rec 1",
}

# Names that reached a committed call-logs.json's inboundByStaff/outboundByStaff
# at some point in this project's history, but are confirmed NOT on the
# official reception roster above (e.g. PST/admin staff who occasionally
# answer an email queue but aren't phone reception) — excluded so the
# historical-scan fallback below doesn't re-introduce them. Keep this list to
# genuinely confirmed cases only, each with the evidence that got it here.
KNOWN_NON_RECEPTION = {
    # Appeared in 2026-08-10's committed outboundByStaff, but is absent from
    # the official Source_Table roster and from 2026-10-06's own
    # OutboundStaffSummary table in the official workbook (confirmed
    # separately, see scripts/ commit history) — an email/admin staff member,
    # not reception.
    "Jasmina Sodolovic",
}


def read_rows(path):
    with open(path, newline="", encoding="utf-8-sig") as f:
        return [row for row in csv.DictReader(f) if any(v.strip() for v in row.values() if v is not None)]


def load_known_staff(reports_dir):
    """The raw outbound PBX export (ExportCallRecords) covers every extension in
    the building, not just reception — a doctor's room calling a pharmacy shows
    up with the same shape as a receptionist's call. There's no clean field to
    tell them apart, so the known-staff roster is the official Source_Table
    snapshot (KNOWN_RECEPTION_STAFF) plus every name this project has since
    committed for inbound/outbound call handling, minus any name confirmed NOT
    to be reception staff despite appearing in that history (KNOWN_NON_RECEPTION).
    Deliberately NOT sourced from cloop.json's emailsHandledYesterday:
    email-handling staff (e.g. PST/admin) and phone-reception staff are
    overlapping but different groups, and the official workbook's own
    OutboundStaffSummary table excludes email-only staff."""
    names = set(KNOWN_RECEPTION_STAFF)
    for path in glob.glob(f"{reports_dir}/*/call-logs.json"):
        try:
            d = json.loads(Path(path).read_text())
        except (OSError, json.JSONDecodeError):
            continue
        for key in ("inboundByStaff", "outboundByStaff"):
            for row in d.get(key, []):
                names.add(row["name"].strip())
    return names - KNOWN_NON_RECEPTION


def mins(seconds_total, count):
    return round(seconds_total / 60) if count else 0


def dedupe_by_guid(rows):
    """The raw exports occasionally log the exact same call twice (identical
    CallGUID, identical fields) — confirmed against the official
    YourGP_CallLogs_DataProcessor workbook's own Cleaned_Call_Records sheet,
    which is itself deduplicated by CallGUID. Keep the first occurrence."""
    seen = set()
    out = []
    for r in rows:
        if r["CallGUID"] in seen:
            continue
        seen.add(r["CallGUID"])
        out.append(r)
    return out


def parse_queue_file(path):
    """One CallQueue_Detailed_*.csv: per-call rows for a single queue."""
    rows = dedupe_by_guid(read_rows(path))
    accepted = [r for r in rows if r["CallAnsweredInQueue"] == "1"]
    missed = [r for r in rows if r["CallTimedOutOrExit"] == "1"]
    # Confirmed 2026-10-07 by direct cross-check against the rendered report's
    # own "Average Wait Time (10 Days)" charts: mean(UserTimeToAnswer) matches
    # the PDF's printed figure exactly (per queue and overall), while
    # mean(CallTimeToAnswer) — what this line used until now — reads roughly
    # 3x too high. The "CallTimeToAnswer (queue wait)" rationale below this
    # function and in parse_inbound was never independently verified for this
    # specific field; it was carried over from the (correctly verified)
    # longest-wait finding and turned out to be wrong for the average.
    wait_times = [int(r["UserTimeToAnswer"]) for r in accepted if r["UserTimeToAnswer"]]
    avg_wait = round(statistics.mean(wait_times)) if wait_times else 0

    # "Longest wait" (here and in parse_inbound's overall figure) is
    # UserTimeToAnswer — the time until the specific agent who ultimately
    # answered engaged — not CallTimeToAnswer (how long the call sat in this
    # queue before being routed to someone). Confirmed against the official
    # workbook's KPI_Calculations sheet: its "Longest Waiting Time" value and
    # timestamp match a call's UserTimeToAnswer, not its CallTimeToAnswer,
    # which for that same call was a different (lower) number.
    longest = max(rows, key=lambda r: int(r["UserTimeToAnswer"] or 0), default=None)
    longest_wait = None
    if longest and int(longest["UserTimeToAnswer"] or 0) > 0:
        wait_sec = int(longest["UserTimeToAnswer"])
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
    """InboundCalls_Detailed.csv covers every inbound call the PBX logged, not
    just the ones that reached one of our named queues (a handful ring a line
    with no queue behind it at all, e.g. a direct line to an unused extension).
    Confirmed against the official workbook's own Cleaned_Call_Records sheet:
    'accepted' there counts every answered row in this file regardless of
    queue/target, full stop — there is no equivalent "missed but never reached
    a queue" concept at all. A call that times out before reaching a queue
    simply isn't tracked as a missed call anywhere in the official report, so
    this script doesn't invent one either: the missed count this project
    reports is the queue files' own missed count (see main()), not anything
    counted from this file."""
    rows = dedupe_by_guid(read_rows(path))
    answered = [r for r in rows if r["FirstUserName"].strip()]

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
    # Average wait AND "longest wait" both use UserTimeToAnswer — see
    # parse_queue_file's own note for how the average was confirmed (2026-10-07,
    # cross-checked against the rendered report's own wait-time charts).
    all_user_wait_times = [int(r["UserTimeToAnswer"] or 0) for r in answered if r["UserTimeToAnswer"]]
    longest_call = max(answered, key=lambda r: int(r["TotalTalkTimeAllUsers"] or 0), default=None)
    longest_wait_call = max(answered, key=lambda r: int(r["UserTimeToAnswer"] or 0), default=None)

    return {
        "accepted": len(answered),
        "inboundByStaff": inbound_by_staff,
        "avgCallHandlingSec": round(statistics.mean(talk_times)) if talk_times else 0,
        "overallAvgWaitSec": round(statistics.mean(all_user_wait_times)) if all_user_wait_times else 0,
        "longestCallDurationSec": int(longest_call["TotalTalkTimeAllUsers"]) if longest_call else 0,
        "longestCallAt": format_time(longest_call["CallDateTime"]) if longest_call else None,
        "longestCallAgent": longest_call["FirstUserName"].strip() if longest_call else None,
        "longestWaitingTimeSec": max(all_user_wait_times) if all_user_wait_times else 0,
        "longestWaitingAt": format_time(longest_wait_call["CallDateTime"]) if longest_wait_call and all_user_wait_times else None,
    }


def parse_outbound(path, known_staff):
    """ExportCallRecords.csv's Direction=='Out' rows split three ways: known
    reception staff (outboundByStaff — this project's "Total Outbound Calls"
    figure, matching the rendered report's own caption and the official
    workbook's OutboundStaffSummary table), everyone else with a named
    extension (otherExtensions — doctors' rooms, admin, etc.), and a handful
    of rows with no UserName/extension at all (confirmed present in the
    official workbook's own Cleaned_Call_Records — real calls, just
    unattributed — bucketed here rather than silently dropped, which would
    undercount the grand total against that source)."""
    rows = dedupe_by_guid([r for r in read_rows(path) if r["Direction"] == "Out"])
    by_staff = {}
    other_by_staff = {}
    for r in rows:
        name = r["UserName"].strip() or "(Unattributed)"
        bucket = by_staff if (known_staff and name in known_staff) else other_by_staff
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
        "allOutboundTotal": len(rows),
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


def build_call_logs(date, inbound_path, outbound_path, queue_files, prev=None, known_staff_dir="assets/data/reports"):
    """Core computation, callable directly (e.g. by api/generate.py) as well as
    from the CLI below — one implementation, so the on-demand "Generate" button
    and the daily automated routine can never quietly drift apart.

    queue_files: {queueName: path}. prev: the previous committed date's own
    call-logs.json, already parsed (a dict), or None if there isn't one yet.
    Returns the result dict; callers decide what to do with it (write to a
    file, commit via the GitHub API, print to stdout, ...).
    """
    known_staff = load_known_staff(known_staff_dir)

    queues = {}
    for name in ALL_QUEUES:
        if name in queue_files:
            queues[name] = parse_queue_file(queue_files[name])
        else:
            queues[name] = {"accepted": 0, "missed": 0, "avgWaitSec": 0, "longestWait": None, "rows": []}

    inbound = parse_inbound(inbound_path)
    outbound = parse_outbound(outbound_path, known_staff)

    queue_report = [{"queue": n, "accepted": q["accepted"], "missed": q["missed"]} for n, q in queues.items()]
    grand_total = {
        "accepted": sum(q["accepted"] for q in queues.values()),
        "missed": sum(q["missed"] for q in queues.values()),
    }

    # "Missed" is only ever a queue-attributed figure in the official report —
    # confirmed against the official workbook's Cleaned_Call_Records sheet,
    # whose own "Total Inbound" is exactly accepted (every answered call, any
    # line) + this queue-missed count, with no separate "missed but never
    # reached a queue" figure anywhere. Total/accepted/missed below follow
    # that same split rather than inventing a metric the source report
    # doesn't track.
    total_missed = grand_total["missed"]
    total_inbound = inbound["accepted"] + total_missed
    accepted_pct = round(100 * inbound["accepted"] / total_inbound) if total_inbound else 0

    def prev_trend(path_keys, default=None):
        node = prev
        for k in path_keys:
            if node is None:
                return None
            node = node.get(k)
        return node

    result = {
        "reportDate": date,
        "summary": {
            "totalInbound": total_inbound,
            "accepted": inbound["accepted"],
            "missed": total_missed,
            "acceptedPct": accepted_pct,
            "missedPct": 100 - accepted_pct if total_inbound else 0,
            "totalOutbound": outbound["total"],
        },
        "queueReport": queue_report,
        "grandTotal": grand_total,
        "tenDayTrend": {
            "accepted": shift_trend(prev_trend(["tenDayTrend", "accepted"]), inbound["accepted"]),
            "missed": shift_trend(prev_trend(["tenDayTrend", "missed"]), total_missed),
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
            "longestWaitingAt": inbound["longestWaitingAt"],
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
        # This tracks ALL outbound calls (every extension — reception, doctors'
        # rooms, everyone), a different and much larger figure than
        # summary.totalOutbound/outboundByStaff above (reception staff only).
        # Confirmed against the official workbook's own Outbound_10Day_Trend
        # sheet, which is exactly this broader count, not the reception-only one.
        "outboundTenDayTrend": {
            "totals": shift_trend(prev_trend(["outboundTenDayTrend", "totals"]), outbound["allOutboundTotal"]),
        },
    }
    return result


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

    prev = json.loads(Path(args.prev).read_text()) if args.prev else None

    result = build_call_logs(
        args.date, args.inbound, args.outbound, queue_files,
        prev=prev, known_staff_dir=args.known_staff_dir,
    )

    out = json.dumps(result, ensure_ascii=False, indent=2)
    if args.out:
        Path(args.out).write_text(out, encoding="utf-8")
        print(f"Wrote {args.out}")
    else:
        print(out)


if __name__ == "__main__":
    main()
