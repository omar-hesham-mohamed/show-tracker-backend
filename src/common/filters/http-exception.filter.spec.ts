import {
  ArgumentsHost,
  BadRequestException,
  HttpException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { HttpExceptionFilter } from './http-exception.filter';

function makeHost(path = '/api/v1/shows/123') {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const response = { status } as unknown as Response;
  const request = { originalUrl: path } as Request;

  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;

  return { host, status, json };
}

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
    // The filter now logs every unhandled exception (see the "logging"
    // describe block below) — silenced by default here so the many other
    // tests deliberately triggering 500s don't spam real log output.
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('normalizes a built-in NotFoundException into the documented { statusCode, error, message, path } shape', () => {
    const { host, status, json } = makeHost('/api/v1/shows/movie/999');
    filter.catch(new NotFoundException('Show not found'), host);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      statusCode: 404,
      error: 'Not Found',
      message: 'Show not found',
      path: '/api/v1/shows/movie/999',
    });
  });

  it('normalizes a bare, non-HttpException Error to a 500 with a generic message — never leaking the real error text', () => {
    const { host, status, json } = makeHost();
    filter.catch(
      new Error('leaked internal detail: password column XYZ'),
      host,
    );

    expect(status).toHaveBeenCalledWith(500);
    const body = json.mock.calls[0][0];
    expect(body.statusCode).toBe(500);
    expect(body.message).toBe('Internal server error');
    expect(JSON.stringify(body)).not.toContain('leaked internal detail');
  });

  it('normalizes a thrown non-Error, non-HttpException value (e.g. a rejected string/plain object) without crashing', () => {
    const { host, status, json } = makeHost();
    filter.catch('a plain string was thrown', host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json.mock.calls[0][0].message).toBe('Internal server error');
  });

  it('passes through extra fields (e.g. the ValidationPipe "details" array) untouched', () => {
    const { host, status, json } = makeHost();
    filter.catch(
      new BadRequestException({
        message: 'Validation failed',
        details: [
          'username must be 3-20 characters',
          'password must be at least 8 characters',
        ],
      }),
      host,
    );

    expect(status).toHaveBeenCalledWith(400);
    const body = json.mock.calls[0][0];
    expect(body.message).toBe('Validation failed');
    expect(body.details).toEqual([
      'username must be 3-20 characters',
      'password must be at least 8 characters',
    ]);
  });

  it('falls back to the Node http.STATUS_CODES table for `error` when the exception body did not set one', () => {
    const { host, json } = makeHost();
    filter.catch(new UnauthorizedException(), host);

    expect(json.mock.calls[0][0].error).toBe('Unauthorized');
  });

  it('[FOUND VIA TESTING — not currently reachable from this codebase] a raw HttpException constructed with a plain string body loses that message entirely, falling back to the generic 500 text', () => {
    // Every throw site in this codebase uses the built-in subclasses
    // (NotFoundException, BadRequestException, etc.), which all auto-wrap a
    // string constructor arg into an object body — so this branch is never
    // hit today. It's tested here because `HttpException` itself (the base
    // class) does NOT do that wrapping: passed a bare string, getResponse()
    // returns the string verbatim, and the filter's `typeof rawResponse ===
    // 'object'` check treats that as "no body", discarding the message.
    const { host, status, json } = makeHost();
    filter.catch(new HttpException('a custom message', 400), host);

    expect(status).toHaveBeenCalledWith(400);
    // Documents the gap: this is 'Internal server error', NOT 'a custom message'.
    expect(json.mock.calls[0][0].message).toBe('Internal server error');
  });

  it('always includes the request path from the original URL', () => {
    const { host, json } = makeHost('/api/v1/auth/login');
    filter.catch(new NotFoundException(), host);

    expect(json.mock.calls[0][0].path).toBe('/api/v1/auth/login');
  });

  describe('logging (bug found via testing — see plan.md)', () => {
    // Previously an unhandled (non-HttpException) exception produced zero
    // server-side log output — the client got a generic 500, but nothing
    // was written anywhere, making the failure invisible to on-call.
    it('logs the underlying error for an unhandled (non-HttpException) exception', () => {
      const { host } = makeHost();
      filter.catch(new Error('connection terminated unexpectedly'), host);

      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0][0]).toContain(
        'connection terminated unexpectedly',
      );
    });

    it('logs a thrown non-Error value too, without crashing', () => {
      const { host } = makeHost();
      filter.catch('a plain string was thrown', host);

      expect(errorSpy).toHaveBeenCalledWith('a plain string was thrown');
    });

    it('does not log anything for a normal, expected HttpException', () => {
      const { host } = makeHost();
      filter.catch(new NotFoundException('Show not found'), host);

      expect(errorSpy).not.toHaveBeenCalled();
    });
  });
});
