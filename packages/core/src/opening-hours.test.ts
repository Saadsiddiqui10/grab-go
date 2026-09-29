import { describe, expect, it } from 'vitest';
import {
  closingTimeAfter,
  describeAvailability,
  generatePickupSlots,
  isOpenAt,
  isValidPickupTime,
  nextOpeningTime,
  type ScheduleContext,
} from './opening-hours';
import { dateKeyIn, formatTimeIn, minutesOfDay } from './time';

const KARACHI = 'Asia/Karachi';

/** Mon-Sun 08:00-23:00, the default for a Clifton cafe. */
const standardWeek = Array.from({ length: 7 }, (_, dayOfWeek) => ({
  dayOfWeek,
  opensAt: 8 * 60,
  closesAt: 23 * 60,
  isClosed: false,
}));

const schedule = (overrides: Partial<ScheduleContext> = {}): ScheduleContext => ({
  timeZone: KARACHI,
  weekly: standardWeek,
  ...overrides,
});

// 2026-09-06 is a Sunday. 05:00Z is 10:00 in Karachi (UTC+5, no DST).
const sundayMorning = new Date('2026-09-06T05:00:00Z');
const sundayNight = new Date('2026-09-05T21:00:00Z'); // 02:00 Karachi, Sunday

describe('timezone handling', () => {
  it('reads wall-clock time in the cafe’s zone, not the server’s', () => {
    expect(minutesOfDay(sundayMorning, KARACHI)).toBe(600);
    expect(dateKeyIn(sundayMorning, KARACHI)).toBe('2026-09-06');
    expect(formatTimeIn(sundayMorning, KARACHI)).toBe('10:00 AM');
  });

  it('rolls the local date over before UTC does', () => {
    // 20:00Z is already 01:00 the next day in Karachi.
    expect(dateKeyIn(new Date('2026-09-06T20:00:00Z'), KARACHI)).toBe('2026-09-07');
  });
});

describe('isOpenAt', () => {
  it('is open during business hours', () => {
    expect(isOpenAt(schedule(), sundayMorning)).toBe(true);
  });

  it('is closed overnight', () => {
    expect(isOpenAt(schedule(), sundayNight)).toBe(false);
  });

  it('is closed on a configured closed day', () => {
    const weekly = standardWeek.map((row) =>
      row.dayOfWeek === 0 ? { ...row, isClosed: true } : row,
    );
    expect(isOpenAt(schedule({ weekly }), sundayMorning)).toBe(false);
  });

  it('respects a temporary closure switch', () => {
    expect(isOpenAt(schedule({ temporarilyClosed: true }), sundayMorning)).toBe(false);
  });

  it('handles a holiday override', () => {
    const holidays = [
      { date: '2026-09-06', isClosed: true, opensAt: null, closesAt: null },
    ];
    expect(isOpenAt(schedule({ holidays }), sundayMorning)).toBe(false);
  });

  it('handles special holiday hours', () => {
    const holidays = [
      { date: '2026-09-06', isClosed: false, opensAt: 12 * 60, closesAt: 15 * 60 },
    ];
    const context = schedule({ holidays });
    expect(isOpenAt(context, sundayMorning)).toBe(false);
    expect(isOpenAt(context, new Date('2026-09-06T08:00:00Z'))).toBe(true); // 13:00 PKT
  });

  describe('cafes that close after midnight', () => {
    const lateWeek = Array.from({ length: 7 }, (_, dayOfWeek) => ({
      dayOfWeek,
      opensAt: 8 * 60,
      closesAt: 1 * 60,
      isClosed: false,
    }));

    it('is open at 00:30, which belongs to the previous day’s window', () => {
      // 19:30Z Saturday = 00:30 Sunday in Karachi.
      const halfPastMidnight = new Date('2026-09-05T19:30:00Z');
      expect(isOpenAt(schedule({ weekly: lateWeek }), halfPastMidnight)).toBe(true);
    });

    it('is closed at 02:00, after the window ends', () => {
      expect(isOpenAt(schedule({ weekly: lateWeek }), sundayNight)).toBe(false);
    });

    it('is open late in the evening', () => {
      // 18:00Z = 23:00 PKT, past the standard 23:00 close but inside 08:00-01:00.
      expect(isOpenAt(schedule({ weekly: lateWeek }), new Date('2026-09-06T18:30:00Z'))).toBe(
        true,
      );
    });
  });
});

describe('closingTimeAfter', () => {
  it('reports when the current window ends', () => {
    const closesAt = closingTimeAfter(schedule(), sundayMorning);
    expect(closesAt).not.toBeNull();
    if (closesAt) expect(formatTimeIn(closesAt, KARACHI)).toBe('11:00 PM');
  });

  it('returns null when closed', () => {
    expect(closingTimeAfter(schedule(), sundayNight)).toBeNull();
  });
});

