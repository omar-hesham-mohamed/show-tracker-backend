import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { cleanupUsers, createTestApp, uniqueSuffix } from './utils/test-app';

describe('Users (e2e)', () => {
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

  async function signup() {
    const suffix = uniqueSuffix();
    const body = {
      email: `e2e-users-${suffix}@example.com`,
      username: `e2eusers${suffix}`,
      password: 'testpass123',
      displayName: 'E2E Users Tester',
      timezone: 'UTC',
    };
    const res = await request(server)
      .post('/api/v1/auth/signup')
      .send(body)
      .expect(201);
    userIds.push(res.body.user.id as string);
    return {
      accessToken: res.body.accessToken as string,
      body,
      userId: res.body.user.id as string,
    };
  }

  it('401s without a token', async () => {
    await request(server).get('/api/v1/users/me').expect(401);
  });

  it('401s with a garbage token', async () => {
    await request(server)
      .get('/api/v1/users/me')
      .set('Authorization', 'Bearer not-a-real-jwt')
      .expect(401);
  });

  it('returns the documented profile shape for a freshly-signed-up user with no activity yet', async () => {
    const { accessToken, body, userId } = await signup();

    const res = await request(server)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body).toEqual({
      id: userId,
      username: body.username,
      email: body.email,
      displayName: body.displayName,
      avatarUrl: null,
      bio: '',
      timezone: 'UTC',
      isPrivate: false,
      currentStreakCount: 0,
      longestStreakCount: 0,
      lastStreakDate: null,
      followerCount: 0,
      followingCount: 0,
      createdAt: expect.any(String),
    });
    expect(res.body).not.toHaveProperty('passwordHash');
  });

  it('reflects a real streak built via the watch-log endpoints (integration with StreakService)', async () => {
    const { accessToken } = await signup();
    const today = new Date().toISOString().slice(0, 10);

    await request(server)
      .post('/api/v1/watch-log')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tmdbId: 1399,
        mediaType: 'tv',
        status: 'WATCHED',
        watchedAt: today,
      })
      .expect(201);

    const res = await request(server)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.currentStreakCount).toBe(1);
    expect(res.body.longestStreakCount).toBe(1);
    expect(res.body.lastStreakDate).toBe(today);
  });

  describe('PATCH /users/me', () => {
    it('applies a partial update and returns the same shape as GET /users/me', async () => {
      const { accessToken } = await signup();

      const res = await request(server)
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ displayName: 'Mazen A.', bio: 'watching too much TV' })
        .expect(200);

      expect(res.body.displayName).toBe('Mazen A.');
      expect(res.body.bio).toBe('watching too much TV');
    });

    it('toggles isPrivate', async () => {
      const { accessToken } = await signup();

      const res = await request(server)
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ isPrivate: true })
        .expect(200);

      expect(res.body.isPrivate).toBe(true);
    });

    it('400s an invalid timezone string', async () => {
      const { accessToken } = await signup();

      await request(server)
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ timezone: 'Not/AZone' })
        .expect(400);
    });

    it('400s an explicit null on a field instead of crashing the DB write', async () => {
      const { accessToken } = await signup();

      await request(server)
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ displayName: null })
        .expect(400);
    });
  });

  describe('GET /users/:username', () => {
    it('404s an unknown username', async () => {
      const { accessToken } = await signup();

      await request(server)
        .get('/api/v1/users/no-such-user')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404);
    });

    it('returns the public shape (no email/timezone/lastStreakDate) for a public profile', async () => {
      const viewer = await signup();
      const target = await signup();

      const res = await request(server)
        .get(`/api/v1/users/${target.body.username}`)
        .set('Authorization', `Bearer ${viewer.accessToken}`)
        .expect(200);

      expect(res.body).toEqual({
        id: target.userId,
        username: target.body.username,
        displayName: target.body.displayName,
        avatarUrl: null,
        bio: '',
        isPrivate: false,
        currentStreakCount: 0,
        longestStreakCount: 0,
        followerCount: 0,
        followingCount: 0,
        isFollowedByMe: false,
        followsMe: false,
      });
    });

    it('works for an unauthenticated (anonymous) caller on a public profile', async () => {
      const target = await signup();

      const res = await request(server)
        .get(`/api/v1/users/${target.body.username}`)
        .expect(200);

      expect(res.body.username).toBe(target.body.username);
    });

    it('returns the minimal stub for a private profile the caller does not follow', async () => {
      const viewer = await signup();
      const target = await signup();
      await request(server)
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${target.accessToken}`)
        .send({ isPrivate: true })
        .expect(200);

      const res = await request(server)
        .get(`/api/v1/users/${target.body.username}`)
        .set('Authorization', `Bearer ${viewer.accessToken}`)
        .expect(200);

      expect(res.body).toEqual({
        id: target.userId,
        username: target.body.username,
        displayName: target.body.displayName,
        avatarUrl: null,
        isPrivate: true,
        isFollowedByMe: false,
      });
    });

    it('returns the full profile for the target viewing their own private profile (self-view bypass)', async () => {
      const target = await signup();
      await request(server)
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${target.accessToken}`)
        .send({ isPrivate: true })
        .expect(200);

      const res = await request(server)
        .get(`/api/v1/users/${target.body.username}`)
        .set('Authorization', `Bearer ${target.accessToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('currentStreakCount');
    });
  });
});
