import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { cleanupUsers, createTestApp, uniqueSuffix } from './utils/test-app';

describe('Streak detail + heatmap (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  const userIds: string[] = [];

  beforeAll(async () => {
    // Throttling covered separately (auth-throttle.e2e-spec.ts) — disabled
    // here since this file signs up well over 5 users across its tests.
    app = await createTestApp({ disableThrottling: true });
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await cleanupUsers(app, userIds);
    await app.close();
  });

  async function signup(label: string) {
    const suffix = uniqueSuffix();
    const res = await request(server)
      .post('/api/v1/auth/signup')
      .send({
        email: `e2e-streakdetail-${label}-${suffix}@example.com`,
        username: `e2esd${label}${suffix}`,
        password: 'testpass123',
        displayName: `E2E StreakDetail ${label}`,
        timezone: 'UTC',
      })
      .expect(201);
    userIds.push(res.body.user.id as string);
    return {
      token: res.body.accessToken as string,
      username: res.body.user.username as string,
    };
  }

  function auth(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  describe('GET /users/:username/streak', () => {
    it('404s an unknown username', async () => {
      const viewer = await signup('viewer1');
      await request(server)
        .get('/api/v1/users/no-such-user/streak')
        .set(auth(viewer.token))
        .expect(404);
    });

    it('returns real streak data for a public profile, after logging a WATCHED entry today', async () => {
      const owner = await signup('owner1');
      const today = new Date().toISOString().slice(0, 10);

      await request(server)
        .post('/api/v1/watch-log')
        .set(auth(owner.token))
        .send({
          tmdbId: 1399,
          mediaType: 'tv',
          status: 'WATCHED',
          watchedAt: today,
        })
        .expect(201);

      const res = await request(server)
        .get(`/api/v1/users/${owner.username}/streak`)
        .expect(200);

      expect(res.body).toEqual({
        currentStreakCount: 1,
        longestStreakCount: 1,
        lastStreakDate: today,
      });
    });

    it('403s a private profile the caller does not follow', async () => {
      const owner = await signup('owner2');
      const viewer = await signup('viewer2');
      await request(server)
        .patch('/api/v1/users/me')
        .set(auth(owner.token))
        .send({ isPrivate: true })
        .expect(200);

      await request(server)
        .get(`/api/v1/users/${owner.username}/streak`)
        .set(auth(viewer.token))
        .expect(403);
    });

    it('200s the private owner viewing their own streak (self-view bypass)', async () => {
      const owner = await signup('owner3');
      await request(server)
        .patch('/api/v1/users/me')
        .set(auth(owner.token))
        .send({ isPrivate: true })
        .expect(200);

      await request(server)
        .get(`/api/v1/users/${owner.username}/streak`)
        .set(auth(owner.token))
        .expect(200);
    });
  });

  describe('GET /users/:username/streak/heatmap', () => {
    it('returns a zero-filled 365-day array reflecting real activity', async () => {
      const owner = await signup('owner4');
      const today = new Date().toISOString().slice(0, 10);

      await request(server)
        .post('/api/v1/watch-log')
        .set(auth(owner.token))
        .send({
          tmdbId: 1399,
          mediaType: 'tv',
          status: 'WATCHED',
          watchedAt: today,
        })
        .expect(201);

      const res = await request(server)
        .get(`/api/v1/users/${owner.username}/streak/heatmap`)
        .expect(200);

      expect(res.body.days).toHaveLength(365);
      const todayEntry = res.body.days.find(
        (d: { date: string }) => d.date === today,
      );
      expect(todayEntry.count).toBe(1);
      const zeroDays = res.body.days.filter(
        (d: { count: number }) => d.count === 0,
      );
      expect(zeroDays.length).toBe(364);
    });

    it('403s a private profile the caller does not follow', async () => {
      const owner = await signup('owner5');
      const viewer = await signup('viewer5');
      await request(server)
        .patch('/api/v1/users/me')
        .set(auth(owner.token))
        .send({ isPrivate: true })
        .expect(200);

      await request(server)
        .get(`/api/v1/users/${owner.username}/streak/heatmap`)
        .set(auth(viewer.token))
        .expect(403);
    });
  });
});
