import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { decodeCursor, encodeCursor } from '../common/pagination/cursor.util';
import { ListFollowDto } from './dto/list-follow.dto';
import { FollowListItemDto, toFollowListItemDto } from './follow.mapper';

export interface FollowListResult {
  items: FollowListItemDto[];
  nextCursor: string | null;
}

type VaryingKey = 'followerId' | 'followeeId';

@Injectable()
export class FollowService {
  constructor(private readonly prisma: PrismaService) {}

  async follow(followerId: string, targetUsername: string): Promise<void> {
    const target = await this.resolveUsername(targetUsername);
    if (target.id === followerId) {
      throw new BadRequestException('Cannot follow yourself');
    }

    // Atomic upsert, not check-then-create — avoids the same race class
    // fixed in AuthService.signup (plan.md's adversarial-review section).
    await this.prisma.follow.upsert({
      where: {
        followerId_followeeId: { followerId, followeeId: target.id },
      },
      create: { followerId, followeeId: target.id },
      update: {},
    });
  }

  async unfollow(followerId: string, targetUsername: string): Promise<void> {
    const target = await this.resolveUsername(targetUsername);
    await this.prisma.follow.deleteMany({
      where: { followerId, followeeId: target.id },
    });
  }

  async getFollowers(
    targetUsername: string,
    viewerId: string | null,
    dto: ListFollowDto,
  ): Promise<FollowListResult> {
    const target = await this.resolveUsername(targetUsername);
    if (!(await this.canView(viewerId, target))) {
      return { items: [], nextCursor: null };
    }
    return this.paginate(
      { followeeId: target.id },
      'followerId',
      'follower',
      viewerId,
      dto,
    );
  }

  async getFollowing(
    targetUsername: string,
    viewerId: string | null,
    dto: ListFollowDto,
  ): Promise<FollowListResult> {
    const target = await this.resolveUsername(targetUsername);
    if (!(await this.canView(viewerId, target))) {
      return { items: [], nextCursor: null };
    }
    return this.paginate(
      { followerId: target.id },
      'followeeId',
      'followee',
      viewerId,
      dto,
    );
  }

  /**
   * Single shared privacy predicate — every gated endpoint in this phase
   * (profile, lists, streak, heatmap, diary) calls this and decides its own
   * degradation shape (stub / empty list / 403) per its own documented
   * contract (plan.md's Phase 6 Decisions Log).
   */
  async canView(
    viewerId: string | null,
    target: { id: string; isPrivate: boolean },
  ): Promise<boolean> {
    if (!target.isPrivate) {
      return true;
    }
    if (viewerId === target.id) {
      return true; // self-view bypass
    }
    if (!viewerId) {
      return false;
    }
    const edge = await this.prisma.follow.findUnique({
      where: {
        followerId_followeeId: { followerId: viewerId, followeeId: target.id },
      },
    });
    return edge !== null;
  }

  async getFollowCounts(
    userId: string,
  ): Promise<{ followerCount: number; followingCount: number }> {
    const [followerCount, followingCount] = await Promise.all([
      this.prisma.follow.count({ where: { followeeId: userId } }),
      this.prisma.follow.count({ where: { followerId: userId } }),
    ]);
    return { followerCount, followingCount };
  }

  private async resolveUsername(username: string): Promise<User> {
    const user = await this.prisma.user.findUnique({
      where: { username: username.toLowerCase() },
    });
    if (!user) {
      throw new NotFoundException(`User not found: ${username}`);
    }
    return user;
  }

  private async paginate(
    fixedWhere: Prisma.FollowWhereInput,
    varyingKey: VaryingKey,
    includeKey: 'follower' | 'followee',
    viewerId: string | null,
    dto: ListFollowDto,
  ): Promise<FollowListResult> {
    const where: Prisma.FollowWhereInput = { ...fixedWhere };

    if (dto.cursor) {
      const { createdAt, id } = decodeCursor(dto.cursor);
      if (!createdAt || !id) {
        throw new BadRequestException('Invalid cursor');
      }
      const cursorDate = new Date(createdAt);
      if (Number.isNaN(cursorDate.getTime())) {
        throw new BadRequestException('Invalid cursor');
      }
      where.OR = [
        { createdAt: { lt: cursorDate } },
        { createdAt: cursorDate, [varyingKey]: { lt: id } },
      ];
    }

    const rows = await this.prisma.follow.findMany({
      where,
      include: { [includeKey]: true },
      orderBy: [{ createdAt: 'desc' }, { [varyingKey]: 'desc' }],
      take: dto.limit + 1,
    });

    const hasMore = rows.length > dto.limit;
    const page = hasMore ? rows.slice(0, dto.limit) : rows;
    const users = page.map(
      (row) => (row as unknown as Record<string, User>)[includeKey],
    );

    // One batched query for isFollowedByMe across the whole page, not a
    // per-item lookup — avoids the N+1 pattern plan.md flags for Phase 7's
    // feed (proactively applied here, one phase early).
    const followedSet =
      viewerId && users.length > 0
        ? new Set(
            (
              await this.prisma.follow.findMany({
                where: {
                  followerId: viewerId,
                  followeeId: { in: users.map((u) => u.id) },
                },
                select: { followeeId: true },
              })
            ).map((f) => f.followeeId),
          )
        : new Set<string>();

    const lastRow = page[page.length - 1] as unknown as
      (Record<string, unknown> & { createdAt: Date }) | undefined;
    const nextCursor =
      hasMore && lastRow
        ? encodeCursor({
            createdAt: lastRow.createdAt.toISOString(),
            id: String(lastRow[varyingKey]),
          })
        : null;

    return {
      items: users.map((u) => toFollowListItemDto(u, followedSet.has(u.id))),
      nextCursor,
    };
  }
}
