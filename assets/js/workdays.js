// ACT (Canberra) working-day calendar for 2026, and helpers for turning a
// streak's day-count into a calendar "since" date, or for drawing a month
// calendar that marks public holidays and known leave.
export const ACT_PUBLIC_HOLIDAYS_2026 = [
  { date: '2026-01-01', name: "New Year's Day" },
  { date: '2026-01-26', name: 'Australia Day' },
  { date: '2026-03-09', name: 'Canberra Day' },
  { date: '2026-04-03', name: 'Good Friday' },
  { date: '2026-04-04', name: 'Easter Saturday' },
  { date: '2026-04-05', name: 'Easter Sunday' },
  { date: '2026-04-06', name: 'Easter Monday' },
  { date: '2026-04-25', name: 'Anzac Day' },
  { date: '2026-04-27', name: 'Anzac Day (observed)' },
  { date: '2026-06-01', name: 'Reconciliation Day' },
  { date: '2026-06-08', name: "King's Birthday" },
  { date: '2026-10-05', name: 'Labour Day' },
  { date: '2026-12-25', name: 'Christmas Day' },
  { date: '2026-12-26', name: 'Boxing Day' },
  { date: '2026-12-28', name: 'Boxing Day (observed)' },
];
const HOLIDAY_MAP = new Map(ACT_PUBLIC_HOLIDAYS_2026.map((h) => [h.date, h.name]));

export function holidayName(isoDate) {
  return HOLIDAY_MAP.get(isoDate) || null;
}

function toISO(d) { return d.toISOString().slice(0, 10); }

export function isWorkingDay(isoDate) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const day = d.getUTCDay(); // 0 Sun .. 6 Sat
  return day !== 0 && day !== 6 && !HOLIDAY_MAP.has(isoDate);
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
