/**
 * Minimal raw TMDB response shapes — only the fields tmdb.mapper.ts actually
 * reads, not a full mirror of TMDB's schema (see plan.md's "response
 * cleaning" decision).
 */

export interface TmdbGenre {
  id: number;
  name: string;
}

export interface TmdbMovieResult {
  id: number;
  media_type?: 'movie';
  title: string;
  overview: string;
  poster_path: string | null;
  release_date: string; // can be "" for unreleased titles
  vote_average: number;
}

export interface TmdbTvResult {
  id: number;
  media_type?: 'tv';
  name: string;
  overview: string;
  poster_path: string | null;
  first_air_date: string; // can be ""
  vote_average: number;
}

/** A `/search/multi` result — media_type discriminates movie/tv/person/collection. */
export interface TmdbMultiSearchResult {
  id: number;
  media_type: 'movie' | 'tv' | 'person' | 'collection';
  title?: string;
  name?: string;
  overview?: string;
  poster_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
}

export interface TmdbSearchResponse<T> {
  page: number;
  results: T[];
  total_pages: number;
  total_results: number;
}

export interface TmdbMovieDetail {
  id: number;
  title: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date: string;
  vote_average: number;
  genres: TmdbGenre[];
  status: string; // e.g. "Released", "Post Production"
}

export interface TmdbTvDetail {
  id: number;
  name: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  first_air_date: string;
  vote_average: number;
  genres: TmdbGenre[];
  status: string; // e.g. "Ended", "Returning Series"
  seasons: { season_number: number; episode_count: number }[];
}

export interface TmdbSeasonDetail {
  season_number: number;
  name: string;
  air_date: string | null;
  episodes: {
    episode_number: number;
    name: string;
    air_date: string | null;
    overview: string;
    still_path: string | null;
  }[];
}

export interface TmdbWatchProvidersResponse {
  results: Record<
    string,
    {
      link: string;
      flatrate?: { provider_name: string; logo_path: string }[];
      rent?: { provider_name: string; logo_path: string }[];
      buy?: { provider_name: string; logo_path: string }[];
    }
  >;
}
