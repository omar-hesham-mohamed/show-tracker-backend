import { MediaType } from '@prisma/client';
import {
  TmdbGenre,
  TmdbMovieDetail,
  TmdbMovieResult,
  TmdbMultiSearchResult,
  TmdbSeasonDetail,
  TmdbTvDetail,
  TmdbTvResult,
  TmdbWatchProvidersResponse,
} from './tmdb-api.types';

export interface ShowSearchResultDto {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  posterPath: string | null;
  releaseDate: string | null;
  tmdbRating: number | null;
}

/** Normalized show data ready for a Prisma upsert (plus response fields not persisted verbatim). */
export interface MappedShowDetail {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  overview: string;
  posterPath: string | null;
  backdropPath: string | null;
  releaseDate: Date | null;
  tmdbRating: number | null;
  genres: string[];
  status: string | null;
  seasonCount: number | null;
}

export interface MappedEpisode {
  episodeNumber: number;
  name: string;
  airDate: Date | null;
  overview: string;
  stillPath: string | null;
}

export interface MappedSeasonDetail {
  seasonNumber: number;
  name: string;
  airDate: Date | null;
  episodes: MappedEpisode[];
}

export interface MappedWatchProviders {
  region: string;
  link: string | null;
  flatrate: { providerName: string; logoPath: string }[];
  rent: { providerName: string; logoPath: string }[];
  buy: { providerName: string; logoPath: string }[];
}

/** TMDB sends "" for unreleased/unknown dates rather than omitting the field or using null. */
function normalizeDate(value: string | null | undefined): string | null {
  return value ? value : null;
}

/** Same "" quirk, but for fields headed into a Prisma @db.Date column, which
 * rejects bare "YYYY-MM-DD" strings and needs an actual Date object. */
function normalizeDateForDb(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null;
}

function flattenGenres(genres: TmdbGenre[]): string[] {
  return genres.map((genre) => genre.name);
}

export function mapMovieSearchResult(
  raw: TmdbMovieResult,
): ShowSearchResultDto {
  return {
    tmdbId: raw.id,
    mediaType: MediaType.movie,
    title: raw.title,
    posterPath: raw.poster_path,
    releaseDate: normalizeDate(raw.release_date),
    tmdbRating: raw.vote_average ?? null,
  };
}

export function mapTvSearchResult(raw: TmdbTvResult): ShowSearchResultDto {
  return {
    tmdbId: raw.id,
    mediaType: MediaType.tv,
    title: raw.name,
    posterPath: raw.poster_path,
    releaseDate: normalizeDate(raw.first_air_date),
    tmdbRating: raw.vote_average ?? null,
  };
}

/** Returns null for person/collection results, which `/search/multi` can return alongside movie/tv. */
export function mapMultiSearchResult(
  raw: TmdbMultiSearchResult,
): ShowSearchResultDto | null {
  if (raw.media_type === 'movie') {
    return {
      tmdbId: raw.id,
      mediaType: MediaType.movie,
      title: raw.title ?? '',
      posterPath: raw.poster_path ?? null,
      releaseDate: normalizeDate(raw.release_date),
      tmdbRating: raw.vote_average ?? null,
    };
  }
  if (raw.media_type === 'tv') {
    return {
      tmdbId: raw.id,
      mediaType: MediaType.tv,
      title: raw.name ?? '',
      posterPath: raw.poster_path ?? null,
      releaseDate: normalizeDate(raw.first_air_date),
      tmdbRating: raw.vote_average ?? null,
    };
  }
  return null; // person or collection — no product surface for these (plan.md deferred list)
}

export function mapMovieDetail(raw: TmdbMovieDetail): MappedShowDetail {
  return {
    tmdbId: raw.id,
    mediaType: MediaType.movie,
    title: raw.title,
    overview: raw.overview,
    posterPath: raw.poster_path,
    backdropPath: raw.backdrop_path,
    releaseDate: normalizeDateForDb(raw.release_date),
    tmdbRating: raw.vote_average ?? null,
    genres: flattenGenres(raw.genres ?? []),
    status: raw.status ?? null,
    seasonCount: null,
  };
}

export function mapTvDetail(raw: TmdbTvDetail): MappedShowDetail {
  return {
    tmdbId: raw.id,
    mediaType: MediaType.tv,
    title: raw.name,
    overview: raw.overview,
    posterPath: raw.poster_path,
    backdropPath: raw.backdrop_path,
    releaseDate: normalizeDateForDb(raw.first_air_date),
    tmdbRating: raw.vote_average ?? null,
    genres: flattenGenres(raw.genres ?? []),
    status: raw.status ?? null,
    seasonCount: raw.seasons?.length ?? 0,
  };
}

export function mapSeasonEpisodes(raw: TmdbSeasonDetail): MappedSeasonDetail {
  return {
    seasonNumber: raw.season_number,
    name: raw.name,
    airDate: normalizeDateForDb(raw.air_date),
    episodes: (raw.episodes ?? []).map((episode) => ({
      episodeNumber: episode.episode_number,
      name: episode.name,
      airDate: normalizeDateForDb(episode.air_date),
      overview: episode.overview,
      stillPath: episode.still_path,
    })),
  };
}

export function mapWatchProviders(
  raw: TmdbWatchProvidersResponse,
  region: string,
): MappedWatchProviders | null {
  const regionData = raw.results?.[region];
  if (!regionData) {
    return null;
  }
  const mapEntries = (
    entries?: { provider_name: string; logo_path: string }[],
  ) =>
    (entries ?? []).map((entry) => ({
      providerName: entry.provider_name,
      logoPath: entry.logo_path,
    }));
  return {
    region,
    link: regionData.link ?? null,
    flatrate: mapEntries(regionData.flatrate),
    rent: mapEntries(regionData.rent),
    buy: mapEntries(regionData.buy),
  };
}
