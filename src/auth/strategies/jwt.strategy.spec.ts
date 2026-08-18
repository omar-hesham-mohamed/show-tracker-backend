import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  let prisma: { user: { findUnique: jest.Mock } };
  let strategy: JwtStrategy;

  beforeEach(() => {
    prisma = { user: { findUnique: jest.fn() } };
    const config = {
      getOrThrow: jest.fn().mockReturnValue('test-secret'),
    } as unknown as ConfigService;
    strategy = new JwtStrategy(config, prisma as any);
  });

  it('returns a minimal, DB-backed user for a payload matching an active account', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      username: 'mazen',
      email: 'a@b.com',
      passwordHash: 'should-never-leave-this-method',
      deletedAt: null,
    });

    const result = await strategy.validate({ sub: 'user-1' });

    expect(result).toEqual({
      id: 'user-1',
      username: 'mazen',
      email: 'a@b.com',
    });
    expect(result).not.toHaveProperty('passwordHash');
  });

  it('rejects a payload whose user no longer exists (e.g. hard-deleted, or a forged sub)', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      strategy.validate({ sub: 'nonexistent-user' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a soft-deleted user immediately, even with an otherwise-valid, unexpired token (the DB-backed-validation design point)', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      username: 'mazen',
      email: 'a@b.com',
      passwordHash: 'x',
      deletedAt: new Date(),
    });

    await expect(strategy.validate({ sub: 'user-1' })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('looks the user up by exactly the sub claim, not any other field', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-42',
      username: 'someone',
      email: 'x@y.com',
      deletedAt: null,
    });

    await strategy.validate({ sub: 'user-42' });

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-42' },
    });
  });
});
