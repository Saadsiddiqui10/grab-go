/**
 * Timezone-aware wall-clock helpers.
 *
 * A cafe's hours are wall-clock facts ("we open at 08:00"), while an order's
 * pickup time is an instant. Converting between the two has to happen in the
 * *business's* timezone, not the server's and not the phone's — a customer
 * checking Karachi hours from Dubai must still see Karachi's opening time.
 *
 * Implemented on `Intl`, so there is no timezone-database dependency to keep
 * current.
 */

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
  });

  formatterCache.set(timeZone, formatter);
  return formatter;
}

export function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = getFormatter(timeZone).formatToParts(date);
  const lookup: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') lookup[part.type] = part.value;
  }

  // `hour: '2-digit'` with hour12:false renders midnight as "24" in some ICU
  // versions; normalise it back to 0 so arithmetic stays sane.
  const hour = Number(lookup.hour ?? '0') % 24;

  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
    hour,
    minute: Number(lookup.minute ?? '0'),
    second: Number(lookup.second ?? '0'),
    weekday: WEEKDAY_INDEX[lookup.weekday ?? 'Sun'] ?? 0,
  };
}

/** Minutes since local midnight in `timeZone`. */
export function minutesOfDay(date: Date, timeZone: string): number {
  const parts = getZonedParts(date, timeZone);
  return parts.hour * 60 + parts.minute;
}

/** 0 = Sunday … 6 = Saturday, in `timeZone`. */
export function dayOfWeekIn(date: Date, timeZone: string): number {
  return getZonedParts(date, timeZone).weekday;
}

/** Local calendar date as `YYYY-MM-DD` in `timeZone`. */
export function dateKeyIn(date: Date, timeZone: string): string {
  const { year, month, day } = getZonedParts(date, timeZone);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Turn a wall-clock time in `timeZone` into the UTC instant it denotes.
 *
 * Two correction passes: the first lands within an hour of the answer, the second
 * settles it when the guess straddled a DST change. Pakistan has no DST today, but
 * the platform is built to add cities.
 */
export function zonedTimeToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
): Date {
  let timestamp = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  for (let pass = 0; pass < 2; pass += 1) {
    const parts = getZonedParts(new Date(timestamp), timeZone);
    const rendered = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const target = Date.UTC(year, month - 1, day, hour, minute, 0);
    const drift = rendered - target;
    if (drift === 0) break;
    timestamp -= drift;
  }

  return new Date(timestamp);
}

/** The instant of local midnight, `dayOffset` days from `reference`'s local date. */
export function startOfZonedDay(
  reference: Date,
  timeZone: string,
  dayOffset = 0,
): Date {
  const { year, month, day } = getZonedParts(reference, timeZone);
  const shifted = new Date(Date.UTC(year, month - 1, day + dayOffset));
  const shiftedParts = {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
  return zonedTimeToUtc(
    timeZone,
    shiftedParts.year,
    shiftedParts.month,
    shiftedParts.day,
    0,
    0,
  );
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

export function differenceInMinutes(later: Date, earlier: Date): number {
  return (later.getTime() - earlier.getTime()) / 60_000;
}

/** Round an instant up to the next `interval`-minute boundary of the local hour. */
export function ceilToInterval(date: Date, intervalMinutes: number): Date {
  if (intervalMinutes <= 0) return date;
  const intervalMs = intervalMinutes * 60_000;
  const rounded = Math.ceil(date.getTime() / intervalMs) * intervalMs;
  return new Date(rounded);
}

/** `510` -> `"8:30 AM"`. */
export function formatMinutesOfDay(minutes: number): string {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  const hour24 = Math.floor(normalized / 60);
  const minute = normalized % 60;
  const suffix = hour24 < 12 ? 'AM' : 'PM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${suffix}`;
}

/** `"8:30 AM"` for an instant, rendered in the business's timezone. */
export function formatTimeIn(date: Date, timeZone: string): string {
  return formatMinutesOfDay(minutesOfDay(date, timeZone));
}
