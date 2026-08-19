/**
 * Whole calendar days between two UTC-midnight dates (b - a). Every date
 * this function ever receives is already UTC-midnight — WatchLogEntry.watchedAt
 * is always written as `${date}T00:00:00.000Z` (watch-log.service.ts), and
 * getDisplayedCurrentStreak below normalizes `now` the same way — so this
 * division is exact, no DST edge cases (UTC has no DST).
 */
export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/**
 * "Denormalized counters updated on write, not derived live" (plan.md) means
 * a user who stops logging would otherwise see their old streak number
 * indefinitely — a 5-day streak silently sitting at "5" for weeks is
 * actively misleading, not just a minor edge case. This is a cheap,
 * non-persisted read-time correction applied only where a *stored* streak
 * value is displayed (GET /users/me) — never to streakAfterWrite, whose
 * value is always fresh as of the moment StreakService computes it.
 *
 * Uses the server's own UTC "today" for the comparison — the same
 * honor-system-level looseness already accepted for the future-date sanity
 * check (Phase 4, assertNotSpoofedFutureDate), not full per-user-timezone
 * precision (plan.md's deferred server-timezone hardening item).
 */
export function getDisplayedCurrentStreak(
  currentStreakCount: number,
  lastStreakDate: Date | null,
  now: Date = new Date(),
): number {
  if (!lastStreakDate) {
    return 0;
  }
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  // 0 = logged today, 1 = logged yesterday (grace period — today isn't over
  // yet). 2+ means at least one full day was missed entirely.
  return daysBetween(lastStreakDate, today) <= 1 ? currentStreakCount : 0;
}
