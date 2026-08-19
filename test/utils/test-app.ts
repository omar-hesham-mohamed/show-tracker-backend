import {
  BadRequestException,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';

export interface CreateTestAppOptions {
  /**
   * Bypasses ThrottlerGuard (5 req/60s on /auth/signup and /auth/login).
   * Correctness suites that need more than 5 signups/logins per run would
   * otherwise start getting spurious 429s instead of the status codes
   * they're actually testing for. The throttle's own behavior gets its own
   * dedicated, non-bypassed test (see test/auth-throttle.e2e-spec.ts).
   */
  disableThrottling?: boolean;
}

/**
 * Mirrors main.ts's bootstrap exactly (global prefix + ValidationPipe) minus
 * the process-level concerns (listen, trust proxy, CORS, shutdown hooks) that
 * don't apply to an in-process supertest app. Without this, e2e tests would
 * silently skip whitelist/transform/exceptionFactory validation behavior —
 * the original app.e2e-spec.ts's health-only bootstrap didn't need it, but
 * anything posting a body does.
 */
export async function createTestApp(
  options: CreateTestAppOptions = {},
): Promise<INestApplication<App>> {
  const builder = Test.createTestingModule({
    imports: [AppModule],
  });

  if (options.disableThrottling) {
    builder.overrideGuard(ThrottlerGuard).useValue({ canActivate: () => true });
  }

  const moduleFixture = await builder.compile();

  const app = moduleFixture.createNestApplication<INestApplication<App>>();
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) =>
        new BadRequestException({
          message: 'Validation failed',
          details: errors.flatMap((error) =>
            Object.values(error.constraints ?? {}),
          ),
        }),
    }),
  );
  await app.init();
  return app;
}

export function getPrisma(app: INestApplication<App>): PrismaService {
  return app.get(PrismaService);
}

/** Random suffix so repeat e2e runs against the shared dev DB never collide on unique username/email. */
export function uniqueSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Deletes users by id — cascades to their WatchLogEntry/RefreshToken rows (schema.prisma onDelete: Cascade). */
export async function cleanupUsers(
  app: INestApplication<App>,
  userIds: string[],
): Promise<void> {
  if (userIds.length === 0) return;
  await getPrisma(app).user.deleteMany({ where: { id: { in: userIds } } });
}
