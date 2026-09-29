import { formatDistance, formatPKR } from '@grabgo/core';
import type { OrderStatus } from '@grabgo/types';

/**
 * Display formatting.
 *
 * Money and distance come from `@grabgo/core` so the app, the merchant board and
 * the receipt all render Rs. 650 the same way. What lives here is the copy that
 * is specific to the phone: relative times, greetings, order summaries.
 */

export { formatPKR, formatDistance };

/** "in 12 min", "3 min ago", "tomorrow at 8:00 AM". */
export function formatRelativeTime(iso: string, now = new Date()): string {
  const target = new Date(iso);
  const diffMinutes = Math.round((target.getTime() - now.getTime()) / 60_000);

  if (Math.abs(diffMinutes) < 1) return 'now';

  if (diffMinutes > 0) {
    if (diffMinutes < 60) return `in ${diffMinutes} min`;
    if (diffMinutes < 24 * 60) return `at ${formatClock(target)}`;
    return `tomorrow at ${formatClock(target)}`;
  }

  const ago = Math.abs(diffMinutes);
  if (ago < 60) return `${ago} min ago`;
  if (ago < 24 * 60) return `${Math.round(ago / 60)} h ago`;
  return formatShortDate(target);
}

export function formatClock(date: Date): string {
  return date.toLocaleTimeString('en-PK', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export function formatShortDate(date: Date): string {
  return date.toLocaleDateString('en-PK', { day: 'numeric', month: 'short' });
}

export function formatLongDate(date: Date): string {
  return date.toLocaleDateString('en-PK', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/** Local time of day, used for the home-screen greeting. */
export function greeting(now = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** First name only — the home screen greets you, it does not address an envelope. */
export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? 'there';
}

/** "Iced Latte x 1, Cappuccino x 1" for a compact order row. */
export function summariseItems(
  items: Array<{ name: string; quantity: number }>,
  max = 2,
): string {
  const shown = items.slice(0, max).map((item) => `${item.name} × ${item.quantity}`);
  const remaining = items.length - shown.length;
  return remaining > 0 ? `${shown.join(', ')} +${remaining} more` : shown.join(', ');
}

export function pluralise(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : (plural ?? `${singular}s`);
}

/** Short status copy for a list row, where the full label is too long. */
export function shortStatusLabel(status: OrderStatus): string {
  switch (status) {
    case 'PENDING':
      return 'Sent';
    case 'ACCEPTED':
      return 'Accepted';
    case 'PREPARING':
      return 'Preparing';
    case 'READY':
      return 'Ready';
    case 'PICKED_UP':
    case 'COMPLETED':
      return 'Collected';
    case 'EXPIRED':
      return 'Expired';
    default:
      return 'Cancelled';
  }
}

/** "~10 min" for a cafe card. */
export function formatPrepTime(minutes: number): string {
  return `~${Math.max(1, Math.round(minutes))} min`;
}

export function formatPoints(points: number): string {
  return points.toLocaleString('en-PK');
}
