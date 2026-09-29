import { formatPKR } from '@grabgo/core';

/**
 * Dashboard formatting.
 *
 * Money comes from `@grabgo/core` so a merchant statement and the customer's
 * receipt read identically. Dates are rendered in Karachi time because that is
 * the timezone the cafe operates in, regardless of where the browser is.
 */

export { formatPKR };

const KARACHI = 'Asia/Karachi';

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-PK', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: KARACHI,
  });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-PK', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: KARACHI,
  });
}

export function formatDateTime(iso: string): string {
  return `${formatDate(iso)}, ${formatTime(iso)}`;
}

/** "4 min ago" / "in 12 min" — how long a ticket has been waiting. */
export function formatRelative(iso: string, now = Date.now()): string {
  const diff = Math.round((new Date(iso).getTime() - now) / 60_000);

  if (Math.abs(diff) < 1) return 'now';
  if (diff > 0) return diff < 60 ? `in ${diff} min` : `in ${Math.round(diff / 60)} h`;

  const ago = Math.abs(diff);
  return ago < 60 ? `${ago} min ago` : `${Math.round(ago / 60)} h ago`;
}

/** Minutes since a ticket arrived, for the "waiting" counter on the board. */
export function minutesSince(iso: string, now = Date.now()): number {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
}

export function formatPercent(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatNumber(value: number): string {
  return value.toLocaleString('en-PK');
}

/** `510` minutes-of-day -> `"08:30"`, for the opening-hours editor. */
export function minutesToTimeInput(minutes: number | null): string {
  if (minutes === null) return '';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

export function timeInputToMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;
