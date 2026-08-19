import { Injectable } from '@nestjs/common';
import { Prisma, WatchStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { daysBetween } from './streak.util';

export interface StreakSnapshot {
  currentStreakCount: number;
  longestStreakCount: number;
  lastStreakDate: Date | null;
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
}