describe('nextOpeningTime', () => {
  it('finds this morning’s opening from the small hours', () => {
    const opensAt = nextOpeningTime(schedule(), sundayNight);
    expect(opensAt).not.toBeNull();
    if (opensAt) {
      expect(formatTimeIn(opensAt, KARACHI)).toBe('8:00 AM');
      expect(dateKeyIn(opensAt, KARACHI)).toBe('2026-09-06');
    }
  });

  it('skips closed days', () => {
    const weekly = standardWeek.map((row) =>
      row.dayOfWeek === 1 ? { ...row, isClosed: true } : row,
    );
    // From Sunday evening, the next opening is Tuesday because Monday is closed.
    const opensAt = nextOpeningTime(schedule({ weekly }), new Date('2026-09-06T19:00:00Z'));
    expect(opensAt && dateKeyIn(opensAt, KARACHI)).toBe('2026-09-08');
  });

  it('returns null when the cafe is paused', () => {
    expect(nextOpeningTime(schedule({ temporarilyClosed: true }), sundayMorning)).toBeNull();
  });
});

describe('describeAvailability', () => {
  it('says when an open cafe closes', () => {
    expect(describeAvailability(schedule(), sundayMorning)).toEqual({
      isOpen: true,
      label: 'Open until 11:00 PM',
    });
  });

  it('says when a closed cafe opens', () => {
    expect(describeAvailability(schedule(), sundayNight).label).toBe('Opens at 8:00 AM');
  });

  it('calls out a temporary closure', () => {
    expect(describeAvailability(schedule({ temporarilyClosed: true }), sundayMorning).label).toBe(
      'Temporarily closed',
    );
  });
});

describe('generatePickupSlots', () => {
  const options = {
    now: sundayMorning,
    schedule: schedule(),
    leadTimeMinutes: 10,
    intervalMinutes: 15,
    maxAheadMinutes: 180,
  };

  it('offers ASAP followed by clean quarter-hour slots', () => {
    const slots = generatePickupSlots(options);

    expect(slots[0]?.isAsap).toBe(true);
    expect(slots[0]?.label).toBe('ASAP (~10 min)');

    const scheduled = slots.filter((slot) => !slot.isAsap).slice(0, 4);
    expect(scheduled.map((slot) => slot.label)).toEqual([
      '10:15 AM',
      '10:30 AM',
      '10:45 AM',
      '11:00 AM',
    ]);
  });

  it('never offers a slot inside the preparation lead time', () => {
    const slots = generatePickupSlots({ ...options, leadTimeMinutes: 25 });
    const first = slots.find((slot) => !slot.isAsap);
    expect(first?.label).toBe('10:30 AM');
  });

  it('offers no slots at all while the cafe is closed today', () => {
    const holidays = [{ date: '2026-09-06', isClosed: true, opensAt: null, closesAt: null }];
    const slots = generatePickupSlots({
      ...options,
      schedule: schedule({ holidays }),
      maxAheadMinutes: 60,
    });
    expect(slots).toHaveLength(0);
  });

  it('skips to tomorrow’s opening rather than offering closed hours', () => {
    const slots = generatePickupSlots({
      ...options,
      now: new Date('2026-09-06T17:30:00Z'), // 22:30 PKT, closes at 23:00
      maxAheadMinutes: 15 * 60,
    });

    const labels = slots.filter((slot) => !slot.isAsap).map((slot) => slot.label);
    expect(labels).toContain('10:45 PM');
    expect(labels).toContain('8:00 AM');
    // Nothing between closing and opening.
    expect(labels).not.toContain('2:00 AM');
  });

  it('marks slots the cafe has already filled as unavailable', () => {
    const slots = generatePickupSlots(options);
    const target = slots.find((slot) => slot.label === '10:30 AM');
    expect(target).toBeDefined();

    const withBlock = generatePickupSlots({
      ...options,
      unavailableSlots: [target?.time ?? ''],
    });
    expect(withBlock.find((slot) => slot.label === '10:30 AM')?.available).toBe(false);
  });

  it('suppresses ASAP when the cafe is at capacity', () => {
    const slots = generatePickupSlots({ ...options, allowAsap: false });
    expect(slots.some((slot) => slot.isAsap)).toBe(false);
  });

  it('respects the maximum slot count', () => {
    const slots = generatePickupSlots({ ...options, maxAheadMinutes: 24 * 60, maxSlots: 6 });
    expect(slots).toHaveLength(6);
  });
});

describe('isValidPickupTime', () => {
  const options = {
    now: sundayMorning,
    schedule: schedule(),
    leadTimeMinutes: 10,
    intervalMinutes: 15,
    maxAheadMinutes: 180,
  };

  it('accepts a slot the picker would have offered', () => {
    expect(isValidPickupTime(new Date('2026-09-06T05:30:00Z'), options)).toBe(true);
  });

  it('rejects a time inside the lead window', () => {
    expect(isValidPickupTime(new Date('2026-09-06T05:02:00Z'), options)).toBe(false);
  });

  it('rejects a time in the past', () => {
    expect(isValidPickupTime(new Date('2026-09-06T04:00:00Z'), options)).toBe(false);
  });

  it('rejects a time beyond the scheduling horizon', () => {
    expect(isValidPickupTime(new Date('2026-09-07T05:00:00Z'), options)).toBe(false);
  });

  it('rejects a time when the cafe is shut', () => {
    expect(
      isValidPickupTime(new Date('2026-09-06T19:00:00Z'), {
        ...options,
        maxAheadMinutes: 24 * 60,
      }),
    ).toBe(false);
  });
});
