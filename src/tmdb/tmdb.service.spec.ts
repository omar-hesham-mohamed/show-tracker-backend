import { BadGatewayException, Logger, NotFoundException } from '@nestjs/common';
import { MediaType } from '@prisma/client';
import { of, throwError } from 'rxjs';
import { TmdbService } from './tmdb.service';
import { METADATA_TTL_MS, WATCH_PROVIDER_TTL_MS } from './tmdb.constants';

function axiosError(status: number) {
  return { isAxiosError: true, response: { status } };
}

function networkError() {
  return { isAxiosError: true, message: 'timeout' }; // no .response — not a 404
}

function fresh(msAgo = 1000) {
  return new Date(Date.now() - msAgo);
}

function stale(ttl: number) {
  return new Date(Date.now() - ttl - 1000);
}

describe('TmdbService', () => {
  let http: { get: jest.Mock };
  let prisma: {
    show: { findUnique: jest.Mock; upsert: jest.Mock; update: jest.Mock };
    episode: { findMany: jest.Mock; upsert: jest.Mock };
  };
  let service: TmdbService;

  beforeEach(() => {
    http = { get: jest.fn() };
    prisma = {
      show: { findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn() },
      episode: { findMany: jest.fn(), upsert: jest.fn() },
    };
    service = new TmdbService(http as any, prisma as any);
    // TmdbService intentionally logs on every fallback/failure path (useful in
    // production); silence it here so expected-error test output stays readable.
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ---------------------------------------------------------------------
  // getShowDetail — cache-aside + resilience
  // ---------------------------------------------------------------------
  describe('getShowDetail', () => {
    const cachedShow = {
      id: 'show-1',
      tmdbId: 1399,
      mediaType: MediaType.tv,
      title: 'Game of Thrones',
      overview: '...',
      posterPath: null,
      backdropPath: null,
      releaseDate: new Date('2011-04-17'),
      tmdbRating: 8.4,
      genres: ['Drama'],
      status: 'Ended',
      seasonCount: 8,
      lastSyncedAt: fresh(),
    };

    it('serves a fresh cache hit without ever calling TMDB', async () => {
      prisma.show.findUnique.mockResolvedValue(cachedShow);

      const result = await service.getShowDetail(MediaType.tv, 1399);

      expect(http.get).not.toHaveBeenCalled();
      expect(result.title).toBe('Game of Thrones');
    });

    it('fetches + upserts on a cold cache miss', async () => {
      prisma.show.findUnique.mockResolvedValue(null);
      http.get.mockReturnValue(
        of({
          data: {
            id: 1399,
            name: 'Game of Thrones',
            overview: '...',
            poster_path: null,
            backdrop_path: null,
            first_air_date: '2011-04-17',
            vote_average: 8.4,
            genres: [],
            status: 'Ended',
            seasons: [{ season_number: 1, episode_count: 10 }],
          },
        }),
      );
      prisma.show.upsert.mockResolvedValue({ ...cachedShow });

      const result = await service.getShowDetail(MediaType.tv, 1399);

      expect(http.get).toHaveBeenCalledWith('/tv/1399', { params: undefined });
      expect(prisma.show.upsert).toHaveBeenCalled();
      expect(result.title).toBe('Game of Thrones');
    });

    it('refetches when the cached row is past the metadata TTL', async () => {
      prisma.show.findUnique.mockResolvedValue({
        ...cachedShow,
        lastSyncedAt: stale(METADATA_TTL_MS),
      });
      http.get.mockReturnValue(
        of({
          data: {
            id: 1399,
            name: 'Game of Thrones',
            overview: 'updated',
            poster_path: null,
            backdrop_path: null,
            first_air_date: '2011-04-17',
            vote_average: 8.5,
            genres: [],
            status: 'Ended',
            seasons: [],
          },
        }),
      );
      prisma.show.upsert.mockResolvedValue({
        ...cachedShow,
        overview: 'updated',
      });

      await service.getShowDetail(MediaType.tv, 1399);

      expect(http.get).toHaveBeenCalled();
    });

    it('on a TMDB failure with an existing (even stale) cache, serves the stale copy instead of failing the request', async () => {
      const staleShow = { ...cachedShow, lastSyncedAt: stale(METADATA_TTL_MS) };
      prisma.show.findUnique.mockResolvedValue(staleShow);
      http.get.mockReturnValue(throwError(() => networkError()));

      const result = await service.getShowDetail(MediaType.tv, 1399);

      expect(result.title).toBe('Game of Thrones');
      expect(prisma.show.upsert).not.toHaveBeenCalled();
    });

    it('throws 404 NotFoundException when TMDB itself 404s and there is no cache to fall back on', async () => {
      prisma.show.findUnique.mockResolvedValue(null);
      http.get.mockReturnValue(throwError(() => axiosError(404)));

      await expect(service.getShowDetail(MediaType.tv, 999999)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws 502 BadGatewayException for a non-404 TMDB failure with no cache', async () => {
      prisma.show.findUnique.mockResolvedValue(null);
      http.get.mockReturnValue(throwError(() => networkError()));

      await expect(service.getShowDetail(MediaType.tv, 1399)).rejects.toThrow(
        BadGatewayException,
      );
    });

    it('a 404 with an existing stale cache still resolves to the stale data, not a 404 (documented edge case, not a bug)', async () => {
      const staleShow = { ...cachedShow, lastSyncedAt: stale(METADATA_TTL_MS) };
      prisma.show.findUnique.mockResolvedValue(staleShow);
      http.get.mockReturnValue(throwError(() => axiosError(404)));

      const result = await service.getShowDetail(MediaType.tv, 1399);
      expect(result.title).toBe('Game of Thrones');
    });
  });

  // ---------------------------------------------------------------------
  // getWatchProviders
  // ---------------------------------------------------------------------
  describe('getWatchProviders', () => {
    const showRow = {
      id: 'show-1',
      tmdbId: 1399,
      mediaType: MediaType.tv,
      watchProviders: null,
      watchProvidersSyncedAt: null,
    };

    it('throws NotFoundException immediately if the show has never been cached — never calls TMDB', async () => {
      prisma.show.findUnique.mockResolvedValue(null);

      await expect(
        service.getWatchProviders(MediaType.tv, 1399),
      ).rejects.toThrow(NotFoundException);
      expect(http.get).not.toHaveBeenCalled();
    });

    it('serves a fresh cached copy without calling TMDB', async () => {
      prisma.show.findUnique.mockResolvedValue({
        ...showRow,
        watchProviders: {
          region: 'US',
          link: null,
          flatrate: [],
          rent: [],
          buy: [],
        },
        watchProvidersSyncedAt: fresh(),
      });

      await service.getWatchProviders(MediaType.tv, 1399);

      expect(http.get).not.toHaveBeenCalled();
    });

    it('[documents known behavior] ignores the caller-supplied region entirely — always fetches/serves US, regardless of what is passed', async () => {
      prisma.show.findUnique.mockResolvedValue(showRow);
      http.get.mockReturnValue(
        of({
          data: {
            results: {
              US: {
                link: 'https://us',
                flatrate: [{ provider_name: 'Netflix', logo_path: '/n.png' }],
              },
              FR: {
                link: 'https://fr',
                flatrate: [{ provider_name: 'Canal+', logo_path: '/c.png' }],
              },
            },
          },
        }),
      );
      prisma.show.update.mockResolvedValue({});

      const result = await service.getWatchProviders(MediaType.tv, 1399, 'FR');

      expect(result.region).toBe('US');
      expect(result.flatrate[0].providerName).toBe('Netflix');
    });

    it('refetches when watch-provider data is past its own TTL', async () => {
      prisma.show.findUnique.mockResolvedValue({
        ...showRow,
        watchProviders: {
          region: 'US',
          link: null,
          flatrate: [],
          rent: [],
          buy: [],
        },
        watchProvidersSyncedAt: stale(WATCH_PROVIDER_TTL_MS),
      });
      http.get.mockReturnValue(
        of({ data: { results: { US: { link: null } } } }),
      );
      prisma.show.update.mockResolvedValue({});

      await service.getWatchProviders(MediaType.tv, 1399);

      expect(http.get).toHaveBeenCalled();
    });

    it('on TMDB failure with an existing cached copy, serves stale data instead of failing', async () => {
      prisma.show.findUnique.mockResolvedValue({
        ...showRow,
        watchProviders: {
          region: 'US',
          link: 'https://stale',
          flatrate: [],
          rent: [],
          buy: [],
        },
        watchProvidersSyncedAt: stale(WATCH_PROVIDER_TTL_MS),
      });
      http.get.mockReturnValue(throwError(() => networkError()));

      const result = await service.getWatchProviders(MediaType.tv, 1399);
      expect(result.link).toBe('https://stale');
    });

    it('throws 502 (never 404) on TMDB failure with nothing cached yet', async () => {
      prisma.show.findUnique.mockResolvedValue(showRow);
      http.get.mockReturnValue(throwError(() => axiosError(404)));

      await expect(
        service.getWatchProviders(MediaType.tv, 1399),
      ).rejects.toThrow(BadGatewayException);
    });
  });

  // ---------------------------------------------------------------------
  // getSeasonDetail
  // ---------------------------------------------------------------------
  describe('getSeasonDetail', () => {
    it('throws NotFoundException when the parent show was never cached', async () => {
      prisma.show.findUnique.mockResolvedValue(null);

      await expect(service.getSeasonDetail(1399, 1)).rejects.toThrow(
        NotFoundException,
      );
      expect(http.get).not.toHaveBeenCalled();
    });

    it('serves fresh cached episodes without calling TMDB', async () => {
      prisma.show.findUnique.mockResolvedValue({ id: 'show-1' });
      prisma.episode.findMany.mockResolvedValue([
        {
          id: 'ep-1',
          episodeNumber: 1,
          name: 'Winter Is Coming',
          airDate: new Date('2011-04-17'),
          overview: '...',
          stillPath: null,
          lastSyncedAt: fresh(),
        },
      ]);

      const result = await service.getSeasonDetail(1399, 1);

      expect(http.get).not.toHaveBeenCalled();
      expect(result.name).toBe('Season 1');
      expect(result.episodes).toHaveLength(1);
    });

    it('synthesizes "Specials" for season 0 rather than "Season 0"', async () => {
      prisma.show.findUnique.mockResolvedValue({ id: 'show-1' });
      prisma.episode.findMany.mockResolvedValue([
        {
          id: 'ep-1',
          episodeNumber: 1,
          name: 'A Special',
          airDate: null,
          overview: '',
          stillPath: null,
          lastSyncedAt: fresh(),
        },
      ]);

      const result = await service.getSeasonDetail(1399, 0);
      expect(result.name).toBe('Specials');
    });

    it('fetches + upserts episodes on a cache miss', async () => {
      prisma.show.findUnique.mockResolvedValue({ id: 'show-1' });
      prisma.episode.findMany.mockResolvedValue([]);
      http.get.mockReturnValue(
        of({
          data: {
            season_number: 1,
            name: 'Season 1',
            air_date: '2011-04-17',
            episodes: [
              {
                episode_number: 1,
                name: 'Winter Is Coming',
                air_date: '2011-04-17',
                overview: '...',
                still_path: null,
              },
            ],
          },
        }),
      );
      prisma.episode.upsert.mockResolvedValue({
        id: 'ep-1',
        episodeNumber: 1,
        name: 'Winter Is Coming',
        airDate: new Date('2011-04-17'),
        overview: '...',
        stillPath: null,
      });

      const result = await service.getSeasonDetail(1399, 1);

      expect(prisma.episode.upsert).toHaveBeenCalledTimes(1);
      expect(result.episodes).toHaveLength(1);
    });

    it('404s when TMDB has no such season and nothing is cached', async () => {
      prisma.show.findUnique.mockResolvedValue({ id: 'show-1' });
      prisma.episode.findMany.mockResolvedValue([]);
      http.get.mockReturnValue(throwError(() => axiosError(404)));

      await expect(service.getSeasonDetail(1399, 99)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('serves stale cached episodes on TMDB failure rather than erroring', async () => {
      prisma.show.findUnique.mockResolvedValue({ id: 'show-1' });
      prisma.episode.findMany.mockResolvedValue([
        {
          id: 'ep-1',
          episodeNumber: 1,
          name: 'Winter Is Coming',
          airDate: new Date('2011-04-17'),
          overview: '...',
          stillPath: null,
          lastSyncedAt: stale(METADATA_TTL_MS),
        },
      ]);
      http.get.mockReturnValue(throwError(() => networkError()));

      const result = await service.getSeasonDetail(1399, 1);
      expect(result.episodes).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------
  // getRecommendations — never cached (post-design-change)
  // ---------------------------------------------------------------------
  describe('getRecommendations', () => {
    it('calls the movie recommendations endpoint for mediaType=movie', async () => {
      http.get.mockReturnValue(of({ data: { results: [] } }));

      await service.getRecommendations(MediaType.movie, 42);

      expect(http.get).toHaveBeenCalledWith('/movie/42/recommendations', {
        params: undefined,
      });
    });

    it('calls the tv recommendations endpoint for mediaType=tv', async () => {
      http.get.mockReturnValue(of({ data: { results: [] } }));

      await service.getRecommendations(MediaType.tv, 1399);

      expect(http.get).toHaveBeenCalledWith('/tv/1399/recommendations', {
        params: undefined,
      });
    });

    it('maps results using the same lightweight shape as search', async () => {
      http.get.mockReturnValue(
        of({
          data: {
            results: [
              {
                id: 94997,
                name: 'House of the Dragon',
                overview: '',
                poster_path: '/hotd.jpg',
                first_air_date: '2022-08-21',
                vote_average: 8.4,
              },
            ],
          },
        }),
      );

      const result = await service.getRecommendations(MediaType.tv, 1399);

      expect(result.results).toEqual([
        {
          tmdbId: 94997,
          mediaType: MediaType.tv,
          title: 'House of the Dragon',
          posterPath: '/hotd.jpg',
          releaseDate: '2022-08-21',
          tmdbRating: 8.4,
        },
      ]);
    });

    it('never touches the Show table — confirms the "live proxy, no caching" design decision', async () => {
      http.get.mockReturnValue(of({ data: { results: [] } }));

      await service.getRecommendations(MediaType.tv, 1399);

      expect(prisma.show.findUnique).not.toHaveBeenCalled();
      expect(prisma.show.upsert).not.toHaveBeenCalled();
      expect(prisma.show.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException on an unknown TMDB id (no cache to check first, unlike watch-providers/seasons)', async () => {
      http.get.mockReturnValue(throwError(() => axiosError(404)));

      await expect(
        service.getRecommendations(MediaType.movie, 999999),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadGatewayException on a non-404 TMDB failure', async () => {
      http.get.mockReturnValue(throwError(() => networkError()));

      await expect(
        service.getRecommendations(MediaType.movie, 1),
      ).rejects.toThrow(BadGatewayException);
    });

    it('returns an empty array (not an error) when TMDB has no recommendations for a title — client is expected to hide the carousel', async () => {
      http.get.mockReturnValue(of({ data: { results: [] } }));

      const result = await service.getRecommendations(MediaType.movie, 1);
      expect(result.results).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------
  // search
  // ---------------------------------------------------------------------
  describe('search', () => {
    it('routes type=movie to /search/movie with include_adult=false', async () => {
      http.get.mockReturnValue(
        of({
          data: { page: 1, results: [], total_pages: 0, total_results: 0 },
        }),
      );

      await service.search('dune', 'movie', 1);

      expect(http.get).toHaveBeenCalledWith('/search/movie', {
        params: { query: 'dune', page: 1, include_adult: false },
      });
    });

    it('routes type=tv to /search/tv', async () => {
      http.get.mockReturnValue(
        of({
          data: { page: 1, results: [], total_pages: 0, total_results: 0 },
        }),
      );

      await service.search('got', 'tv', 1);

      expect(http.get).toHaveBeenCalledWith('/search/tv', {
        params: { query: 'got', page: 1, include_adult: false },
      });
    });

    it('routes type=all to /search/multi and drops person/collection results', async () => {
      http.get.mockReturnValue(
        of({
          data: {
            page: 1,
            total_pages: 1,
            total_results: 3,
            results: [
              {
                id: 1,
                media_type: 'movie',
                title: 'Dune',
                release_date: '2021',
                vote_average: 8,
              },
              { id: 2, media_type: 'person', name: 'Some Actor' },
              { id: 3, media_type: 'collection', name: 'Some Collection' },
            ],
          },
        }),
      );

      const result = await service.search('dune', 'all', 1);

      expect(http.get).toHaveBeenCalledWith('/search/multi', {
        params: { query: 'dune', page: 1, include_adult: false },
      });
      expect(result.results).toHaveLength(1);
      expect(result.results[0].title).toBe('Dune');
    });

    it('does not crash on a query containing special/injection-shaped characters — passed through as an opaque query param', async () => {
      http.get.mockReturnValue(
        of({
          data: { page: 1, results: [], total_pages: 0, total_results: 0 },
        }),
      );

      await service.search("'; DROP TABLE shows; --", 'all', 1);

      expect(http.get).toHaveBeenCalledWith('/search/multi', {
        params: {
          query: "'; DROP TABLE shows; --",
          page: 1,
          include_adult: false,
        },
      });
    });
  });
});
