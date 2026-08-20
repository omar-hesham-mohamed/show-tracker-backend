import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FollowService } from './follow.service';
import { encodeCursor } from '../common/pagination/cursor.util';

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    username: 'sam',
    displayName: 'Sam',
    avatarUrl: null,
    isPrivate: false,
    ...overrides,
  };
}

describe('FollowService', () => {
  let prisma: {
    user: { findUnique: jest.Mock };
    follow: {
      upsert: jest.Mock;
      deleteMany: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
  };
  let service: FollowService;

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn() },
      follow: {
        upsert: jest.fn(),
        deleteMany: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
    };
    service = new FollowService(prisma as any);
  });

  // ---------------------------------------------------------------------
  // follow / unfollow
  // ---------------------------------------------------------------------
  describe('follow', () => {
    it('resolves the username case-insensitively and upserts idempotently (atomic, not check-then-create)', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser({ id: 'user-2' }));

      await service.follow('user-1', 'Sam');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { username: 'sam' },
      });
      expect(prisma.follow.upsert).toHaveBeenCalledWith({
        where: {
          followerId_followeeId: { followerId: 'user-1', followeeId: 'user-2' },
        },
        create: { followerId: 'user-1', followeeId: 'user-2' },
        update: {},
      });
    });

    it('404s on an unknown username', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.follow('user-1', 'nobody')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.follow.upsert).not.toHaveBeenCalled();
    });

    it('400s attempting to follow self', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser({ id: 'user-1' }));

      await expect(service.follow('user-1', 'sam')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.follow.upsert).not.toHaveBeenCalled();
    });
  });

  describe('unfollow', () => {
    it('resolves the username and deletes (idempotent by construction)', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser({ id: 'user-2' }));
      prisma.follow.deleteMany.mockResolvedValue({ count: 0 });

      await service.unfollow('user-1', 'sam');

      expect(prisma.follow.deleteMany).toHaveBeenCalledWith({
        where: { followerId: 'user-1', followeeId: 'user-2' },
      });
    });

    it('404s on an unknown username', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.unfollow('user-1', 'nobody')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ---------------------------------------------------------------------
  // canView — the shared privacy predicate
  // ---------------------------------------------------------------------
  describe('canView', () => {
    it('is always true for a public target, regardless of viewer', async () => {
      const target = makeUser({ isPrivate: false });
      expect(await service.canView(null, target)).toBe(true);
      expect(await service.canView('someone-else', target)).toBe(true);
      expect(prisma.follow.findUnique).not.toHaveBeenCalled();
    });

    it('is true for the target viewing their own private profile (self-view bypass)', async () => {
      const target = makeUser({ id: 'user-1', isPrivate: true });
      expect(await service.canView('user-1', target)).toBe(true);
      expect(prisma.follow.findUnique).not.toHaveBeenCalled();
    });

    it('is false for an anonymous viewer on a private target', async () => {
      const target = makeUser({ isPrivate: true });
      expect(await service.canView(null, target)).toBe(false);
      expect(prisma.follow.findUnique).not.toHaveBeenCalled();
    });

    it('is true when the viewer follows a private target', async () => {
      const target = makeUser({ id: 'user-2', isPrivate: true });
      prisma.follow.findUnique.mockResolvedValue({
        followerId: 'user-1',
        followeeId: 'user-2',
      });

      expect(await service.canView('user-1', target)).toBe(true);
      expect(prisma.follow.findUnique).toHaveBeenCalledWith({
        where: {
          followerId_followeeId: { followerId: 'user-1', followeeId: 'user-2' },
        },
      });
    });

    it('is false when an authenticated viewer does not follow a private target', async () => {
      const target = makeUser({ id: 'user-2', isPrivate: true });
      prisma.follow.findUnique.mockResolvedValue(null);

      expect(await service.canView('user-1', target)).toBe(false);
    });
  });

  describe('getFollowCounts', () => {
    it('computes followerCount from followeeId and followingCount from followerId', async () => {
      prisma.follow.count.mockResolvedValueOnce(10).mockResolvedValueOnce(8);

      const result = await service.getFollowCounts('user-1');

      expect(result).toEqual({ followerCount: 10, followingCount: 8 });
      expect(prisma.follow.count).toHaveBeenNthCalledWith(1, {
        where: { followeeId: 'user-1' },
      });
      expect(prisma.follow.count).toHaveBeenNthCalledWith(2, {
        where: { followerId: 'user-1' },
      });
    });
  });

  // ---------------------------------------------------------------------
  // getFollowers / getFollowing — pagination + privacy gating
  // ---------------------------------------------------------------------
  describe('getFollowers', () => {
    const target = makeUser({ id: 'target-1', isPrivate: false });

    it('returns an empty list without querying Follow when gated (private, viewer does not follow)', async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ id: 'target-1', isPrivate: true }),
      );
      prisma.follow.findUnique.mockResolvedValue(null); // canView's own lookup

      const result = await service.getFollowers('sam', 'viewer-1', {
        limit: 20,
      });

      expect(result).toEqual({ items: [], nextCursor: null });
      expect(prisma.follow.findMany).not.toHaveBeenCalled();
    });

    it('queries followeeId = target, includes follower, orders by (createdAt desc, followerId desc)', async () => {
      prisma.user.findUnique.mockResolvedValue(target);
      prisma.follow.findMany.mockResolvedValue([]);

      await service.getFollowers('sam', null, { limit: 20 });

      expect(prisma.follow.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { followeeId: 'target-1' },
          include: { follower: true },
          orderBy: [{ createdAt: 'desc' }, { followerId: 'desc' }],
          take: 21,
        }),
      );
    });

    it('maps rows to list items and computes isFollowedByMe via one batched query, not per-item', async () => {
      prisma.user.findUnique.mockResolvedValue(target);
      const followerUsers = [
        makeUser({ id: 'u2', username: 'alice' }),
        makeUser({ id: 'u3', username: 'bob' }),
      ];
      prisma.follow.findMany
        .mockResolvedValueOnce(
          followerUsers.map((u, i) => ({
            createdAt: new Date(`2026-08-0${7 - i}T00:00:00.000Z`),
            followerId: u.id,
            follower: u,
          })),
        )
        .mockResolvedValueOnce([{ followeeId: 'u2' }]); // viewer follows only u2

      const result = await service.getFollowers('sam', 'viewer-1', {
        limit: 20,
      });

      // Exactly one batched call for isFollowedByMe, covering both page items.
      expect(prisma.follow.findMany).toHaveBeenCalledTimes(2);
      expect(prisma.follow.findMany).toHaveBeenNthCalledWith(2, {
        where: { followerId: 'viewer-1', followeeId: { in: ['u2', 'u3'] } },
        select: { followeeId: true },
      });

      expect(result.items).toEqual([
        {
          id: 'u2',
          username: 'alice',
          displayName: 'Sam',
          avatarUrl: null,
          isFollowedByMe: true,
        },
        {
          id: 'u3',
          username: 'bob',
          displayName: 'Sam',
          avatarUrl: null,
          isFollowedByMe: false,
        },
      ]);
    });

    it('skips the batched isFollowedByMe query entirely for an anonymous viewer', async () => {
      prisma.user.findUnique.mockResolvedValue(target);
      prisma.follow.findMany.mockResolvedValue([
        {
          createdAt: new Date(),
          followerId: 'u2',
          follower: makeUser({ id: 'u2' }),
        },
      ]);

      await service.getFollowers('sam', null, { limit: 20 });

      expect(prisma.follow.findMany).toHaveBeenCalledTimes(1);
    });

    it('returns a nextCursor when more rows exist than the page limit', async () => {
      prisma.user.findUnique.mockResolvedValue(target);
      const rows = Array.from({ length: 3 }, (_, i) => ({
        createdAt: new Date(`2026-08-0${7 - i}T00:00:00.000Z`),
        followerId: `u${i}`,
        follower: makeUser({ id: `u${i}` }),
      }));
      prisma.follow.findMany.mockResolvedValue(rows);

      const result = await service.getFollowers('sam', null, {
        limit: 2,
      });

      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).toEqual(expect.any(String));
    });

    it('rejects a malformed cursor', async () => {
      prisma.user.findUnique.mockResolvedValue(target);
      const badCursor = encodeCursor({ createdAt: 'not-a-date', id: 'u1' });

      await expect(
        service.getFollowers('sam', null, {
          cursor: badCursor,
          limit: 20,
        } as any),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.follow.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getFollowing', () => {
    it('queries followerId = target, includes followee, orders by followeeId', async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ id: 'target-1', isPrivate: false }),
      );
      prisma.follow.findMany.mockResolvedValue([]);

      await service.getFollowing('sam', null, { limit: 20 });

      expect(prisma.follow.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { followerId: 'target-1' },
          include: { followee: true },
          orderBy: [{ createdAt: 'desc' }, { followeeId: 'desc' }],
        }),
      );
    });

    it('returns an empty list when gated', async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ id: 'target-1', isPrivate: true }),
      );
      prisma.follow.findUnique.mockResolvedValue(null);

      const result = await service.getFollowing('sam', null, {
        limit: 20,
      });

      expect(result).toEqual({ items: [], nextCursor: null });
    });
  });
});
