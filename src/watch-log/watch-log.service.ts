import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, WatchStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TmdbService } from '../tmdb/tmdb.service';
import { StreakService } from '../streak/streak.service';
import { FollowService } from '../follow/follow.service';
import { decodeCursor, encodeCursor } from '../common/pagination/cursor.util';
import { CreateWatchLogDto } from './dto/create-watch-log.dto';
import { UpdateWatchLogDto } from './dto/update-watch-log.dto';
import { ListWatchLogDto } from './dto/list-watch-log.dto';
import {
  toWatchLogEntryDto,
  WatchLogEntryDto,
  WatchLogEntryWithShow,
} from './watch-log.mapper';

export interface WatchLogListResult {
  items: WatchLogEntryDto[];
  nextCursor: string | null;
}

/**
 * Loose, honor-system sanity check (plan.md §Streak) — blocks an obviously
 * spoofed future date, independent of the actual streak-day decision, which
 * is Phase 5's responsibility.
 */
function assertNotSpoofedFutureDate(watchedAt: string): void {
  const watchedAtDate = new Date(`${watchedAt}T00:00:00.000Z`);
  const maxAllowed = new Date();
  maxAllowed.setUTCHours(0, 0, 0, 0);
  maxAllowed.setUTCDate(maxAllowed.getUTCDate() + 1);
  if (watchedAtDate.getTime() > maxAllowed.getTime()) {
    throw new BadRequestException('watchedAt cannot be in the future');
  }
}

