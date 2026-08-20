import { NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';

const baseUser = {
  id: 'user-1',
  username: 'mazen',
  email: 'a@b.com',
  displayName: 'Mazen',
  avatarUrl: null,
  bio: '',
  timezone: 'Africa/Cairo',
  isPrivate: false,
  currentStreakCount: 5,
  longestStreakCount: 12,
  lastStreakDate: new Date('2026-08-19T00:00:00.000Z'),
  passwordHash: 'hashed',
  deletedAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-19T00:00:00.000Z'),
};

describe('UsersService', () => {
  let prisma: {
    user: {
      findUniqueOrThrow: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    follow: { findUnique: jest.Mock };
  };
  let followService: {
    getFollowCounts: jest.Mock;
    canView: jest.Mock;
  };
  let service: UsersService;

  beforeEach(() => {
    prisma = {
      user: {
        findUniqueOrThrow: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      follow: { findUnique: jest.fn() },
    };
    followService = {
      getFollowCounts: jest
        .fn()
        .mockResolvedValue({ followerCount: 0, followingCount: 0 }),
      canView: jest.fn().mockResolvedValue(true),
    };
    service = new UsersService(prisma as any, followService as any);
  });

  // ---------------------------------------------------------------------
  // getMe
  // ---------------------------------------------------------------------
  describe('getMe', () => {
    it('maps the User row and follow counts into the documented profile shape', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue(baseUser);
      followService.getFollowCounts.mockResolvedValue({
        followerCount: 10,
        followingCount: 8,
      });

      const result = await service.getMe('user-1');

      expect(result).toEqual({
        id: 'user-1',
        username: 'mazen',
        email: 'a@b.com',
        displayName: 'Mazen',
        avatarUrl: null,
        bio: '',
        timezone: 'Africa/Cairo',
        isPrivate: false,
        currentStreakCount: 5,
        longestStreakCount: 12,
        lastStreakDate: '2026-08-19',
        followerCount: 10,
        followingCount: 8,
        createdAt: baseUser.createdAt.toISOString(),
      });
      expect(followService.getFollowCounts).toHaveBeenCalledWith('user-1');
    });

    it('never leaks passwordHash', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue(baseUser);

      const result = await service.getMe('user-1');

      expect(result).not.toHaveProperty('passwordHash');
    });

    it('applies the read-time freshness correction to a stale streak (last logged 3+ days ago)', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        ...baseUser,
        currentStreakCount: 5,
        lastStreakDate: new Date('2020-01-01T00:00:00.000Z'),
      });

      const result = await service.getMe('user-1');

      expect(result.currentStreakCount).toBe(0);
      expect(result.longestStreakCount).toBe(12); // untouched — historical achievement
      expect(result.lastStreakDate).toBe('2020-01-01'); // stays truthful
    });

    it('returns 0 for currentStreakCount when lastStreakDate is null (never logged anything)', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        ...baseUser,
        currentStreakCount: 0,
        lastStreakDate: null,
      });

      const result = await service.getMe('user-1');

      expect(result.currentStreakCount).toBe(0);
      expect(result.lastStreakDate).toBeNull();
    });
  });

  // ---------------------------------------------------------------------
  // updateMe
  // ---------------------------------------------------------------------
  describe('updateMe', () => {
    it('applies a partial patch and returns the same shape as getMe', async () => {
      prisma.user.update.mockResolvedValue({
        ...baseUser,
        displayName: 'Mazen A.',
        bio: 'watching too much TV',
      });

      const result = await service.updateMe('user-1', {
        displayName: 'Mazen A.',
        bio: 'watching too much TV',
      });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { displayName: 'Mazen A.', bio: 'watching too much TV' },
      });
      expect(result.displayName).toBe('Mazen A.');
      expect(result.bio).toBe('watching too much TV');
    });

    it('applies an isPrivate toggle', async () => {
      prisma.user.update.mockResolvedValue({ ...baseUser, isPrivate: true });

      await service.updateMe('user-1', { isPrivate: true });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { isPrivate: true },
      });
    });

    it('sends an empty data object for a fully-omitted patch', async () => {
      prisma.user.update.mockResolvedValue(baseUser);

      await service.updateMe('user-1', {});

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {},
      });
    });
  });

  // ---------------------------------------------------------------------
  // getPublicProfile
  // ---------------------------------------------------------------------
  describe('getPublicProfile', () => {
    it('404s on an unknown username', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getPublicProfile('nobody', null)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns the full public shape for a public profile, omitting email/timezone/lastStreakDate', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        id: 'user-2',
        username: 'sam',
      });
      prisma.follow.findUnique.mockResolvedValue(null); // no follow edges either direction
      followService.canView.mockResolvedValue(true);
      followService.getFollowCounts.mockResolvedValue({
        followerCount: 40,
        followingCount: 12,
      });

      const result = await service.getPublicProfile('sam', 'viewer-1');

      expect(result).toEqual({
        id: 'user-2',
        username: 'sam',
        displayName: 'Mazen',
        avatarUrl: null,
        bio: '',
        isPrivate: false,
        currentStreakCount: 5,
        longestStreakCount: 12,
        followerCount: 40,
        followingCount: 12,
        isFollowedByMe: false,
        followsMe: false,
      });
      expect(result).not.toHaveProperty('email');
      expect(result).not.toHaveProperty('timezone');
      expect(result).not.toHaveProperty('lastStreakDate');
    });

    it('returns the minimal stub for a private profile the viewer cannot see', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        id: 'user-2',
        username: 'sam',
        isPrivate: true,
      });
      prisma.follow.findUnique.mockResolvedValue(null);
      followService.canView.mockResolvedValue(false);

      const result = await service.getPublicProfile('sam', 'viewer-1');

      expect(result).toEqual({
        id: 'user-2',
        username: 'sam',
        displayName: 'Mazen',
        avatarUrl: null,
        isPrivate: true,
        isFollowedByMe: false,
      });
      expect(result).not.toHaveProperty('currentStreakCount');
      expect(followService.getFollowCounts).not.toHaveBeenCalled();
    });

    it('returns the full shape for the target viewing their own private profile (self-view bypass)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        id: 'user-1',
        username: 'mazen',
        isPrivate: true,
      });
      prisma.follow.findUnique.mockResolvedValue(null);
      followService.canView.mockResolvedValue(true); // canView itself handles self-bypass

      const result = await service.getPublicProfile('mazen', 'user-1');

      expect(result).toHaveProperty('currentStreakCount');
    });

    it('computes isFollowedByMe/followsMe independently from real Follow edges', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        id: 'user-2',
        username: 'sam',
      });
      // viewer->target edge exists, target->viewer edge does not
      prisma.follow.findUnique
        .mockResolvedValueOnce({ followerId: 'viewer-1', followeeId: 'user-2' })
        .mockResolvedValueOnce(null);
      followService.canView.mockResolvedValue(true);

      const result = await service.getPublicProfile('sam', 'viewer-1');

      expect(result).toMatchObject({ isFollowedByMe: true, followsMe: false });
    });

    it('reports false for both follow flags when the caller is anonymous', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        id: 'user-2',
        username: 'sam',
      });
      followService.canView.mockResolvedValue(true);

      const result = await service.getPublicProfile('sam', null);

      expect(result).toMatchObject({ isFollowedByMe: false, followsMe: false });
      expect(prisma.follow.findUnique).not.toHaveBeenCalled();
    });
  });
});
