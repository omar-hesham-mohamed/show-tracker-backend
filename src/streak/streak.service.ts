import { Injectable } from '@nestjs/common';
import { Prisma, WatchStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { daysBetween } from './streak.util';

export interface StreakSnapshot {
  currentStreakCount: number;
  longestStreakCount: number;
  lastStreakDate: Date | null;
}

export interface HeatmapDayDto {
  date: string;
  count: number;
}

type PrismaClientLike = PrismaService | Prisma.TransactionClient;

@Injectable()
export class StreakService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Always recomputes both counters from the user's actual WatchLogEntry
   * history, rather than incrementing/decrementing a running counter
   * (plan.md Phase 5 decision — deviates from the doc's originally-stated
   * 3-branch increment algorithm, which only handles a new forward-moving
   * log and can't correctly handle PATCH status/watchedAt changes or DELETE,
   * both of which endpoints.md already commits Phase 5 to). One algorithm,
   * uniformly correct for new days, gaps, backdating into an existing gap,
   * status toggling, and multiple entries on the same calendar day (which
   * collapses to one day via `distinct`). Cheap at this app's target scale.
   *
   * `client` defaults to the injected PrismaService but accepts a
   * transaction client so callers (WatchLogService) can wrap the watch-log
   * write and this recompute in a single `$transaction`.
   */
  async recomputeStreak(
    userId: string,
    client: PrismaClientLike = this.prisma,
  ): Promise<StreakSnapshot> {
    const rows = await client.watchLogEntry.findMany({
      where: { userId, status: WatchStatus.WATCHED },
      distinct: ['watchedAt'],
      select: { watchedAt: true },
      orderBy: { watchedAt: 'asc' },
    });

    let currentStreakCount = 0;
    let longestRun = 0;
    let lastStreakDate: Date | null = null;

    if (rows.length > 0) {
      let runLength = 1;
      longestRun = 1;
      for (let i = 1; i < rows.length; i++) {
        const gap = daysBetween(rows[i - 1].watchedAt, rows[i].watchedAt);
        runLength = gap === 1 ? runLength + 1 : 1;
        longestRun = Math.max(longestRun, runLength);
      }
      currentStreakCount = runLength;
      lastStreakDate = rows[rows.length - 1].watchedAt;
    }

    // longestStreakCount is monotonic (confirmed, deliberate product
    // choice — plan.md) — a personal best isn't erased by later editing or
    // deleting old diary entries, even if a strictly-accurate recompute
    // from the remaining data would now be lower.
    const existing = await client.user.findUniqueOrThrow({
      where: { id: userId },
      select: { longestStreakCount: true },
    });
    const longestStreakCount = Math.max(
      existing.longestStreakCount,
      longestRun,
    );

    await client.user.update({
      where: { id: userId },
      data: { currentStreakCount, longestStreakCount, lastStreakDate },
    });

    return { currentStreakCount, longestStreakCount, lastStreakDate };
  }

  /**
   * GitHub-style calendar heatmap — zero-filled for every day in the
   * trailing `days`-day range (confirmed, plan.md Phase 6), so the client
   * renders the array directly into a grid with no gap-filling of its own.
   * Uses the existing (userId, watchedAt desc) index — no new index needed.
   */
  async getHeatmap(userId: string, days = 365): Promise<HeatmapDayDto[]> {
    const now = new Date();
    const todayUtc = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const startDate = new Date(todayUtc);
    startDate.setUTCDate(startDate.getUTCDate() - (days - 1));

    const rows = await this.prisma.watchLogEntry.findMany({
      where: {
        userId,
        status: WatchStatus.WATCHED,
        watchedAt: { gte: startDate },
      },
      select: { watchedAt: true },
    });

    const counts = new Map<string, number>();
    for (const row of rows) {
      const key = row.watchedAt.toISOString().slice(0, 10);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const result: HeatmapDayDto[] = [];
    for (let i = 0; i < days; i++) {
      const day = new Date(startDate);
      day.setUTCDate(day.getUTCDate() + i);
      const key = day.toISOString().slice(0, 10);
      result.push({ date: key, count: counts.get(key) ?? 0 });
    }
    return result;
  }
}
