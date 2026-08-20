import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FollowService } from '../follow/follow.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import {
  PrivateProfileStubDto,
  PublicUserProfileDto,
  toPrivateProfileStubDto,
  toPublicUserProfileDto,
  toUserProfileDto,
  UserProfileDto,
} from './users.mapper';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly followService: FollowService,
  ) {}

  async getMe(userId: string): Promise<UserProfileDto> {
    const [user, counts] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId } }),
      this.followService.getFollowCounts(userId),
    ]);

    return toUserProfileDto(user, counts.followerCount, counts.followingCount);
  }

  async updateMe(
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<UserProfileDto> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.displayName !== undefined
          ? { displayName: dto.displayName }
          : {}),
        ...(dto.bio !== undefined ? { bio: dto.bio } : {}),
        ...(dto.timezone !== undefined ? { timezone: dto.timezone } : {}),
        ...(dto.isPrivate !== undefined ? { isPrivate: dto.isPrivate } : {}),
      },
    });
    const counts = await this.followService.getFollowCounts(userId);

    return toUserProfileDto(user, counts.followerCount, counts.followingCount);
  }

  async getPublicProfile(
    username: string,
    viewerId: string | null,
  ): Promise<PublicUserProfileDto | PrivateProfileStubDto> {
    const user = await this.prisma.user.findUnique({
      where: { username: username.toLowerCase() },
    });
    if (!user) {
      throw new NotFoundException(`User not found: ${username}`);
    }

    const [isFollowedByMe, followsMe] = await Promise.all([
      viewerId ? this.hasFollowEdge(viewerId, user.id) : Promise.resolve(false),
      viewerId ? this.hasFollowEdge(user.id, viewerId) : Promise.resolve(false),
    ]);

    const viewable = await this.followService.canView(viewerId, user);
    if (!viewable) {
      return toPrivateProfileStubDto(user, isFollowedByMe);
    }

    const counts = await this.followService.getFollowCounts(user.id);
    return toPublicUserProfileDto(
      user,
      counts.followerCount,
      counts.followingCount,
      isFollowedByMe,
      followsMe,
    );
  }

  private async hasFollowEdge(
    followerId: string,
    followeeId: string,
  ): Promise<boolean> {
    const edge = await this.prisma.follow.findUnique({
      where: { followerId_followeeId: { followerId, followeeId } },
    });
    return edge !== null;
  }
}
