import {
  BadGatewayException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { isAxiosError } from 'axios';
import { Episode, MediaType, Prisma, Show } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  DEFAULT_WATCH_PROVIDER_REGION,
  METADATA_TTL_MS,
  WATCH_PROVIDER_TTL_MS,
} from './tmdb.constants';
import {
  TmdbMovieDetail,
  TmdbMovieResult,
  TmdbMultiSearchResult,
  TmdbSearchResponse,
  TmdbSeasonDetail,
  TmdbTvDetail,
  TmdbTvResult,
  TmdbWatchProvidersResponse,
} from './tmdb-api.types';
import {
  MappedWatchProviders,
  ShowSearchResultDto,
  mapMovieDetail,
  mapMovieSearchResult,
  mapMultiSearchResult,
  mapSeasonEpisodes,
  mapTvDetail,
  mapTvSearchResult,
  mapWatchProviders,
} from './tmdb.mapper';

export interface SearchShowsResult {
  results: ShowSearchResultDto[];
  page: number;
  totalPages: number;
}

export interface ShowDetailDto {
  id: string;
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  overview: string;
  posterPath: string | null;
  backdropPath: string | null;
  releaseDate: string | null;
  tmdbRating: number | null;
  genres: string[];
  status: string | null;
  seasonCount: number | null;
}

export interface EpisodeDto {
  id: string;
  episodeNumber: number;
  name: string;
  airDate: string | null;
  overview: string;
  stillPath: string | null;
}

export interface SeasonDetailDto {
  seasonNumber: number;
  name: string;
  airDate: string | null;
  episodes: EpisodeDto[];
}

export type WatchProvidersDto = MappedWatchProviders;

export interface RecommendationsResult {
  results: ShowSearchResultDto[];
}

