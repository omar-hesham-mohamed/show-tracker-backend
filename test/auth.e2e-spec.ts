import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { cleanupUsers, createTestApp, uniqueSuffix } from './utils/test-app';

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  const userIds: string[] = [];

  beforeAll(async () => {
    // Throttling itself is covered separately (auth-throttle.e2e-spec.ts) —
    // disabled here so this file's ~15 signup/login calls across many small,
    // focused tests don't trip the 5-req/60s limit and produce spurious 429s.
    app = await createTestApp({ disableThrottling: true });
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await cleanupUsers(app, userIds);
    await app.close();
  });

  function signupBody(overrides: Record<string, unknown> = {}) {
    const suffix = uniqueSuffix();
    return {
      email: `e2e-auth-${suffix}@example.com`,
      username: `e2eauth${suffix}`,
      password: 'testpass123',
      displayName: 'E2E Auth Tester',
      timezone: 'UTC',
      ...overrides,
    };
  }

  describe('POST /auth/signup', () => {
    it('creates a user and returns access + refresh tokens', async () => {
      const body = signupBody();

      const res = await request(server)
        .post('/api/v1/auth/signup')
        .send(body)
        .expect(201);

      userIds.push(res.body.user.id as string);
      expect(res.body).toEqual(
        expect.objectContaining({
          accessToken: expect.any(String),
          refreshToken: expect.any(String),
          user: expect.objectContaining({
            username: body.username,
            email: body.email,
          }),
        }),
      );
    });

    it('409s on a duplicate email', async () => {
      const body = signupBody();
      const first = await request(server)
        .post('/api/v1/auth/signup')
        .send(body)
        .expect(201);
      userIds.push(first.body.user.id as string);

      await request(server)
        .post('/api/v1/auth/signup')
        .send(signupBody({ email: body.email }))
        .expect(409);
    });

    it('409s on a duplicate username', async () => {
      const body = signupBody();
      const first = await request(server)
        .post('/api/v1/auth/signup')
        .send(body)
        .expect(201);
      userIds.push(first.body.user.id as string);

      await request(server)
        .post('/api/v1/auth/signup')
        .send(signupBody({ username: body.username }))
        .expect(409);
    });

    it('400s and reports details when required fields are missing', async () => {
      const res = await request(server)
        .post('/api/v1/auth/signup')
        .send({ email: 'incomplete@example.com' })
        .expect(400);

      expect(res.body.details.length).toBeGreaterThan(0);
    });

    it('400s on an unknown extra field (global ValidationPipe forbidNonWhitelisted)', async () => {
      await request(server)
        .post('/api/v1/auth/signup')
        .send(signupBody({ isAdmin: true }))
        .expect(400);
    });

    it('409s cleanly (not 500) when two concurrent signups race on the same email (bug found via testing — see plan.md)', async () => {
      const body = signupBody();

      const [a, b] = await Promise.allSettled([
        request(server).post('/api/v1/auth/signup').send(body),
        request(server).post('/api/v1/auth/signup').send(body),
      ]);

      const statuses = [a, b].map((r) =>
        r.status === 'fulfilled' ? r.value.status : -1,
      );
      // Exactly one wins (201), the other must be a clean 409 — never a 500
      // from an unhandled P2002 on the DB's own unique constraint.
      expect(statuses.sort()).toEqual([201, 409]);

      const winner = [a, b].find(
        (r) => r.status === 'fulfilled' && r.value.status === 201,
      );
      if (winner?.status === 'fulfilled') {
        userIds.push(winner.value.body.user.id as string);
      }
    });
  });

  describe('POST /auth/login', () => {
    async function signupAndGetCredentials() {
      const body = signupBody();
      const res = await request(server)
        .post('/api/v1/auth/signup')
        .send(body)
        .expect(201);
      userIds.push(res.body.user.id as string);
      return body;
    }

    it('logs in with correct credentials', async () => {
      const credentials = await signupAndGetCredentials();

      const res = await request(server)
        .post('/api/v1/auth/login')
        .send({
          emailOrUsername: credentials.username,
          password: credentials.password,
        })
        .expect(200);

      expect(res.body.accessToken).toEqual(expect.any(String));
    });

    it('401s on a wrong password', async () => {
      const credentials = await signupAndGetCredentials();

      await request(server)
        .post('/api/v1/auth/login')
        .send({
          emailOrUsername: credentials.username,
          password: 'wrong-password',
        })
        .expect(401);
    });

    it('401s on a nonexistent user', async () => {
      await request(server)
        .post('/api/v1/auth/login')
        .send({ emailOrUsername: 'no-such-user', password: 'whatever123' })
        .expect(401);
    });
  });

  describe('POST /auth/refresh — rotation + reuse detection', () => {
    async function signupAndLogin() {
      const body = signupBody();
      const res = await request(server)
        .post('/api/v1/auth/signup')
        .send(body)
        .expect(201);
      userIds.push(res.body.user.id as string);
      return res.body as { accessToken: string; refreshToken: string };
    }

    it('rotates the refresh token and invalidates the old one', async () => {
      const initial = await signupAndLogin();

      const rotated = await request(server)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: initial.refreshToken })
        .expect(200);

      expect(rotated.body.refreshToken).not.toBe(initial.refreshToken);

      // Old, already-rotated token must no longer work.
      await request(server)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: initial.refreshToken })
        .expect(401);
    });

    it('reusing an already-rotated token revokes the whole session chain', async () => {
      const initial = await signupAndLogin();

      const rotated = await request(server)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: initial.refreshToken })
        .expect(200);

      // Reuse of the stale token (theft signal) — 401, and per plan.md's
      // documented tradeoff, this revokes every session, including the one
      // that legitimately rotated it.
      await request(server)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: initial.refreshToken })
        .expect(401);

      await request(server)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: rotated.body.refreshToken })
        .expect(401);
    });

    it('401s on a malformed/unknown refresh token', async () => {
      await request(server)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'not-a-real-token' })
        .expect(401);
    });
  });

  describe('POST /auth/logout', () => {
    it('revokes the presented refresh token', async () => {
      const body = signupBody();
      const signup = await request(server)
        .post('/api/v1/auth/signup')
        .send(body)
        .expect(201);
      userIds.push(signup.body.user.id as string);

      await request(server)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${signup.body.accessToken}`)
        .send({ refreshToken: signup.body.refreshToken })
        .expect(204);

      await request(server)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: signup.body.refreshToken })
        .expect(401);
    });

    it('401s without an access token', async () => {
      await request(server)
        .post('/api/v1/auth/logout')
        .send({ refreshToken: 'irrelevant' })
        .expect(401);
    });
  });

  describe('protected routes via the global JwtAuthGuard', () => {
    it('401s a protected route with no token', async () => {
      await request(server).get('/api/v1/watch-log/me').expect(401);
    });

    it('401s a protected route with a garbage token', async () => {
      await request(server)
        .get('/api/v1/watch-log/me')
        .set('Authorization', 'Bearer not-a-real-jwt')
        .expect(401);
    });

    it('200s a protected route with a valid access token', async () => {
      const body = signupBody();
      const signup = await request(server)
        .post('/api/v1/auth/signup')
        .send(body)
        .expect(201);
      userIds.push(signup.body.user.id as string);

      await request(server)
        .get('/api/v1/watch-log/me')
        .set('Authorization', `Bearer ${signup.body.accessToken}`)
        .expect(200);
    });
  });
});
