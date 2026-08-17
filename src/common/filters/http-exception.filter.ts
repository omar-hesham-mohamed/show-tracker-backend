import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';

/**
 * Normalizes every thrown error into the standard shape from endpoints.md:
 * { statusCode, error, message, path } (plus a `details` array for
 * validation errors, passed through from ValidationPipe's exceptionFactory).
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttpException = exception instanceof HttpException;
    const statusCode = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
    const rawResponse = isHttpException ? exception.getResponse() : null;

    const base: Record<string, unknown> =
      typeof rawResponse === 'object' && rawResponse !== null
        ? { ...(rawResponse as Record<string, unknown>) }
        : {};

    response.status(statusCode).json({
      ...base,
      statusCode,
      error: base.error ?? 'Internal Server Error',
      message: base.message ?? 'Internal server error',
      path: request.originalUrl,
    });
  }
}
