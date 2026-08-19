import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { toUserProfileDto, UserProfileDto } from './users.mapper';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getMe(userId: string): Promise<UserProfileDto> {
    const [user, followerCount, followingCount] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId } }),
      // Follow already exists in schema.prisma (built ahead of Phase 6) —
      // legitimate to compute now, will just read 0 for everyone until
      // Phase 6 adds ways to create Follow rows.
      this.prisma.follow.count({ where: { followeeId: userId } }),
      this.prisma.follow.count({ where: { followerId: userId } }),
    ]);

    return toUserProfileDto(user, followerCount, followingCount);
  }
}
