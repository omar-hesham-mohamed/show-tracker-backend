import { ConflictException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';
import { AuthService } from './auth.service';
import { BCRYPT_SALT_ROUNDS } from './auth.constants';

function uniqueConstraintError(target: string[]) {
  return new Prisma.PrismaClientKnownRequestError(
    `Unique constraint failed on the fields: (\`${target.join(',')}\`)`,
    { code: 'P2002', clientVersion: '6.19.3', meta: { target } },
  );
}

jest.mock('bcrypt');

type PrismaMock = {
  user: {
    findFirst: jest.Mock;
    create: jest.Mock;
  };
  refreshToken: {
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
};

function makePrismaMock(): PrismaMock {
  return {
    user: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    refreshToken: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };
}

const baseUser = {
  id: 'user-1',
  email: 'a@b.com',
  username: 'mazen',
  passwordHash: 'stored-hash',
  displayName: 'Mazen',
  avatarUrl: null,
  timezone: 'Africa/Cairo',
  deletedAt: null,
};

describe('AuthService', () => {
  let prisma: PrismaMock;
  let jwtService: { signAsync: jest.Mock };
  let service: AuthService;

  beforeEach(() => {
    prisma = makePrismaMock();
    jwtService = { signAsync: jest.fn().mockResolvedValue('signed.jwt.token') };
    service = new AuthService(prisma as any, jwtService as any);
    jest.clearAllMocks();
    jwtService.signAsync.mockResolvedValue('signed.jwt.token');
  });

  // ---------------------------------------------------------------------
  // signup
  // ---------------------------------------------------------------------
  describe('signup', () => {
    const dto = {
      email: 'A@B.com',
      username: 'Mazen',
      password: 'password123',
      displayName: 'Mazen',
      timezone: 'Africa/Cairo',
    };

    it('normalizes email/username to lowercase before checking uniqueness and storing', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-pw');
      prisma.user.create.mockResolvedValue({
        ...baseUser,
        passwordHash: 'hashed-pw',
      });
      prisma.refreshToken.create.mockResolvedValue({});

      await service.signup(dto);

      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { OR: [{ email: 'a@b.com' }, { username: 'mazen' }] },
        select: { email: true },
      });
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: {
          email: 'a@b.com',
          username: 'mazen',
          passwordHash: 'hashed-pw',
          displayName: 'Mazen',
          timezone: 'Africa/Cairo',
        },
      });
    });

    it('hashes the password with bcrypt at the configured salt-round cost, never storing it raw', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-pw');
      prisma.user.create.mockResolvedValue({
        ...baseUser,
        passwordHash: 'hashed-pw',
      });
      prisma.refreshToken.create.mockResolvedValue({});

      await service.signup(dto);

      expect(bcrypt.hash).toHaveBeenCalledWith(
        'password123',
        BCRYPT_SALT_ROUNDS,
      );
      const createArg = prisma.user.create.mock.calls[0][0];
      expect(createArg.data.passwordHash).toBe('hashed-pw');
      expect(createArg.data.passwordHash).not.toBe('password123');
    });

    it('rejects with the email-specific message when the existing row matches by email', async () => {
      prisma.user.findFirst.mockResolvedValue({ email: 'a@b.com' });

      await expect(service.signup(dto)).rejects.toThrow(ConflictException);
      await expect(service.signup(dto)).rejects.toThrow('Email already in use');
    });

    it('rejects with the username-specific message when the existing row matches by username, not email', async () => {
      // findFirst matched via the OR clause but the matched row's email differs
      // from the attempted email — i.e. the collision was on username.
      prisma.user.findFirst.mockResolvedValue({ email: 'someone-else@b.com' });

      await expect(service.signup(dto)).rejects.toThrow(
        'Username already taken',
      );
    });

    it('never hashes the password or writes a user row when a conflict is found', async () => {
      prisma.user.findFirst.mockResolvedValue({ email: 'a@b.com' });

      await expect(service.signup(dto)).rejects.toThrow(ConflictException);
      expect(bcrypt.hash).not.toHaveBeenCalled();
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('never returns passwordHash on the public user object', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-pw');
      prisma.user.create.mockResolvedValue({
        ...baseUser,
        passwordHash: 'hashed-pw',
      });
      prisma.refreshToken.create.mockResolvedValue({});

      const result = await service.signup(dto);

      expect(result.user).not.toHaveProperty('passwordHash');
      expect(Object.keys(result.user).sort()).toEqual(
        [
          'avatarUrl',
          'displayName',
          'email',
          'id',
          'timezone',
          'username',
        ].sort(),
      );
    });

    it('issues a JWT access token signed with only { sub: userId } and an opaque 64-hex-char refresh token', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-pw');
      prisma.user.create.mockResolvedValue({
        ...baseUser,
        passwordHash: 'hashed-pw',
      });
      prisma.refreshToken.create.mockResolvedValue({});

      const result = await service.signup(dto);

      expect(jwtService.signAsync).toHaveBeenCalledWith({ sub: baseUser.id });
      expect(result.accessToken).toBe('signed.jwt.token');
      expect(result.refreshToken).toMatch(/^[0-9a-f]{64}$/);
    });

    it('persists only a SHA-256 hash of the refresh token, never the raw value', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-pw');
      prisma.user.create.mockResolvedValue({
        ...baseUser,
        passwordHash: 'hashed-pw',
      });
      prisma.refreshToken.create.mockResolvedValue({});

      const result = await service.signup(dto);

      const persisted = prisma.refreshToken.create.mock.calls[0][0].data;
      expect(persisted.userId).toBe(baseUser.id);
      expect(persisted.tokenHash).not.toBe(result.refreshToken);
      expect(persisted.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    });

    describe('concurrent duplicate signup (bug found via testing — see plan.md)', () => {
      // findFirst is a check-then-act race, not a guarantee: two concurrent
      // signups for the same email/username can both pass it and only
      // collide at the DB's own unique constraint inside create().
      it('translates a P2002 on email into the same 409 as the non-concurrent case', async () => {
        prisma.user.findFirst.mockResolvedValue(null);
        (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-pw');
        prisma.user.create.mockRejectedValue(uniqueConstraintError(['email']));

        await expect(service.signup(dto)).rejects.toThrow(ConflictException);
        await expect(service.signup(dto)).rejects.toThrow(
          'Email already in use',
        );
      });

      it('translates a P2002 on username into the same 409 as the non-concurrent case', async () => {
        prisma.user.findFirst.mockResolvedValue(null);
        (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-pw');
        prisma.user.create.mockRejectedValue(
          uniqueConstraintError(['username']),
        );

        await expect(service.signup(dto)).rejects.toThrow(
          'Username already taken',
        );
      });

      it('rethrows a non-P2002 create() failure unchanged rather than mislabeling it as a conflict', async () => {
        prisma.user.findFirst.mockResolvedValue(null);
        (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-pw');
        const dbOutage = new Error('connection terminated unexpectedly');
        prisma.user.create.mockRejectedValue(dbOutage);

        await expect(service.signup(dto)).rejects.toBe(dbOutage);
      });
    });
  });

  // ---------------------------------------------------------------------
  // login — "try to break it"
  // ---------------------------------------------------------------------
  describe('login', () => {
    const dto = { emailOrUsername: 'Mazen', password: 'password123' };

    it('logs in successfully with correct credentials, matching by username case-insensitively', async () => {
      prisma.user.findFirst.mockResolvedValue(baseUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      prisma.refreshToken.create.mockResolvedValue({});

      const result = await service.login(dto);

      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: {
          OR: [{ email: 'mazen' }, { username: 'mazen' }],
          deletedAt: null,
        },
      });
      expect(result.accessToken).toBe('signed.jwt.token');
    });

    it('rejects an unknown identifier with the generic "Invalid credentials" message (no user-existence leak in the message)', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(service.login(dto)).rejects.toThrow(UnauthorizedException);
      await expect(service.login(dto)).rejects.toThrow('Invalid credentials');
    });

    it('rejects a wrong password with the exact same generic message as an unknown user', async () => {
      prisma.user.findFirst.mockResolvedValue(baseUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(dto)).rejects.toThrow('Invalid credentials');
    });

    it('[KNOWN ISSUE — see plan.md Milestone 9] skips bcrypt.compare entirely for an unknown user, creating a response-time side channel that leaks account existence', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(dto)).rejects.toThrow(UnauthorizedException);

      // This assertion documents CURRENT behavior, not desired behavior: an
      // unknown-user login pays zero bcrypt cost, while a known-user/wrong-password
      // login pays a full bcrypt.compare (~100ms). Once the dummy-hash-compare fix
      // lands (plan.md Milestone 9), this should become `toHaveBeenCalled()`.
      expect(bcrypt.compare).not.toHaveBeenCalled();
    });

    it('calls bcrypt.compare exactly once for a known user with a wrong password (contrast case for the timing test above)', async () => {
      prisma.user.findFirst.mockResolvedValue(baseUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(dto)).rejects.toThrow(UnauthorizedException);

      expect(bcrypt.compare).toHaveBeenCalledTimes(1);
      expect(bcrypt.compare).toHaveBeenCalledWith('password123', 'stored-hash');
    });

    it('excludes soft-deleted users at the query level (deletedAt: null in the where clause)', async () => {
      prisma.user.findFirst.mockResolvedValue(null); // simulates Postgres filtering the deleted row out
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await expect(service.login(dto)).rejects.toThrow(UnauthorizedException);
      expect(prisma.user.findFirst.mock.calls[0][0].where.deletedAt).toBeNull();
    });

    it('never leaks passwordHash on a successful login response', async () => {
      prisma.user.findFirst.mockResolvedValue(baseUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      prisma.refreshToken.create.mockResolvedValue({});

      const result = await service.login(dto);

      expect(result.user).not.toHaveProperty('passwordHash');
    });

    it('treats a SQL/NoSQL-injection-style identifier as an inert literal string (Prisma parameterizes, never interpolates)', async () => {
      const maliciousDto = { emailOrUsername: "' OR '1'='1", password: 'x' };
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(service.login(maliciousDto)).rejects.toThrow(
        UnauthorizedException,
      );

      const whereArg = prisma.user.findFirst.mock.calls[0][0].where;
      // The malicious string must appear verbatim as data, not alter query shape.
      expect(whereArg.OR).toEqual([
        { email: "' or '1'='1" },
        { username: "' or '1'='1" },
      ]);
    });

    it('does not throw or crash on an extremely long identifier (basic DoS-shaped input hygiene)', async () => {
      const longDto = { emailOrUsername: 'a'.repeat(10_000), password: 'x' };
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(service.login(longDto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('is not fooled by a password that is a prefix of the real one', async () => {
      prisma.user.findFirst.mockResolvedValue(baseUser);
      (bcrypt.compare as jest.Mock).mockImplementation(
        (candidate: string, hash: string) =>
          Promise.resolve(
            candidate === 'password123' && hash === 'stored-hash',
          ),
      );

      await expect(
        service.login({ emailOrUsername: 'mazen', password: 'password' }),
      ).rejects.toThrow('Invalid credentials');
    });
  });

  // ---------------------------------------------------------------------
  // refresh — token rotation & theft detection
  // ---------------------------------------------------------------------
  describe('refresh', () => {
    const dto = { refreshToken: 'raw-refresh-token-value' };

    it('rotates a valid token: revokes the old row and issues a brand-new pair', async () => {
      const record = {
        id: 'rt-1',
        userId: 'user-1',
        tokenHash: 'hash-of-raw-refresh-token-value',
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        revokedAt: null,
      };
      prisma.refreshToken.findUnique.mockResolvedValue(record);
      prisma.refreshToken.update.mockResolvedValue({});
      prisma.refreshToken.create.mockResolvedValue({});

      const result = await service.refresh(dto);

      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'rt-1' },
        data: { revokedAt: expect.any(Date) },
      });
      expect(result.accessToken).toBe('signed.jwt.token');
      expect(result.refreshToken).toMatch(/^[0-9a-f]{64}$/);
    });

    it('rejects an unknown/tampered token generically, without revealing whether any token exists', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);

      await expect(service.refresh(dto)).rejects.toThrow(
        'Invalid refresh token',
      );
    });

    it('on reuse of an already-revoked token, nukes every active session for that user (theft response) and rejects', async () => {
      const record = {
        id: 'rt-1',
        userId: 'user-1',
        tokenHash: 'x',
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        revokedAt: new Date(Date.now() - 1000),
      };
      prisma.refreshToken.findUnique.mockResolvedValue(record);
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 3 });

      await expect(service.refresh(dto)).rejects.toThrow(
        'Refresh token has already been used',
      );

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      // Confirms the blast radius is genuinely "all sessions", not just this one.
      expect(prisma.refreshToken.update).not.toHaveBeenCalled();
    });

    it('rejects an expired-but-not-yet-revoked token without touching its row (documents the accepted no-pruning tradeoff)', async () => {
      const record = {
        id: 'rt-1',
        userId: 'user-1',
        tokenHash: 'x',
        expiresAt: new Date(Date.now() - 1000),
        revokedAt: null,
      };
      prisma.refreshToken.findUnique.mockResolvedValue(record);

      await expect(service.refresh(dto)).rejects.toThrow(
        'Refresh token expired',
      );

      expect(prisma.refreshToken.update).not.toHaveBeenCalled();
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('produces a different raw refresh token on every rotation (no reuse/predictability)', async () => {
      const record = {
        id: 'rt-1',
        userId: 'user-1',
        tokenHash: 'x',
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        revokedAt: null,
      };
      prisma.refreshToken.findUnique.mockResolvedValue(record);
      prisma.refreshToken.update.mockResolvedValue({});
      prisma.refreshToken.create.mockResolvedValue({});

      const first = await service.refresh(dto);
      const second = await service.refresh(dto);

      expect(first.refreshToken).not.toBe(second.refreshToken);
    });
  });

  // ---------------------------------------------------------------------
  // logout
  // ---------------------------------------------------------------------
  describe('logout', () => {
    it('revokes only the presented token for the presented user', async () => {
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      await service.logout('user-1', { refreshToken: 'raw-token' });

      const call = prisma.refreshToken.updateMany.mock.calls[0][0];
      expect(call.where.userId).toBe('user-1');
      expect(call.where.revokedAt).toBeNull();
      expect(call.data.revokedAt).toBeInstanceOf(Date);
    });

    it('is idempotent — a second logout call with the same (now-revoked) token does not throw', async () => {
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.logout('user-1', { refreshToken: 'raw-token' }),
      ).resolves.toBeUndefined();
    });

    it("cannot revoke another user's session by supplying a mismatched userId (scoped by userId in the where clause)", async () => {
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });

      await service.logout('attacker-id', {
        refreshToken: 'victims-raw-token',
      });

      const call = prisma.refreshToken.updateMany.mock.calls[0][0];
      expect(call.where.userId).toBe('attacker-id');
    });
  });
});
