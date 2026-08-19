import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { STATUS_CODES } from 'http';
import type { Request, Response } from 'express';

/**
 * Normalizes every thrown error into the standard shape from endpoints.md:
 * { statusCode, error, message, path } (plus a `details` array for
 * validation errors, passed through from ValidationPipe's exceptionFactory).
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttpException = exception instanceof HttpException;
    const statusCode = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
    const rawResponse = isHttpException ? exception.getResponse() : null;

    if (!isHttpException) {
      // Every unhandled (non-HttpException) exception becomes a generic 500
      // to the client by design (see below) — but until now it also
      // produced zero server-side log output, making it invisible to
      // on-call/monitoring (bug found via testing — see plan.md; this is
      // exactly how the stale-Prisma-client bug earlier this project stayed
      // hidden). Logged here, not re-thrown — this filter is the last stop.
      this.logger.error(
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const base: Record<string, unknown> =
      typeof rawResponse === 'object' && rawResponse !== null
        ? { ...(rawResponse as Record<string, unknown>) }
        : {};

    response.status(statusCode).json({
      ...base,
      statusCode,
      error: base.error ?? STATUS_CODES[statusCode] ?? 'Internal Server Error',
      message: base.message ?? 'Internal server error',
      path: request.originalUrl,
    });
  }
}
