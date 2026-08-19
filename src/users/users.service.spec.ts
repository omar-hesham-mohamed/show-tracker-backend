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
    user: { findUniqueOrThrow: jest.Mock };
    follow: { count: jest.Mock };
  };
  let service: UsersService;

  beforeEach(() => {
    prisma = {
      user: { findUniqueOrThrow: jest.fn() },
      follow: { count: jest.fn() },
    };
    service = new UsersService(prisma as any);
  });

  it('maps the User row and follow counts into the documented profile shape', async () => {
    prisma.user.findUniqueOrThrow.mockResolvedValue(baseUser);
    prisma.follow.count.mockResolvedValueOnce(10).mockResolvedValueOnce(8);

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
  });

  it('never leaks passwordHash', async () => {
    prisma.user.findUniqueOrThrow.mockResolvedValue(baseUser);
    prisma.follow.count.mockResolvedValue(0);

    const result = await service.getMe('user-1');

    expect(result).not.toHaveProperty('passwordHash');
  });

  it('computes followerCount from followeeId and followingCount from followerId (not swapped)', async () => {
    prisma.user.findUniqueOrThrow.mockResolvedValue(baseUser);
    prisma.follow.count.mockResolvedValue(0);

    await service.getMe('user-1');

    expect(prisma.follow.count).toHaveBeenNthCalledWith(1, {
      where: { followeeId: 'user-1' },
    });
    expect(prisma.follow.count).toHaveBeenNthCalledWith(2, {
      where: { followerId: 'user-1' },
    });
  });

  it('returns 0/0 follow counts for a user nobody follows and who follows nobody', async () => {
    prisma.user.findUniqueOrThrow.mockResolvedValue(baseUser);
    prisma.follow.count.mockResolvedValue(0);

    const result = await service.getMe('user-1');

    expect(result.followerCount).toBe(0);
    expect(result.followingCount).toBe(0);
  });

  it('applies the read-time freshness correction to a stale streak (last logged 3+ days ago)', async () => {
    prisma.user.findUniqueOrThrow.mockResolvedValue({
      ...baseUser,
      currentStreakCount: 5,
      lastStreakDate: new Date('2020-01-01T00:00:00.000Z'),
    });
    prisma.follow.count.mockResolvedValue(0);

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
    prisma.follow.count.mockResolvedValue(0);

    const result = await service.getMe('user-1');

    expect(result.currentStreakCount).toBe(0);
    expect(result.lastStreakDate).toBeNull();
  });
});
