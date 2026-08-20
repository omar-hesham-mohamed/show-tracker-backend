import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { OptionalAuth } from '../common/decorators/optional-auth.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { FollowService } from '../follow/follow.service';
import { StreakService } from './streak.service';
import { getDisplayedCurrentStreak } from './streak.util';

function toDateOnlyString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

@Controller('users/:username/streak')
export class StreakController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly followService: FollowService,
    private readonly streakService: StreakService,
  ) {}

  @OptionalAuth()
  @Get()
  async getStreak(
    @CurrentUser() user: AuthenticatedUser | null,
    @Param('username') username: string,
  ) {
    const target = await this.resolveViewableUser(username, user?.id ?? null);
    return {
      currentStreakCount: getDisplayedCurrentStreak(
        target.currentStreakCount,
        target.lastStreakDate,
      ),
      longestStreakCount: target.longestStreakCount,
      lastStreakDate: target.lastStreakDate
        ? toDateOnlyString(target.lastStreakDate)
        : null,
    };
  }

  @OptionalAuth()
  @Get('heatmap')
  async getHeatmap(
    @CurrentUser() user: AuthenticatedUser | null,
    @Param('username') username: string,
  ) {
    const target = await this.resolveViewableUser(username, user?.id ?? null);
    return { days: await this.streakService.getHeatmap(target.id) };
  }

  /** Same privacy domain as the diary endpoint — 403 when gated, not the profile's stub (neither has a documented reduced shape). */
  private async resolveViewableUser(username: string, viewerId: string | null) {
    const target = await this.prisma.user.findUnique({
      where: { username: username.toLowerCase() },
    });
    if (!target) {
      throw new NotFoundException(`User not found: ${username}`);
    }
    if (!(await this.followService.canView(viewerId, target))) {
      throw new ForbiddenException('This profile is private');
    }
    return target;
  }
}
