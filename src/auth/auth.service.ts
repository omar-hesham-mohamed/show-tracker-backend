import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomBytes, createHash } from 'crypto';
import { Prisma, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { LogoutDto } from './dto/logout.dto';
import { BCRYPT_SALT_ROUNDS, REFRESH_TOKEN_TTL_MS } from './auth.constants';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface PublicUser {
  id: string;
  username: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  timezone: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async signup(dto: SignupDto): Promise<TokenPair & { user: PublicUser }> {
    const email = dto.email.toLowerCase();
    const username = dto.username.toLowerCase();

    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email }, { username }] },
      select: { email: true },
    });
    if (existing) {
      throw new ConflictException(
        existing.email === email
          ? 'Email already in use'
          : 'Username already taken',
      );
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_SALT_ROUNDS);

    let user: User;
    try {
      user = await this.prisma.user.create({
        data: {
          email,
          username,
          passwordHash,
          displayName: dto.displayName,
          timezone: dto.timezone,
        },
      });
    } catch (error) {
      // The findFirst check above is a check-then-act race, not a guarantee
      // — two concurrent signups for the same email/username can both pass
      // it and only collide here, at the DB's own unique constraint (bug
      // found via testing — see plan.md). Without this catch, Prisma's raw
      // P2002 error isn't an HttpException and falls through to the global
      // filter's generic 500 instead of the 409 this already returns for
      // the non-concurrent case above.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const target = (error.meta?.target as string[] | undefined) ?? [];
        throw new ConflictException(
          target.includes('email')
            ? 'Email already in use'
            : 'Username already taken',
        );
      }
      throw error;
    }

    const tokens = await this.issueTokens(user.id);
    return { ...tokens, user: this.toPublicUser(user) };
  }

  async login(dto: LoginDto): Promise<TokenPair & { user: PublicUser }> {
    const identifier = dto.emailOrUsername.toLowerCase();

    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: identifier }, { username: identifier }],
        deletedAt: null,
      },
    });
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.issueTokens(user.id);
    return { ...tokens, user: this.toPublicUser(user) };
  }

  async refresh(dto: RefreshDto): Promise<TokenPair> {
    const tokenHash = this.hashToken(dto.refreshToken);
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });

    if (!record) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (record.revokedAt) {
      // Reuse of an already-rotated token is a theft signal (plan.md decision):
      // nuke every session for this user, not just the reused one.
      await this.prisma.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Refresh token has already been used');
    }

    if (record.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(record.userId);
  }

  async logout(userId: string, dto: LogoutDto): Promise<void> {
    const tokenHash = this.hashToken(dto.refreshToken);
    // Idempotent: revokes only the presented token (this device/session),
    // leaving other logged-in devices untouched. No-op if already
    // revoked/unknown so a double-logout call isn't an error.
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueTokens(userId: string): Promise<TokenPair> {
    const accessToken = await this.jwtService.signAsync({ sub: userId });

    // Opaque refresh token: only its hash is persisted (auth.constants.ts /
    // plan.md) since it's high-entropy and has nothing to brute-force.
    const refreshToken = randomBytes(32).toString('hex');
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hashToken(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    });

    return { accessToken, refreshToken };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private toPublicUser(user: User): PublicUser {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      timezone: user.timezone,
    };
  }
}