function toDateOnlyString(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

@Injectable()
export class TmdbService {
  private readonly logger = new Logger(TmdbService.name);

  constructor(
    private readonly http: HttpService,
    private readonly prisma: PrismaService,
  ) {}

  async search(
    query: string,
    type: 'movie' | 'tv' | 'all',
    page: number,
  ): Promise<SearchShowsResult> {
    if (type === 'movie') {
      const data = await this.request<TmdbSearchResponse<TmdbMovieResult>>(
        '/search/movie',
        { query, page, include_adult: false },
      );
      return {
        results: data.results.map(mapMovieSearchResult),
        page: data.page,
        totalPages: data.total_pages,
      };
    }

    if (type === 'tv') {
      const data = await this.request<TmdbSearchResponse<TmdbTvResult>>(
        '/search/tv',
        { query, page, include_adult: false },
      );
      return {
        results: data.results.map(mapTvSearchResult),
        page: data.page,
        totalPages: data.total_pages,
      };
    }

    // type === 'all': the only way to get a single TMDB-side relevance
    // ranking spanning movie+TV (plan.md) — filter out person/collection
    // results after the call, since TMDB has no server-side media_type filter here.
    const data = await this.request<TmdbSearchResponse<TmdbMultiSearchResult>>(
      '/search/multi',
      { query, page, include_adult: false },
    );
    const results = data.results
      .map(mapMultiSearchResult)
      .filter((result): result is ShowSearchResultDto => result !== null);
    return { results, page: data.page, totalPages: data.total_pages };
  }

  async getShowDetail(
    mediaType: MediaType,
    tmdbId: number,
  ): Promise<ShowDetailDto> {
    const existing = await this.prisma.show.findUnique({
      where: { tmdbId_mediaType: { tmdbId, mediaType } },
    });

    if (existing && this.isFresh(existing.lastSyncedAt, METADATA_TTL_MS)) {
      return this.toShowDetailDto(existing);
    }

    try {
      const mapped =
        mediaType === MediaType.movie
          ? mapMovieDetail(
              await this.request<TmdbMovieDetail>(`/movie/${tmdbId}`),
            )
          : mapTvDetail(await this.request<TmdbTvDetail>(`/tv/${tmdbId}`));

      const saved = await this.prisma.show.upsert({
        where: { tmdbId_mediaType: { tmdbId, mediaType } },
        create: {
          ...mapped,
          genres: mapped.genres,
          lastSyncedAt: new Date(),
        },
        update: {
          ...mapped,
          genres: mapped.genres,
          lastSyncedAt: new Date(),
        },
      });
      return this.toShowDetailDto(saved);
    } catch (error) {
      this.logger.error(
        `getShowDetail(${mediaType}, ${tmdbId}) failed: ${error instanceof Error ? error.stack : String(error)}`,
      );
      if (existing) {
        this.logger.warn(
          `TMDB refresh failed for ${mediaType}/${tmdbId}, serving stale cache`,
        );
        return this.toShowDetailDto(existing);
      }
      if (this.isNotFound(error)) {
        throw new NotFoundException(`Unknown TMDB ${mediaType} id ${tmdbId}`);
      }
      throw new BadGatewayException('TMDB is currently unavailable');
    }
  }

  async getWatchProviders(
    mediaType: MediaType,
    tmdbId: number,
    region: string = DEFAULT_WATCH_PROVIDER_REGION,
  ): Promise<WatchProvidersDto> {
    // Region-keyed caching is deferred post-MVP (plan.md) — only the default
    // region is ever fetched/cached, regardless of the requested `region`.
    void region;
    const effectiveRegion = DEFAULT_WATCH_PROVIDER_REGION;

    const show = await this.prisma.show.findUnique({
      where: { tmdbId_mediaType: { tmdbId, mediaType } },
    });
    if (!show) {
      throw new NotFoundException(`Unknown TMDB ${mediaType} id ${tmdbId}`);
    }

    if (
      show.watchProviders &&
      this.isFresh(show.watchProvidersSyncedAt, WATCH_PROVIDER_TTL_MS)
    ) {
      return show.watchProviders as unknown as WatchProvidersDto;
    }

    try {
      const raw = await this.request<TmdbWatchProvidersResponse>(
        `/${mediaType}/${tmdbId}/watch/providers`,
      );
      const mapped = mapWatchProviders(raw, effectiveRegion) ?? {
        region: effectiveRegion,
        link: null,
        flatrate: [],
        rent: [],
        buy: [],
      };

      await this.prisma.show.update({
        where: { tmdbId_mediaType: { tmdbId, mediaType } },
        data: {
          watchProviders: mapped as unknown as Prisma.InputJsonValue,
          watchProvidersSyncedAt: new Date(),
        },
      });
      return mapped;
    } catch (error) {
      this.logger.error(
        `getWatchProviders(${mediaType}, ${tmdbId}) failed: ${error instanceof Error ? error.stack : String(error)}`,
      );
      if (show.watchProviders) {
        this.logger.warn(
          `TMDB watch-providers refresh failed for ${mediaType}/${tmdbId}, serving stale cache`,
        );
        return show.watchProviders as unknown as WatchProvidersDto;
      }
      throw new BadGatewayException('TMDB is currently unavailable');
    }
  }

  async getRecommendations(
    mediaType: MediaType,
    tmdbId: number,
  ): Promise<RecommendationsResult> {
    // Same "never cached" treatment as search (plan.md) — a recommendations
    // list is the same shape of low-cache-value stub list, so it's proxied
    // live on every call rather than persisted on the Show row.
    try {
      const results =
        mediaType === MediaType.movie
          ? (
              await this.request<TmdbSearchResponse<TmdbMovieResult>>(
                `/movie/${tmdbId}/recommendations`,
              )
            ).results.map(mapMovieSearchResult)
          : (
              await this.request<TmdbSearchResponse<TmdbTvResult>>(
                `/tv/${tmdbId}/recommendations`,
              )
            ).results.map(mapTvSearchResult);
      return { results };
    } catch (error) {
      this.logger.error(
        `getRecommendations(${mediaType}, ${tmdbId}) failed: ${error instanceof Error ? error.stack : String(error)}`,
      );
      if (this.isNotFound(error)) {
        throw new NotFoundException(`Unknown TMDB ${mediaType} id ${tmdbId}`);
      }
      throw new BadGatewayException('TMDB is currently unavailable');
    }
  }

  async getSeasonDetail(
    tmdbId: number,
    seasonNumber: number,
  ): Promise<SeasonDetailDto> {
    const show = await this.prisma.show.findUnique({
      where: { tmdbId_mediaType: { tmdbId, mediaType: MediaType.tv } },
    });
    if (!show) {
      throw new NotFoundException(`Show not found: tv/${tmdbId}`);
    }

    const existingEpisodes = await this.prisma.episode.findMany({
      where: { showId: show.id, seasonNumber },
      orderBy: { episodeNumber: 'asc' },
    });

    if (
      existingEpisodes.length > 0 &&
      this.isFresh(existingEpisodes[0].lastSyncedAt, METADATA_TTL_MS)
    ) {
      const { name, airDate } = this.synthesizeSeasonMeta(
        seasonNumber,
        existingEpisodes,
      );
      return this.toSeasonDetailDto(
        seasonNumber,
        name,
        airDate,
        existingEpisodes,
      );
    }

    try {
      const raw = await this.request<TmdbSeasonDetail>(
        `/tv/${tmdbId}/season/${seasonNumber}`,
      );
      const mapped = mapSeasonEpisodes(raw);

      const savedEpisodes = await Promise.all(
        mapped.episodes.map((episode) =>
          this.prisma.episode.upsert({
            where: {
              showId_seasonNumber_episodeNumber: {
                showId: show.id,
                seasonNumber: mapped.seasonNumber,
                episodeNumber: episode.episodeNumber,
              },
            },
            create: {
              showId: show.id,
              seasonNumber: mapped.seasonNumber,
              ...episode,
              lastSyncedAt: new Date(),
            },
            update: { ...episode, lastSyncedAt: new Date() },
          }),
        ),
      );

      return this.toSeasonDetailDto(
        mapped.seasonNumber,
        mapped.name,
        mapped.airDate,
        savedEpisodes,
      );
    } catch (error) {
      this.logger.error(
        `getSeasonDetail(${tmdbId}, ${seasonNumber}) failed: ${error instanceof Error ? error.stack : String(error)}`,
      );
      if (existingEpisodes.length > 0) {
        this.logger.warn(
          `TMDB season refresh failed for tv/${tmdbId}/season/${seasonNumber}, serving stale cache`,
        );
        const { name, airDate } = this.synthesizeSeasonMeta(
          seasonNumber,
          existingEpisodes,
        );
        return this.toSeasonDetailDto(
          seasonNumber,
          name,
          airDate,
          existingEpisodes,
        );
      }
      if (this.isNotFound(error)) {
        throw new NotFoundException(
          `Season ${seasonNumber} not found for tv/${tmdbId}`,
        );
      }
      throw new BadGatewayException('TMDB is currently unavailable');
    }
  }

  private async request<T>(
    path: string,
    params?: Record<string, string | number | boolean>,
  ): Promise<T> {
    const response = await firstValueFrom(this.http.get<T>(path, { params }));
    return response.data;
  }

  private isNotFound(error: unknown): boolean {
    return isAxiosError(error) && error.response?.status === 404;
  }

  private isFresh(syncedAt: Date | null, ttlMs: number): boolean {
    return syncedAt !== null && Date.now() - syncedAt.getTime() < ttlMs;
  }

  /**
   * No Season table exists (plan.md keeps the schema to Show/Episode only) —
   * season-level name/airDate are synthesized from cached episode data on a
   * cache hit rather than persisted separately. TMDB's season name is
   * deterministically "Season N" (or "Specials" for 0), and its air_date is
   * in practice the first episode's air date. A fresh TMDB fetch always uses
   * the real values instead (see getSeasonDetail's success path above).
   */
  private synthesizeSeasonMeta(
    seasonNumber: number,
    episodes: { airDate: Date | null }[],
  ): { name: string; airDate: Date | null } {
    const name = seasonNumber === 0 ? 'Specials' : `Season ${seasonNumber}`;
    const airDates = episodes
      .map((episode) => episode.airDate)
      .filter((date): date is Date => date !== null);
    const airDate =
      airDates.length > 0
        ? new Date(Math.min(...airDates.map((date) => date.getTime())))
        : null;
    return { name, airDate };
  }

  private toShowDetailDto(show: Show): ShowDetailDto {
    return {
      id: show.id,
      tmdbId: show.tmdbId,
      mediaType: show.mediaType,
      title: show.title,
      overview: show.overview,
      posterPath: show.posterPath,
      backdropPath: show.backdropPath,
      releaseDate: toDateOnlyString(show.releaseDate),
      tmdbRating: show.tmdbRating,
      genres: show.genres as string[],
      status: show.status,
      seasonCount: show.seasonCount,
    };
  }

  private toSeasonDetailDto(
    seasonNumber: number,
    name: string,
    airDate: Date | null,
    episodes: Episode[],
  ): SeasonDetailDto {
    return {
      seasonNumber,
      name,
      airDate: toDateOnlyString(airDate),
      episodes: episodes.map((episode) => ({
        id: episode.id,
        episodeNumber: episode.episodeNumber,
        name: episode.name,
        airDate: toDateOnlyString(episode.airDate),
        overview: episode.overview,
        stillPath: episode.stillPath,
      })),
    };
  }
}
