import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { cleanupUsers, createTestApp, uniqueSuffix } from './utils/test-app';

describe('Users (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  const userIds: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
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
});
