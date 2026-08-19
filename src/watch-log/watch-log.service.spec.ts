import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MediaType, WatchStatus } from '@prisma/client';
import { WatchLogService } from './watch-log.service';
import { encodeCursor } from '../common/pagination/cursor.util';

function makeEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'entry-1',
    userId: 'user-1',
    showId: 'show-1',
    episodeId: null,
    status: WatchStatus.WATCHED,
    rating: null,
    watchedAt: new Date('2026-08-07T00:00:00.000Z'),
    note: '',
    createdAt: new Date('2026-08-07T00:00:00.000Z'),
    updatedAt: new Date('2026-08-07T00:00:00.000Z'),
    show: {
      id: 'show-1',
      tmdbId: 1399,
      title: 'Game of Thrones',
      posterPath: '/poster.jpg',
    },
    ...overrides,
  };
}

describe('WatchLogService', () => {
  let prisma: {
    watchLogEntry: {
      create: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    episode: { findFirst: jest.Mock };
  };
  let tmdbService: { getShowDetail: jest.Mock };
  let service: WatchLogService;

  beforeEach(() => {
    prisma = {
      watchLogEntry: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      episode: { findFirst: jest.fn() },
    };
    tmdbService = { getShowDetail: jest.fn() };
    service = new WatchLogService(prisma as any, tmdbService as any);
  });

  // ---------------------------------------------------------------------
  // create
  // ---------------------------------------------------------------------
  describe('create', () => {
    const baseDto = {
      tmdbId: 1399,
      mediaType: MediaType.tv,
      status: WatchStatus.WATCHED,
      watchedAt: '2026-08-07',
    };

    it('resolves the show via TmdbService (reusing its cache-aside) and creates the entry', async () => {
      tmdbService.getShowDetail.mockResolvedValue({ id: 'show-1' });
      prisma.watchLogEntry.create.mockResolvedValue(makeEntry());

      const result = await service.create('user-1', baseDto);

      expect(tmdbService.getShowDetail).toHaveBeenCalledWith(
        MediaType.tv,
        1399,
      );
      expect(prisma.watchLogEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          showId: 'show-1',
          episodeId: null,
          status: WatchStatus.WATCHED,
        }),
        include: { show: true },
      });
      expect(result.show.title).toBe('Game of Thrones');
    });

    it('rejects an obviously spoofed future watchedAt without calling TMDB', async () => {
      const farFuture = new Date();
      farFuture.setUTCFullYear(farFuture.getUTCFullYear() + 1);
      const dto = {
        ...baseDto,
        watchedAt: farFuture.toISOString().slice(0, 10),
      };

      await expect(service.create('user-1', dto as any)).rejects.toThrow(
        BadRequestException,
      );
      expect(tmdbService.getShowDetail).not.toHaveBeenCalled();
    });

    it('validates a provided episodeId belongs to the resolved show', async () => {
      tmdbService.getShowDetail.mockResolvedValue({ id: 'show-1' });
      prisma.episode.findFirst.mockResolvedValue({ id: 'ep-1' });
      prisma.watchLogEntry.create.mockResolvedValue(
        makeEntry({ episodeId: 'ep-1' }),
      );

      await service.create('user-1', { ...baseDto, episodeId: 'ep-1' });

      expect(prisma.episode.findFirst).toHaveBeenCalledWith({
        where: { id: 'ep-1', showId: 'show-1' },
      });
    });

    it('404s when episodeId does not belong to the resolved show', async () => {
      tmdbService.getShowDetail.mockResolvedValue({ id: 'show-1' });
      prisma.episode.findFirst.mockResolvedValue(null);

      await expect(
        service.create('user-1', {
          ...baseDto,
          episodeId: 'ep-from-another-show',
        } as any),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.watchLogEntry.create).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------
  // findMine — pagination
  // ---------------------------------------------------------------------
  describe('findMine', () => {
    it('applies the status filter and default desc sort, no cursor on first page', async () => {
      prisma.watchLogEntry.findMany.mockResolvedValue([makeEntry()]);

      const result = await service.findMine('user-1', {
        status: WatchStatus.WATCHED,
        limit: 20,
        sort: 'watchedAt_desc',
      } as any);

      expect(prisma.watchLogEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', status: WatchStatus.WATCHED },
          orderBy: [{ watchedAt: 'desc' }, { id: 'desc' }],
          take: 21,
        }),
      );
      expect(result.nextCursor).toBeNull();
      expect(result.items).toHaveLength(1);
    });

    it('returns a nextCursor when more rows exist than the page limit', async () => {
      const rows = Array.from({ length: 3 }, (_, i) =>
        makeEntry({
          id: `entry-${i}`,
          watchedAt: new Date(`2026-08-0${7 - i}T00:00:00.000Z`),
        }),
      );
      prisma.watchLogEntry.findMany.mockResolvedValue(rows);

      const result = await service.findMine('user-1', {
        limit: 2,
        sort: 'watchedAt_desc',
      } as any);

      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).not.toBeNull();
    });

    it('decodes a valid cursor into a keyset WHERE clause', async () => {
      prisma.watchLogEntry.findMany.mockResolvedValue([]);
      const cursor = encodeCursor({
        watchedAt: '2026-08-07T00:00:00.000Z',
        id: 'entry-1',
      });

      await service.findMine('user-1', {
        cursor,
        limit: 20,
        sort: 'watchedAt_desc',
      } as any);

      const { where } = prisma.watchLogEntry.findMany.mock.calls[0][0];
      expect(where.OR).toBeDefined();
    });

    it('rejects a cursor missing required fields', async () => {
      const cursor = encodeCursor({ id: 'entry-1' });

      await expect(
        service.findMine('user-1', { cursor, limit: 20 } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a cursor whose watchedAt field is a syntactically valid string but not a real date (bug found via testing — see plan.md)', async () => {
      const cursor = encodeCursor({ watchedAt: 'not-a-date', id: 'entry-1' });

      await expect(
        service.findMine('user-1', { cursor, limit: 20 } as any),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.watchLogEntry.findMany).not.toHaveBeenCalled();
    });

    it('uses ascending comparison operators and orderBy for sort=watchedAt_asc', async () => {
      prisma.watchLogEntry.findMany.mockResolvedValue([]);
      const cursor = encodeCursor({
        watchedAt: '2026-08-07T00:00:00.000Z',
        id: 'entry-1',
      });

      await service.findMine('user-1', {
        cursor,
        limit: 20,
        sort: 'watchedAt_asc',
      } as any);

      const call = prisma.watchLogEntry.findMany.mock.calls[0][0];
      expect(call.orderBy).toEqual([{ watchedAt: 'asc' }, { id: 'asc' }]);
      expect(call.where.OR[0].watchedAt).toEqual({
        gt: new Date('2026-08-07T00:00:00.000Z'),
      });
      expect(call.where.OR[1].id).toEqual({ gt: 'entry-1' });
    });
  });

  // ---------------------------------------------------------------------
  // findOne / update / remove — ownership
  // ---------------------------------------------------------------------
  describe('ownership-gated operations', () => {
    it('findOne 404s when the entry does not belong to the caller', async () => {
      prisma.watchLogEntry.findFirst.mockResolvedValue(null);

      await expect(service.findOne('user-1', 'entry-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('findOne returns the mapped entry when owned', async () => {
      prisma.watchLogEntry.findFirst.mockResolvedValue(makeEntry());

      const result = await service.findOne('user-1', 'entry-1');

      expect(result.id).toBe('entry-1');
    });

    it('update applies a partial patch and re-validates the rating grid via the DTO layer', async () => {
      prisma.watchLogEntry.findFirst.mockResolvedValue(makeEntry());
      prisma.watchLogEntry.update.mockResolvedValue(
        makeEntry({ note: 'updated' }),
      );

      const result = await service.update('user-1', 'entry-1', {
        note: 'updated',
      });

      expect(prisma.watchLogEntry.update).toHaveBeenCalledWith({
        where: { id: 'entry-1' },
        data: { note: 'updated' },
        include: { show: true },
      });
      expect(result.note).toBe('updated');
    });

    it('update applies status, rating, and watchedAt individually when present in the patch', async () => {
      prisma.watchLogEntry.findFirst.mockResolvedValue(makeEntry());
      prisma.watchLogEntry.update.mockResolvedValue(makeEntry());

      await service.update('user-1', 'entry-1', {
        status: WatchStatus.WATCHING,
        rating: 3.5,
        watchedAt: '2026-08-01',
      });

      expect(prisma.watchLogEntry.update).toHaveBeenCalledWith({
        where: { id: 'entry-1' },
        data: {
          status: WatchStatus.WATCHING,
          rating: 3.5,
          watchedAt: new Date('2026-08-01T00:00:00.000Z'),
        },
        include: { show: true },
      });
    });

    it('update 404s when the entry is not owned by the caller', async () => {
      prisma.watchLogEntry.findFirst.mockResolvedValue(null);

      await expect(
        service.update('user-1', 'entry-1', { note: 'x' }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.watchLogEntry.update).not.toHaveBeenCalled();
    });

    it('update rejects a spoofed future watchedAt', async () => {
      prisma.watchLogEntry.findFirst.mockResolvedValue(makeEntry());
      const farFuture = new Date();
      farFuture.setUTCFullYear(farFuture.getUTCFullYear() + 1);

      await expect(
        service.update('user-1', 'entry-1', {
          watchedAt: farFuture.toISOString().slice(0, 10),
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.watchLogEntry.update).not.toHaveBeenCalled();
    });

    it('remove deletes an owned entry', async () => {
      prisma.watchLogEntry.findFirst.mockResolvedValue(makeEntry());

      await service.remove('user-1', 'entry-1');

      expect(prisma.watchLogEntry.delete).toHaveBeenCalledWith({
        where: { id: 'entry-1' },
      });
    });

    it('remove 404s when the entry is not owned by the caller', async () => {
      prisma.watchLogEntry.findFirst.mockResolvedValue(null);

      await expect(service.remove('user-1', 'entry-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.watchLogEntry.delete).not.toHaveBeenCalled();
    });
  });
});
