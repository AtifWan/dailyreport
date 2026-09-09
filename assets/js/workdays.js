// ACT (Canberra) working-day calendar for 2026, and helpers for turning a
// streak's day-count into a calendar "since" date.
//
// Source: ACT public holidays 2026 (New Year's Day, Australia Day, Canberra Day,
// Easter Thu-Mon, Anzac Day + its Mon 27 Apr observed day, Reconciliation Day,
// King's Birthday, Labour Day, Christmas Day + its Mon 28 Dec observed day).
// A "working day" here = Mon-Fri and not one of these.
export const ACT_PUBLIC_HOLIDAYS_2026 = [
  '2026-01-01', // New Year's Day
  '2026-01-26', // Australia Day
  '2026-03-09', // Canberra Day
  '2026-04-03', // Good Friday
  '2026-04-04', // Easter Saturday
  '2026-04-05', // Easter Sunday
  '2026-04-06', // Easter Monday
  '2026-04-25', // Anzac Day
  '2026-04-27', // Anzac Day (observed, falls on a Saturday)
  '2026-06-01', // Reconciliation Day
  '2026-06-08', // King's Birthday
  '2026-10-05', // Labour Day
  '2026-12-25', // Christmas Day
  '2026-12-26', // Boxing Day
  '2026-12-28', // Boxing Day (observed, falls on a Saturday)
];
const HOLIDAY_SET = new Set(ACT_PUBLIC_HOLIDAYS_2026);

function toISO(d) { return d.toISOString().slice(0, 10); }

export function isWorkingDay(isoDate) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const day = d.getUTCDay(); // 0 Sun .. 6 Sat
  return day !== 0 && day !== 6 && !HOLIDAY_SET.has(isoDate);
}

/** The calendar date that starts a `streakDays`-long run of working days ending
 *  on (and including) `endISO`. Returns null for a 0-day (no active) streak. */
export function startOfWorkingStreak(endISO, streakDays) {
  if (!streakDays || streakDays <= 0) return null;
  let d = new Date(`${endISO}T00:00:00Z`);
  let remaining = streakDays;
  while (true) {
    const iso = toISO(d);
    if (isWorkingDay(iso)) {
      remaining--;
      if (remaining === 0) return iso;
    }
    d = new Date(d.getTime() - 86400000);
  }
}
