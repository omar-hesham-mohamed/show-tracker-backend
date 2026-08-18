import { MediaType } from '@prisma/client';
import {
  mapMovieDetail,
  mapMovieSearchResult,
  mapMultiSearchResult,
  mapSeasonEpisodes,
  mapTvDetail,
  mapTvSearchResult,
  mapWatchProviders,
} from './tmdb.mapper';

describe('tmdb.mapper', () => {
  describe('mapMovieSearchResult', () => {
    it('maps a normal result', () => {
      const result = mapMovieSearchResult({
        id: 1,
        title: 'Dune',
        overview: '',
        poster_path: '/dune.jpg',
        release_date: '2021-10-22',
        vote_average: 8.1,
      });

      expect(result).toEqual({
        tmdbId: 1,
        mediaType: MediaType.movie,
        title: 'Dune',
        posterPath: '/dune.jpg',
        releaseDate: '2021-10-22',
        tmdbRating: 8.1,
      });
    });

    it('normalizes an empty-string release_date (TMDB quirk for unreleased titles) to null, not ""', () => {
      const result = mapMovieSearchResult({
        id: 1,
        title: 'Unreleased Movie',
        overview: '',
        poster_path: null,
        release_date: '',
        vote_average: 0,
      });

      expect(result.releaseDate).toBeNull();
    });

    it('defaults a missing vote_average to null rather than 0 or undefined', () => {
      const result = mapMovieSearchResult({
        id: 1,
        title: 'X',
        overview: '',
        poster_path: null,
        release_date: '2020-01-01',
        vote_average: undefined as unknown as number,
      });

      expect(result.tmdbRating).toBeNull();
    });
  });

  describe('mapTvSearchResult', () => {
    it('maps name/first_air_date (TV field names) into the unified title/releaseDate shape', () => {
      const result = mapTvSearchResult({
        id: 1399,
        name: 'Game of Thrones',
        overview: '',
        poster_path: '/got.jpg',
        first_air_date: '2011-04-17',
        vote_average: 8.4,
      });

      expect(result.title).toBe('Game of Thrones');
      expect(result.releaseDate).toBe('2011-04-17');
      expect(result.mediaType).toBe(MediaType.tv);
    });
  });

  describe('mapMultiSearchResult', () => {
    it('maps a movie entry', () => {
      const result = mapMultiSearchResult({
        id: 1,
        media_type: 'movie',
        title: 'Dune',
        release_date: '2021-10-22',
        vote_average: 8.1,
        poster_path: '/dune.jpg',
      });

      expect(result?.mediaType).toBe(MediaType.movie);
      expect(result?.title).toBe('Dune');
    });

    it('maps a tv entry', () => {
      const result = mapMultiSearchResult({
        id: 1399,
        media_type: 'tv',
        name: 'Game of Thrones',
        first_air_date: '2011-04-17',
        vote_average: 8.4,
        poster_path: '/got.jpg',
      });

      expect(result?.mediaType).toBe(MediaType.tv);
      expect(result?.title).toBe('Game of Thrones');
    });

    it('drops person results entirely (returns null)', () => {
      const result = mapMultiSearchResult({ id: 5, media_type: 'person' });
      expect(result).toBeNull();
    });

    it('drops collection results entirely (returns null)', () => {
      const result = mapMultiSearchResult({ id: 6, media_type: 'collection' });
      expect(result).toBeNull();
    });

    it('falls back to an empty string title/name rather than undefined when TMDB omits it', () => {
      const movie = mapMultiSearchResult({ id: 1, media_type: 'movie' });
      const tv = mapMultiSearchResult({ id: 2, media_type: 'tv' });
      expect(movie?.title).toBe('');
      expect(tv?.title).toBe('');
    });
  });

  describe('mapMovieDetail / mapTvDetail', () => {
    it('flattens genres from {id, name}[] to string[]', () => {
      const result = mapMovieDetail({
        id: 1,
        title: 'Dune',
        overview: 'desert planet',
        poster_path: null,
        backdrop_path: null,
        release_date: '2021-10-22',
        vote_average: 8.1,
        genres: [
          { id: 1, name: 'Sci-Fi' },
          { id: 2, name: 'Adventure' },
        ],
        status: 'Released',
      });

      expect(result.genres).toEqual(['Sci-Fi', 'Adventure']);
    });

    it('defaults genres to [] when TMDB omits the field entirely', () => {
      const result = mapMovieDetail({
        id: 1,
        title: 'X',
        overview: '',
        poster_path: null,
        backdrop_path: null,
        release_date: '',
        vote_average: 0,
        genres: undefined as any,
        status: 'Released',
      });

      expect(result.genres).toEqual([]);
    });

    it('converts a real date string to an actual Date object (Prisma @db.Date requirement), not left as a string', () => {
      const result = mapMovieDetail({
        id: 1,
        title: 'X',
        overview: '',
        poster_path: null,
        backdrop_path: null,
        release_date: '2021-10-22',
        vote_average: 0,
        genres: [],
        status: 'Released',
      });

      expect(result.releaseDate).toBeInstanceOf(Date);
    });

    it('movie detail always has a null seasonCount (movies have no seasons)', () => {
      const result = mapMovieDetail({
        id: 1,
        title: 'X',
        overview: '',
        poster_path: null,
        backdrop_path: null,
        release_date: '',
        vote_average: 0,
        genres: [],
        status: 'Released',
      });

      expect(result.seasonCount).toBeNull();
    });

    it('tv detail computes seasonCount from the seasons array length', () => {
      const result = mapTvDetail({
        id: 1399,
        name: 'GoT',
        overview: '',
        poster_path: null,
        backdrop_path: null,
        first_air_date: '2011-04-17',
        vote_average: 8.4,
        genres: [],
        status: 'Ended',
        seasons: [
          { season_number: 1, episode_count: 10 },
          { season_number: 2, episode_count: 10 },
        ],
      });

      expect(result.seasonCount).toBe(2);
    });

    it('tv detail defaults seasonCount to 0, not null, when the seasons array is empty', () => {
      const result = mapTvDetail({
        id: 1,
        name: 'X',
        overview: '',
        poster_path: null,
        backdrop_path: null,
        first_air_date: '',
        vote_average: 0,
        genres: [],
        status: 'Ended',
        seasons: [],
      });

      expect(result.seasonCount).toBe(0);
    });
  });

  describe('mapSeasonEpisodes', () => {
    it('maps season + nested episode fields', () => {
      const result = mapSeasonEpisodes({
        season_number: 1,
        name: 'Season 1',
        air_date: '2011-04-17',
        episodes: [
          {
            episode_number: 1,
            name: 'Winter Is Coming',
            air_date: '2011-04-17',
            overview: '...',
            still_path: '/still.jpg',
          },
        ],
      });

      expect(result.seasonNumber).toBe(1);
      expect(result.episodes).toHaveLength(1);
      expect(result.episodes[0].episodeNumber).toBe(1);
      expect(result.episodes[0].airDate).toBeInstanceOf(Date);
    });

    it('defaults episodes to [] when TMDB omits the field', () => {
      const result = mapSeasonEpisodes({
        season_number: 0,
        name: 'Specials',
        air_date: null,
        episodes: undefined as any,
      });

      expect(result.episodes).toEqual([]);
      expect(result.airDate).toBeNull();
    });
  });

  describe('mapWatchProviders', () => {
    it('maps flatrate/rent/buy entries for the requested region', () => {
      const result = mapWatchProviders(
        {
          results: {
            US: {
              link: 'https://www.themoviedb.org/x',
              flatrate: [{ provider_name: 'Netflix', logo_path: '/nf.png' }],
              rent: [],
              buy: [],
            },
          },
        },
        'US',
      );

      expect(result).toEqual({
        region: 'US',
        link: 'https://www.themoviedb.org/x',
        flatrate: [{ providerName: 'Netflix', logoPath: '/nf.png' }],
        rent: [],
        buy: [],
      });
    });

    it('returns null when the requested region has no data at all', () => {
      const result = mapWatchProviders({ results: {} }, 'US');
      expect(result).toBeNull();
    });

    it('defaults missing flatrate/rent/buy arrays to [] rather than undefined', () => {
      const result = mapWatchProviders(
        { results: { US: { link: 'https://x' } } },
        'US',
      );

      expect(result?.flatrate).toEqual([]);
      expect(result?.rent).toEqual([]);
      expect(result?.buy).toEqual([]);
    });

    it('defaults a missing link to null', () => {
      const result = mapWatchProviders({ results: { US: {} as any } }, 'US');

      expect(result?.link).toBeNull();
    });
  });
});
