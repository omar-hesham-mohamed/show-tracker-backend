import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { cleanupUsers, createTestApp, uniqueSuffix } from './utils/test-app';

describe('Follow (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let tokenA: string;
  let tokenB: string;
  let tokenC: string; // private
  let usernameA: string;
  let usernameB: string;
  let usernameC: string;
  const userIds: string[] = [];

  beforeAll(async () => {
    app = await createTestApp({ disableThrottling: true });
    server = app.getHttpServer();

    const suffix = uniqueSuffix();
    async function signup(label: string) {
      const username = `e2efollow${label}${suffix}`;
      const res = await request(server)
        .post('/api/v1/auth/signup')
        .send({
          email: `e2e-follow-${label}-${suffix}@example.com`,
          username,
          password: 'testpass123',
          displayName: `E2E Follow ${label}`,
          timezone: 'UTC',
        })
        .expect(201);
      userIds.push(res.body.user.id as string);
      return { token: res.body.accessToken as string, username };
    }

    const a = await signup('a');
    const b = await signup('b');
    const c = await signup('c');
    tokenA = a.token;
    usernameA = a.username;
    tokenB = b.token;
    usernameB = b.username;
    tokenC = c.token;
    usernameC = c.username;

    // userC is private, dogfooding PATCH /users/me.
    await request(server)
      .patch('/api/v1/users/me')
      .set({ Authorization: `Bearer ${tokenC}` })
      .send({ isPrivate: true })
      .expect(200);
  });

  afterAll(async () => {
    await cleanupUsers(app, userIds);
    await app.close();
  });

  function authA() {
    return { Authorization: `Bearer ${tokenA}` };
  }
  function authB() {
    return { Authorization: `Bearer ${tokenB}` };
  }
  function authC() {
    return { Authorization: `Bearer ${tokenC}` };
  }

  it('runs the full follow -> followers/following -> unfollow lifecycle', async () => {
    await request(server)
      .post(`/api/v1/users/${usernameB}/follow`)
      .set(authA())
      .expect(204);

    // Idempotent — following again is still 204, not an error.
    await request(server)
      .post(`/api/v1/users/${usernameB}/follow`)
      .set(authA())
      .expect(204);

    const followers = await request(server)
      .get(`/api/v1/users/${usernameB}/followers`)
      .set(authA())
      .expect(200);
    // isFollowedByMe means "does the viewer (A) follow this listed user" —
    // the listed user here is A itself (A is in B's followers list), and A
    // doesn't follow A, so this is correctly false, not a reflection of the
    // A-follows-B edge the list itself represents.
    expect(followers.body.items).toEqual([
      expect.objectContaining({ username: usernameA, isFollowedByMe: false }),
    ]);

    const following = await request(server)
      .get(`/api/v1/users/${usernameA}/following`)
      .set(authB())
      .expect(200);
    expect(following.body.items).toEqual([
      expect.objectContaining({ username: usernameB }),
    ]);

    const profileB = await request(server)
      .get(`/api/v1/users/${usernameB}`)
      .set(authA())
      .expect(200);
    expect(profileB.body.isFollowedByMe).toBe(true);

    const profileA = await request(server)
      .get(`/api/v1/users/${usernameA}`)
      .set(authB())
      .expect(200);
    expect(profileA.body.followsMe).toBe(true);

    await request(server)
      .delete(`/api/v1/users/${usernameB}/follow`)
      .set(authA())
      .expect(204);

    // Idempotent unfollow.
    await request(server)
      .delete(`/api/v1/users/${usernameB}/follow`)
      .set(authA())
      .expect(204);

    const followersAfter = await request(server)
      .get(`/api/v1/users/${usernameB}/followers`)
      .set(authA())
      .expect(200);
    expect(followersAfter.body.items).toEqual([]);
  });

  it('400s attempting to follow self', async () => {
    await request(server)
      .post(`/api/v1/users/${usernameA}/follow`)
      .set(authA())
      .expect(400);
  });

  it('404s following an unknown username', async () => {
    await request(server)
      .post('/api/v1/users/no-such-user/follow')
      .set(authA())
      .expect(404);
  });

  it('gates followers/following lists on a private profile the caller does not follow (empty list, not 403)', async () => {
    const res = await request(server)
      .get(`/api/v1/users/${usernameC}/followers`)
      .set(authA())
      .expect(200);
    expect(res.body).toEqual({ items: [], nextCursor: null });
  });

  it('reveals followers/following once the caller actually follows the private account', async () => {
    await request(server)
      .post(`/api/v1/users/${usernameC}/follow`)
      .set(authA())
      .expect(204);

    const res = await request(server)
      .get(`/api/v1/users/${usernameC}/following`)
      .set(authA())
      .expect(200);
    // userC follows nobody, but the list is no longer force-emptied by the gate.
    expect(res.body.nextCursor).toBeNull();

    const followers = await request(server)
      .get(`/api/v1/users/${usernameC}/followers`)
      .set(authA())
      .expect(200);
    expect(followers.body.items).toEqual([
      expect.objectContaining({ username: usernameA }),
    ]);

    await request(server)
      .delete(`/api/v1/users/${usernameC}/follow`)
      .set(authA())
      .expect(204);
  });

  it('allows the private account itself to always see its own followers list (self-view)', async () => {
    const res = await request(server)
      .get(`/api/v1/users/${usernameC}/followers`)
      .set(authC())
      .expect(200);
    expect(res.body).toEqual({ items: [], nextCursor: null }); // empty for a real reason (no followers), not the gate
  });
});
