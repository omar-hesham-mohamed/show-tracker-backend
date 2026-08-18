import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Behind Railway/Render's reverse proxy, Express's req.ip resolves to the
  // proxy's own IP unless this is set — which would make ThrottlerGuard's
  // per-client rate limit (auth.module.ts) collapse into one shared bucket
  // for every user instead of limiting each client individually.
  app.set('trust proxy', 1);
  // Without this, PrismaService's onModuleDestroy ($disconnect) never fires
  // on a container SIGTERM (e.g. every Railway/Render redeploy) — only on an
  // explicit programmatic app.close() — so connections wouldn't close cleanly
  // on rollover.
  app.enableShutdownHooks();
  app.setGlobalPrefix('api/v1', {
    exclude: ['health'],
  });
  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({ origin: allowedOrigins });
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
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
