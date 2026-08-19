import { daysBetween, getDisplayedCurrentStreak } from './streak.util';

describe('daysBetween', () => {
  it('is 0 for the same date', () => {
    const d = new Date('2026-08-07T00:00:00.000Z');
    expect(daysBetween(d, d)).toBe(0);
  });

  it('is 1 for consecutive days', () => {
    expect(
      daysBetween(
        new Date('2026-08-07T00:00:00.000Z'),
        new Date('2026-08-08T00:00:00.000Z'),
      ),
    ).toBe(1);
  });

  it('handles a month rollover correctly (Jan 31 -> Feb 1 is 1 day)', () => {
    expect(
      daysBetween(
        new Date('2026-01-31T00:00:00.000Z'),
        new Date('2026-02-01T00:00:00.000Z'),
      ),
    ).toBe(1);
  });

  it('handles a year rollover correctly (Dec 31 -> Jan 1 is 1 day)', () => {
    expect(
      daysBetween(
        new Date('2026-12-31T00:00:00.000Z'),
        new Date('2027-01-01T00:00:00.000Z'),
      ),
    ).toBe(1);
  });

  it('handles a leap day correctly (2028 is a leap year: Feb 28 -> Feb 29 -> Mar 1, each 1 day)', () => {
    expect(
      daysBetween(
        new Date('2028-02-28T00:00:00.000Z'),
        new Date('2028-02-29T00:00:00.000Z'),
      ),
    ).toBe(1);
    expect(
      daysBetween(
        new Date('2028-02-29T00:00:00.000Z'),
        new Date('2028-03-01T00:00:00.000Z'),
      ),
    ).toBe(1);
  });

  it('does not misfire a leap-day gap in a non-leap year (2026: Feb 28 -> Mar 1 is 1 day, no Feb 29 exists)', () => {
    expect(
      daysBetween(
        new Date('2026-02-28T00:00:00.000Z'),
        new Date('2026-03-01T00:00:00.000Z'),
      ),
    ).toBe(1);
  });

  it('is negative when b is before a', () => {
    expect(
      daysBetween(
        new Date('2026-08-08T00:00:00.000Z'),
        new Date('2026-08-07T00:00:00.000Z'),
      ),
    ).toBe(-1);
  });
});

describe('getDisplayedCurrentStreak', () => {
  const now = new Date('2026-08-19T15:00:00.000Z');

  it('returns 0 when lastStreakDate is null (never logged anything)', () => {
    expect(getDisplayedCurrentStreak(5, null, now)).toBe(0);
  });

  it('passes through unchanged when lastStreakDate is today', () => {
    expect(
      getDisplayedCurrentStreak(5, new Date('2026-08-19T00:00:00.000Z'), now),
    ).toBe(5);
  });

  it('passes through unchanged when lastStreakDate is yesterday (grace period — today is not over yet)', () => {
    expect(
      getDisplayedCurrentStreak(5, new Date('2026-08-18T00:00:00.000Z'), now),
    ).toBe(5);
  });

  it('returns 0 when a full day was missed (lastStreakDate is 2 days ago)', () => {
    expect(
      getDisplayedCurrentStreak(5, new Date('2026-08-17T00:00:00.000Z'), now),
    ).toBe(0);
  });

  it('returns 0 when the streak has been stale for weeks', () => {
    expect(
      getDisplayedCurrentStreak(5, new Date('2026-07-01T00:00:00.000Z'), now),
    ).toBe(0);
  });

  it('is not fooled by the time-of-day component of `now` — only the calendar date matters', () => {
    const lateNight = new Date('2026-08-19T23:59:00.000Z');
    const earlyMorning = new Date('2026-08-19T00:01:00.000Z');
    const yesterday = new Date('2026-08-18T00:00:00.000Z');
    expect(getDisplayedCurrentStreak(5, yesterday, lateNight)).toBe(5);
    expect(getDisplayedCurrentStreak(5, yesterday, earlyMorning)).toBe(5);
  });
});
