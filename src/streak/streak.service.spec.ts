import { WatchStatus } from '@prisma/client';
import { StreakService } from './streak.service';

function watchedDates(...isoDates: string[]) {
  return isoDates.map((d) => ({ watchedAt: new Date(`${d}T00:00:00.000Z`) }));
}

describe('StreakService', () => {
  let prisma: {
    watchLogEntry: { findMany: jest.Mock };
    user: { findUniqueOrThrow: jest.Mock; update: jest.Mock };
  };
  let service: StreakService;

  beforeEach(() => {
    prisma = {
      watchLogEntry: { findMany: jest.fn() },
      user: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ longestStreakCount: 0 }),
        update: jest.fn(),
      },
    };
    service = new StreakService(prisma as any);
  });

  it('queries distinct WATCHED dates, ascending', async () => {
    prisma.watchLogEntry.findMany.mockResolvedValue([]);

    await service.recomputeStreak('user-1');

    expect(prisma.watchLogEntry.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', status: WatchStatus.WATCHED },
      distinct: ['watchedAt'],
      select: { watchedAt: true },
      orderBy: { watchedAt: 'asc' },
    });
  });

  it('with no WATCHED entries, resets current to 0 and lastStreakDate to null, leaving longestStreakCount untouched (monotonic)', async () => {
    prisma.watchLogEntry.findMany.mockResolvedValue([]);
    prisma.user.findUniqueOrThrow.mockResolvedValue({ longestStreakCount: 7 });

    const result = await service.recomputeStreak('user-1');

    expect(result).toEqual({
      currentStreakCount: 0,
      longestStreakCount: 7,
      lastStreakDate: null,
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        currentStreakCount: 0,
        longestStreakCount: 7,
        lastStreakDate: null,
      },
    });
  });

  it('a single watched day is a streak of 1', async () => {
    prisma.watchLogEntry.findMany.mockResolvedValue(watchedDates('2026-08-07'));

    const result = await service.recomputeStreak('user-1');

    expect(result.currentStreakCount).toBe(1);
    expect(result.longestStreakCount).toBe(1);
    expect(result.lastStreakDate).toEqual(new Date('2026-08-07T00:00:00.000Z'));
  });

  it('consecutive days increment the current streak', async () => {
    prisma.watchLogEntry.findMany.mockResolvedValue(
      watchedDates('2026-08-05', '2026-08-06', '2026-08-07'),
    );

    const result = await service.recomputeStreak('user-1');

    expect(result.currentStreakCount).toBe(3);
    expect(result.longestStreakCount).toBe(3);
  });

  it('a gap resets the run ending at the most recent date, but the longest run seen anywhere is still reported', async () => {
    // Aug 1-3 is a 3-day run, then a gap, then Aug 6 alone (1-day run).
    prisma.watchLogEntry.findMany.mockResolvedValue(
      watchedDates('2026-08-01', '2026-08-02', '2026-08-03', '2026-08-06'),
    );

    const result = await service.recomputeStreak('user-1');

    expect(result.currentStreakCount).toBe(1); // run ending at Aug 6
    expect(result.longestStreakCount).toBe(3); // Aug 1-3, still the longest anywhere
    expect(result.lastStreakDate).toEqual(new Date('2026-08-06T00:00:00.000Z'));
  });

  it('backdating into an existing gap merges the runs on either side into one continuous streak', async () => {
    // What was Aug1-2 + [gap at Aug3] + Aug4-5 becomes one 5-day run once
    // Aug3 exists — recomputeStreak just reads whatever WATCHED dates exist
    // right now, so this is the same code path as any other consecutive run.
    prisma.watchLogEntry.findMany.mockResolvedValue(
      watchedDates(
        '2026-08-01',
        '2026-08-02',
        '2026-08-03',
        '2026-08-04',
        '2026-08-05',
      ),
    );

    const result = await service.recomputeStreak('user-1');

    expect(result.currentStreakCount).toBe(5);
    expect(result.longestStreakCount).toBe(5);
  });

  it('multiple entries collapse to the same date via distinct — verified by the query args above, not re-derivable from findMany results alone', async () => {
    // distinct: ['watchedAt'] is asserted in the first test; this test just
    // confirms the algorithm treats a single date entry as one day.
    prisma.watchLogEntry.findMany.mockResolvedValue(watchedDates('2026-08-07'));

    const result = await service.recomputeStreak('user-1');

    expect(result.currentStreakCount).toBe(1);
  });

  it('longestStreakCount is monotonic — a lower freshly-computed value does not overwrite a higher stored one', async () => {
    prisma.watchLogEntry.findMany.mockResolvedValue(watchedDates('2026-08-07'));
    prisma.user.findUniqueOrThrow.mockResolvedValue({ longestStreakCount: 10 });

    const result = await service.recomputeStreak('user-1');

    expect(result.longestStreakCount).toBe(10);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ longestStreakCount: 10 }),
      }),
    );
  });

  it('longestStreakCount increases when the freshly-computed run exceeds the stored value', async () => {
    prisma.watchLogEntry.findMany.mockResolvedValue(
      watchedDates(
        '2026-08-01',
        '2026-08-02',
        '2026-08-03',
        '2026-08-04',
        '2026-08-05',
      ),
    );
    prisma.user.findUniqueOrThrow.mockResolvedValue({ longestStreakCount: 2 });

    const result = await service.recomputeStreak('user-1');

    expect(result.longestStreakCount).toBe(5);
  });

  it('does not lower longestStreakCount even after deleting the entries that made up the historical best (monotonic across a "deletion" scenario)', async () => {
    // Simulates: user previously had a 10-day best (stored), then deleted
    // most of that history, leaving only a 2-day run today.
    prisma.watchLogEntry.findMany.mockResolvedValue(
      watchedDates('2026-08-06', '2026-08-07'),
    );
    prisma.user.findUniqueOrThrow.mockResolvedValue({ longestStreakCount: 10 });

    const result = await service.recomputeStreak('user-1');

    expect(result.currentStreakCount).toBe(2); // accurate to current data
    expect(result.longestStreakCount).toBe(10); // floor preserved
  });

  describe('date-boundary edge cases (plan.md explicitly asks for these)', () => {
    it('a run continues correctly across a month rollover', async () => {
      prisma.watchLogEntry.findMany.mockResolvedValue(
        watchedDates('2026-01-30', '2026-01-31', '2026-02-01', '2026-02-02'),
      );

      const result = await service.recomputeStreak('user-1');

      expect(result.currentStreakCount).toBe(4);
    });

    it('a run continues correctly across a year rollover', async () => {
      prisma.watchLogEntry.findMany.mockResolvedValue(
        watchedDates('2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'),
      );

      const result = await service.recomputeStreak('user-1');

      expect(result.currentStreakCount).toBe(4);
    });

    it('a run continues correctly across a leap day (2028 is a leap year)', async () => {
      prisma.watchLogEntry.findMany.mockResolvedValue(
        watchedDates('2028-02-28', '2028-02-29', '2028-03-01'),
      );

      const result = await service.recomputeStreak('user-1');

      expect(result.currentStreakCount).toBe(3);
    });

    it('correctly treats Feb 28 -> Mar 1 as a 1-day gap (not a break) in a non-leap year', async () => {
      prisma.watchLogEntry.findMany.mockResolvedValue(
        watchedDates('2026-02-27', '2026-02-28', '2026-03-01'),
      );

      const result = await service.recomputeStreak('user-1');

      expect(result.currentStreakCount).toBe(3);
    });
  });

  it('persists the recomputed snapshot onto the User row', async () => {
    prisma.watchLogEntry.findMany.mockResolvedValue(
      watchedDates('2026-08-06', '2026-08-07'),
    );
    prisma.user.findUniqueOrThrow.mockResolvedValue({ longestStreakCount: 0 });

    await service.recomputeStreak('user-1');

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        currentStreakCount: 2,
        longestStreakCount: 2,
        lastStreakDate: new Date('2026-08-07T00:00:00.000Z'),
      },
    });
  });

  it('accepts an explicit transaction client instead of the default injected PrismaService', async () => {
    const tx = {
      watchLogEntry: { findMany: jest.fn().mockResolvedValue([]) },
      user: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ longestStreakCount: 0 }),
        update: jest.fn(),
      },
    };

    await service.recomputeStreak('user-1', tx as any);

    expect(tx.watchLogEntry.findMany).toHaveBeenCalled();
    expect(prisma.watchLogEntry.findMany).not.toHaveBeenCalled();
  });
});
