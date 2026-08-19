import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { cleanupUsers, createTestApp, uniqueSuffix } from './utils/test-app';

/**
 * Hits the real TMDB API (per project decision — no HTTP mocking here), so
 * this needs TMDB_ACCESS_TOKEN configured and network access. Verifies the
 * actual cache-aside path end-to-end: TMDB's real current response shape,
 * mapped through TmdbService, upserted into Postgres, and served back out
 * over the real HTTP/guard/validation stack — none of which the mocked
 * tmdb.service.spec.ts unit tests can catch (see plan.md's stale-Prisma-
 * client bug, found via exactly this kind of live check).
 */
describe('Shows / TMDB (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let accessToken: string;
  const userIds: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();

    const suffix = uniqueSuffix();
    const signup = await request(server)
      .post('/api/v1/auth/signup')
      .send({
        email: `e2e-shows-${suffix}@example.com`,
        username: `e2eshows${suffix}`,
        password: 'testpass123',
        displayName: 'E2E Shows Tester',
        timezone: 'UTC',
      })
      .expect(201);
    accessToken = signup.body.accessToken as string;
    userIds.push(signup.body.user.id as string);
  });

  afterAll(async () => {
    await cleanupUsers(app, userIds);
    await app.close();
  });

  function auth() {
    return { Authorization: `Bearer ${accessToken}` };
  }

  it('rejects unauthenticated requests (global JwtAuthGuard)', async () => {
    await request(server).get('/api/v1/shows/search?query=dune').expect(401);
  });

  describe('GET /shows/search', () => {
    it('searches TV shows', async () => {
      const res = await request(server)
        .get('/api/v1/shows/search')
        .query({ query: 'Breaking Bad', type: 'tv' })
        .set(auth())
        .expect(200);

      expect(res.body.results.length).toBeGreaterThan(0);
      expect(res.body.results[0]).toEqual(
        expect.objectContaining({
          mediaType: 'tv',
          tmdbId: expect.any(Number),
        }),
      );
    });

    it('searches movies', async () => {
      const res = await request(server)
        .get('/api/v1/shows/search')
        .query({ query: 'Inception', type: 'movie' })
        .set(auth())
        .expect(200);

      expect(res.body.results.length).toBeGreaterThan(0);
      expect(res.body.results[0].mediaType).toBe('movie');
    });

    it('defaults to type=all and only ever returns movie/tv results', async () => {
      const res = await request(server)
        .get('/api/v1/shows/search')
        .query({ query: 'Batman' })
        .set(auth())
        .expect(200);

      expect(res.body.results.length).toBeGreaterThan(0);
      for (const result of res.body.results) {
        expect(['movie', 'tv']).toContain(result.mediaType);
      }
    });
  });

  describe('GET /shows/:mediaType/:tmdbId', () => {
    it('fetches, caches, and re-serves a TV show consistently', async () => {
      const first = await request(server)
        .get('/api/v1/shows/tv/1399')
        .set(auth())
        .expect(200);
      expect(first.body.title).toEqual(expect.any(String));

      const second = await request(server)
        .get('/api/v1/shows/tv/1399')
        .set(auth())
        .expect(200);

      // Same internal cache row both times.
      expect(second.body.id).toBe(first.body.id);
      expect(second.body.tmdbId).toBe(1399);
    });

    it('fetches a movie', async () => {
      const res = await request(server)
        .get('/api/v1/shows/movie/27205') // Inception
        .set(auth())
        .expect(200);

      expect(res.body.mediaType).toBe('movie');
    });

    it('404s an unknown TMDB id', async () => {
      await request(server)
        .get('/api/v1/shows/tv/999999999')
        .set(auth())
        .expect(404);
    });
  });

  it('GET /shows/:mediaType/:tmdbId/watch-providers returns the expected shape', async () => {
    const res = await request(server)
      .get('/api/v1/shows/tv/1399/watch-providers')
      .set(auth())
      .expect(200);

    expect(res.body).toEqual(
      expect.objectContaining({
        region: expect.any(String),
        flatrate: expect.any(Array),
        rent: expect.any(Array),
        buy: expect.any(Array),
      }),
    );
  });

  it('GET /shows/:mediaType/:tmdbId/recommendations returns a results list', async () => {
    const res = await request(server)
      .get('/api/v1/shows/tv/1399/recommendations')
      .set(auth())
      .expect(200);

    expect(Array.isArray(res.body.results)).toBe(true);
  });

  it('GET /shows/tv/:tmdbId/seasons/:seasonNumber returns episodes', async () => {
    const res = await request(server)
      .get('/api/v1/shows/tv/1399/seasons/1')
      .set(auth())
      .expect(200);

    expect(res.body.seasonNumber).toBe(1);
    expect(res.body.episodes.length).toBeGreaterThan(0);
  });
});
