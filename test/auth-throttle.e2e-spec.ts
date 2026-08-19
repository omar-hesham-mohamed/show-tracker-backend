import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { cleanupUsers, createTestApp, uniqueSuffix } from './utils/test-app';
import { AUTH_THROTTLE_LIMIT } from '../src/auth/auth.constants';

/**
 * Isolated from auth.e2e-spec.ts's correctness suite (which disables
 * throttling to avoid tripping this exact limit) — this is the one place
 * that actually exercises the @Throttle wiring on /auth/signup end-to-end.
 */
describe('Auth throttling (e2e)', () => {
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

  it(`429s the request past the ${AUTH_THROTTLE_LIMIT}-per-window limit on /auth/signup`, async () => {
    const suffix = uniqueSuffix();

    for (let i = 0; i < AUTH_THROTTLE_LIMIT; i++) {
      const res = await request(server)
        .post('/api/v1/auth/signup')
        .send({
          email: `e2e-throttle-${suffix}-${i}@example.com`,
          username: `e2ethrottle${suffix}${i}`,
          password: 'testpass123',
          displayName: 'E2E Throttle Tester',
          timezone: 'UTC',
        })
        .expect(201);
      userIds.push(res.body.user.id as string);
    }

    await request(server)
      .post('/api/v1/auth/signup')
      .send({
        email: `e2e-throttle-${suffix}-over@example.com`,
        username: `e2ethrottle${suffix}over`,
        password: 'testpass123',
        displayName: 'E2E Throttle Tester',
        timezone: 'UTC',
      })
      .expect(429);
  });
});