@Injectable()
export class WatchLogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tmdbService: TmdbService,
    private readonly streakService: StreakService,
    private readonly followService: FollowService,
  ) {}

  async create(
    userId: string,
    dto: CreateWatchLogDto,
  ): Promise<WatchLogEntryDto> {
    assertNotSpoofedFutureDate(dto.watchedAt);

    const show = await this.tmdbService.getShowDetail(
      dto.mediaType,
      dto.tmdbId,
    );

    if (dto.episodeId) {
      const episode = await this.prisma.episode.findFirst({
        where: { id: dto.episodeId, showId: show.id },
      });
      if (!episode) {
        throw new NotFoundException(`Unknown episodeId ${dto.episodeId}`);
      }
    }

    const { entry, streak } = await this.prisma.$transaction(async (tx) => {
      const created = await tx.watchLogEntry.create({
        data: {
          userId,
          showId: show.id,
          episodeId: dto.episodeId ?? null,
          status: dto.status,
          rating: dto.rating ?? null,
          watchedAt: new Date(`${dto.watchedAt}T00:00:00.000Z`),
          note: dto.note ?? '',
        },
        include: { show: true },
      });

      const streakSnapshot =
        created.status === WatchStatus.WATCHED
          ? await this.streakService.recomputeStreak(userId, tx)
          : undefined;

      return { entry: created, streak: streakSnapshot };
    });

    return toWatchLogEntryDto(entry, streak);
  }

  async findMine(
    userId: string,
    dto: ListWatchLogDto,
  ): Promise<WatchLogListResult> {
    return this.listEntries(userId, dto);
  }

  /**
   * Another user's diary — same privacy domain as GET /users/:username,
   * 403 when gated (endpoints.md's own pre-existing spec for this route,
   * kept as-is — not the profile's stub pattern).
   */
  async findForUser(
    username: string,
    viewerId: string | null,
    dto: ListWatchLogDto,
  ): Promise<WatchLogListResult> {
    const target = await this.prisma.user.findUnique({
      where: { username: username.toLowerCase() },
    });
    if (!target) {
      throw new NotFoundException(`User not found: ${username}`);
    }
    if (!(await this.followService.canView(viewerId, target))) {
      throw new ForbiddenException('This profile is private');
    }
    return this.listEntries(target.id, dto);
  }

  /**
   * The pagination/query core never actually cared whose userId it was
   * filtering on — factored out so findMine/findForUser share one
   * implementation instead of duplicating the keyset-pagination logic.
   */
  private async listEntries(
    targetUserId: string,
    dto: ListWatchLogDto,
  ): Promise<WatchLogListResult> {
    const desc = dto.sort === 'watchedAt_desc';

    const where: Prisma.WatchLogEntryWhereInput = {
      userId: targetUserId,
      ...(dto.status ? { status: dto.status } : {}),
    };

    if (dto.cursor) {
      const { watchedAt, id } = decodeCursor(dto.cursor);
      if (!watchedAt || !id) {
        throw new BadRequestException('Invalid cursor');
      }
      const watchedAtDate = new Date(watchedAt);
      // decodeCursor only checks that the fields are strings — a syntactically
      // valid but non-date value (e.g. "not-a-date") would otherwise produce
      // an Invalid Date here, which Prisma can't serialize into the WHERE
      // clause and throws a raw, unhandled error for (bug found via testing —
      // see plan.md).
      if (Number.isNaN(watchedAtDate.getTime())) {
        throw new BadRequestException('Invalid cursor');
      }
      where.OR = [
        { watchedAt: desc ? { lt: watchedAtDate } : { gt: watchedAtDate } },
        {
          watchedAt: watchedAtDate,
          id: desc ? { lt: id } : { gt: id },
        },
      ];
    }

    const rows = await this.prisma.watchLogEntry.findMany({
      where,
      include: { show: true },
      orderBy: [
        { watchedAt: desc ? 'desc' : 'asc' },
        { id: desc ? 'desc' : 'asc' },
      ],
      take: dto.limit + 1,
    });

    const hasMore = rows.length > dto.limit;
    const page = hasMore ? rows.slice(0, dto.limit) : rows;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({
            watchedAt: last.watchedAt.toISOString(),
            id: last.id,
          })
        : null;

    // Not `page.map(toWatchLogEntryDto)` — Array.map passes (element, index,
    // array) to its callback, and toWatchLogEntryDto's now-optional second
    // parameter (streak) would receive the numeric index instead of
    // undefined, corrupting every item's streakAfterWrite field.
    return {
      items: page.map((row) => toWatchLogEntryDto(row)),
      nextCursor,
    };
  }

  async findOne(userId: string, id: string): Promise<WatchLogEntryDto> {
    const entry = await this.findOwnedOrThrow(userId, id);
    return toWatchLogEntryDto(entry);
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateWatchLogDto,
  ): Promise<WatchLogEntryDto> {
    const existing = await this.findOwnedOrThrow(userId, id);

    if (dto.watchedAt) {
      assertNotSpoofedFutureDate(dto.watchedAt);
    }

    // Recompute is needed whenever status or watchedAt is touched while the
    // entry is/becomes WATCHED — a status flip either direction, or a
    // watchedAt change on an entry that is/was WATCHED. Rating/note-only
    // patches, or touching a non-WATCHED entry that stays non-WATCHED, never
    // affect the streak (endpoints.md).
    const wasWatched = existing.status === WatchStatus.WATCHED;
    const willBeWatched =
      (dto.status ?? existing.status) === WatchStatus.WATCHED;
    const touchesStreak =
      (dto.status !== undefined || dto.watchedAt !== undefined) &&
      (wasWatched || willBeWatched);

    const { entry, streak } = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.watchLogEntry.update({
        where: { id },
        data: {
          ...(dto.status !== undefined ? { status: dto.status } : {}),
          ...(dto.rating !== undefined ? { rating: dto.rating } : {}),
          ...(dto.watchedAt !== undefined
            ? { watchedAt: new Date(`${dto.watchedAt}T00:00:00.000Z`) }
            : {}),
          ...(dto.note !== undefined ? { note: dto.note } : {}),
        },
        include: { show: true },
      });

      const streakSnapshot = touchesStreak
        ? await this.streakService.recomputeStreak(userId, tx)
        : undefined;

      return { entry: updated, streak: streakSnapshot };
    });

    return toWatchLogEntryDto(entry, streak);
  }

  async remove(userId: string, id: string): Promise<void> {
    const existing = await this.findOwnedOrThrow(userId, id);

    await this.prisma.$transaction(async (tx) => {
      await tx.watchLogEntry.delete({ where: { id } });
      if (existing.status === WatchStatus.WATCHED) {
        await this.streakService.recomputeStreak(userId, tx);
      }
    });
  }

  private async findOwnedOrThrow(
    userId: string,
    id: string,
  ): Promise<WatchLogEntryWithShow> {
    const entry = await this.prisma.watchLogEntry.findFirst({
      where: { id, userId },
      include: { show: true },
    });
    if (!entry) {
      throw new NotFoundException(`Watch log entry not found: ${id}`);
    }
    return entry;
  }
}
