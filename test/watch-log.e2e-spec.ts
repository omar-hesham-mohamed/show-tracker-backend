import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { cleanupUsers, createTestApp, uniqueSuffix } from './utils/test-app';

/**
 * Full CRUD flow against real Postgres + real TMDB (project decision — see
 * shows.e2e-spec.ts). Codifies the manual walkthrough done during Phase 4
 * verification as a repeatable test instead of one-off curl commands.
 */
describe('Watch Log (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let userAToken: string;
  let userBToken: string;
  const userIds: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();

    const suffix = uniqueSuffix();
    const signup = async (label: string) => {
      const res = await request(server)
        .post('/api/v1/auth/signup')
        .send({
          email: `e2e-watchlog-${label}-${suffix}@example.com`,
          username: `e2ewl${label}${suffix}`,
          password: 'testpass123',
          displayName: `E2E WatchLog ${label}`,
          timezone: 'UTC',
        })
        .expect(201);
      userIds.push(res.body.user.id as string);
      return res.body.accessToken as string;
    };

    userAToken = await signup('a');
    userBToken = await signup('b');
  });

  afterAll(async () => {
    await cleanupUsers(app, userIds);
    await app.close();
  });

  function authA() {
    return { Authorization: `Bearer ${userAToken}` };
  }
  function authB() {
    return { Authorization: `Bearer ${userBToken}` };
  }

  it('runs the full create -> list -> update -> delete lifecycle, with ownership enforced throughout', async () => {
    // Create — real TMDB fetch + cache-aside upsert into Show.
    const created = await request(server)
      .post('/api/v1/watch-log')
      .set(authA())
      .send({
        tmdbId: 1399,
        mediaType: 'tv',
        status: 'WATCHED',
        rating: 4.5,
        watchedAt: '2026-08-07',
        note: 'e2e create',
      })
      .expect(201);
    const entryId = created.body.id as string;
    expect(created.body.show).toEqual(
      expect.objectContaining({ tmdbId: 1399 }),
    );
    expect(created.body.streakAfterWrite).toBeUndefined(); // deferred to Phase 5 — see plan.md

    // Second entry for pagination.
    await request(server)
      .post('/api/v1/watch-log')
      .set(authA())
      .send({
        tmdbId: 1399,
        mediaType: 'tv',
        status: 'WANT_TO_WATCH',
        watchedAt: '2026-08-06',
      })
      .expect(201);

    // List — cursor round-trip.
    const page1 = await request(server)
      .get('/api/v1/watch-log/me')
      .query({ limit: 1 })
      .set(authA())
      .expect(200);
    expect(page1.body.items).toHaveLength(1);
    expect(page1.body.nextCursor).toEqual(expect.any(String));

    const page2 = await request(server)
      .get('/api/v1/watch-log/me')
      .query({ limit: 1, cursor: page1.body.nextCursor })
      .set(authA())
      .expect(200);
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.nextCursor).toBeNull();
    expect(page2.body.items[0].id).not.toBe(page1.body.items[0].id);

    // Owner can read/update; a different user gets 404, not 403 (no
    // existence leak) — matches watch-log.service.spec.ts's ownership tests.
    await request(server)
      .get(`/api/v1/watch-log/${entryId}`)
      .set(authA())
      .expect(200);
    await request(server)
      .get(`/api/v1/watch-log/${entryId}`)
      .set(authB())
      .expect(404);

    const updated = await request(server)
      .patch(`/api/v1/watch-log/${entryId}`)
      .set(authA())
      .send({ note: 'e2e updated', rating: 5 })
      .expect(200);
    expect(updated.body.note).toBe('e2e updated');
    expect(updated.body.rating).toBe(5);

    await request(server)
      .patch(`/api/v1/watch-log/${entryId}`)
      .set(authB())
      .send({ note: 'hijack attempt' })
      .expect(404);

    // Off-grid rating rejected by the global ValidationPipe + custom validator.
    await request(server)
      .patch(`/api/v1/watch-log/${entryId}`)
      .set(authA())
      .send({ rating: 4.3 })
      .expect(400);

    await request(server)
      .delete(`/api/v1/watch-log/${entryId}`)
      .set(authB())
      .expect(404);
    await request(server)
      .delete(`/api/v1/watch-log/${entryId}`)
      .set(authA())
      .expect(204);
    await request(server)
      .get(`/api/v1/watch-log/${entryId}`)
      .set(authA())
      .expect(404);
  });

  it('400s a malformed pagination cursor instead of crashing (bug found via testing — see plan.md)', async () => {
    const badCursor = Buffer.from(
      JSON.stringify({ watchedAt: 'not-a-date', id: 'entry-1' }),
      'utf8',
    ).toString('base64url');

    await request(server)
      .get('/api/v1/watch-log/me')
      .query({ cursor: badCursor })
      .set(authA())
      .expect(400);
  });

  it('400s an explicit null on a PATCH field instead of crashing the DB write (bug found via testing — see plan.md)', async () => {
    const created = await request(server)
      .post('/api/v1/watch-log')
      .set(authA())
      .send({
        tmdbId: 1399,
        mediaType: 'tv',
        status: 'WATCHED',
        watchedAt: '2026-08-07',
      })
      .expect(201);

    await request(server)
      .patch(`/api/v1/watch-log/${created.body.id}`)
      .set(authA())
      .send({ status: null })
      .expect(400);

    await request(server)
      .delete(`/api/v1/watch-log/${created.body.id}`)
      .set(authA())
      .expect(204);
  });

  it('404s creating an entry with an episodeId that belongs to a different show', async () => {
    // A real episode id from a different show (tv/1396 - Breaking Bad,
    // season 1 episode 1) used against tv/1399 (Game of Thrones). Season
    // detail requires its parent Show to already be cached — no implicit
    // show-fetch side effect (endpoints.md) — so fetch it first.
    await request(server).get('/api/v1/shows/tv/1396').set(authA()).expect(200);
    const bbEpisode = await request(server)
      .get('/api/v1/shows/tv/1396/seasons/1')
      .set(authA())
      .expect(200);
    const foreignEpisodeId = bbEpisode.body.episodes[0].id as string;

    await request(server)
      .post('/api/v1/watch-log')
      .set(authA())
      .send({
        tmdbId: 1399,
        mediaType: 'tv',
        status: 'WATCHED',
        watchedAt: '2026-08-07',
        episodeId: foreignEpisodeId,
      })
      .expect(404);
  });

  it('400s a spoofed future watchedAt', async () => {
    const farFuture = new Date();
    farFuture.setUTCFullYear(farFuture.getUTCFullYear() + 1);

    await request(server)
      .post('/api/v1/watch-log')
      .set(authA())
      .send({
        tmdbId: 1399,
        mediaType: 'tv',
        status: 'WATCHED',
        watchedAt: farFuture.toISOString().slice(0, 10),
      })
      .expect(400);
  });
});
