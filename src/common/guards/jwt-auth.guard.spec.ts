import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';

function makeContext(): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({}),
      getResponse: () => ({}),
    }),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  let reflector: Reflector;
  let guard: JwtAuthGuard;
  // The passport-driven canActivate lives one level up the prototype chain
  // (the class returned by AuthGuard('jwt')) — spy on it there so we can
  // isolate our own override's logic from real passport/strategy execution.
  let passportCanActivate: jest.SpyInstance;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new JwtAuthGuard(reflector);
    passportCanActivate = jest.spyOn(
      Object.getPrototypeOf(Object.getPrototypeOf(guard)) as {
        canActivate: (ctx: ExecutionContext) => unknown;
      },
      'canActivate',
    );
  });

  afterEach(() => {
    passportCanActivate.mockRestore();
  });

  describe('canActivate', () => {
    it('allows @Public() routes through without ever invoking passport', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);

      const result = guard.canActivate(makeContext());

      expect(result).toBe(true);
      expect(passportCanActivate).not.toHaveBeenCalled();
    });

    it('delegates non-public routes to passport (super.canActivate)', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      passportCanActivate.mockReturnValue(true);

      const result = guard.canActivate(makeContext());

      expect(passportCanActivate).toHaveBeenCalledTimes(1);
      expect(result).toBe(true);
    });
  });

  describe('handleRequest', () => {
    it('on an optional-auth route with no token, returns null instead of throwing', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true); // isOptional() -> true

      const result = guard.handleRequest(null, false, null, makeContext());

      expect(result).toBeNull();
    });

    it('on an optional-auth route with a valid token, returns the user', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
      const user = { id: 'u1', username: 'mazen', email: 'a@b.com' };

      const result = guard.handleRequest(
        null,
        user as any,
        null,
        makeContext(),
      );

      expect(result).toBe(user);
    });

    it('on a required-auth route with no user, throws UnauthorizedException', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      expect(() =>
        guard.handleRequest(null, false, null, makeContext()),
      ).toThrow(UnauthorizedException);
    });

    it('[FIXED — bug found via testing, see plan.md] rethrows a raw non-HttpException error unchanged, instead of wrapping it into a leaky UnauthorizedException', () => {
      // err here only ever originates from JwtStrategy.validate() itself
      // throwing (e.g. an unexpected DB error) — a malformed/expired JWT is
      // reported via `info`, not `err` (see the guard's own comment). The
      // old behavior re-wrapped ANY truthy err as `UnauthorizedException
      // (err.message)`, mislabeling an infra failure as a 401 and leaking
      // its internal message to the client. Rethrowing unchanged lets it
      // fall through to the global filter's generic, non-leaking 500.
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      const rawError = new Error('connection terminated unexpectedly');

      let caught: unknown;
      try {
        guard.handleRequest(rawError, false, null, makeContext());
      } catch (e) {
        caught = e;
      }

      expect(caught).toBe(rawError); // rethrown unchanged, not wrapped
      expect(caught).not.toBeInstanceOf(UnauthorizedException);
    });

    it('[FIXED — bug found via testing, see plan.md] wraps a non-Error rejection reason in an Error rather than fabricating an UnauthorizedException', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      let caught: unknown;
      try {
        guard.handleRequest(
          'some non-Error rejection',
          false,
          null,
          makeContext(),
        );
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(Error);
      expect(caught).not.toBeInstanceOf(UnauthorizedException);
      expect((caught as Error).message).toBe('some non-Error rejection');
    });

    it("rethrows JwtStrategy.validate()'s own deliberate UnauthorizedException (unknown/deleted user) unchanged, staying a clean 401 with no leaked detail", () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      const deliberateAuthFailure = new UnauthorizedException();

      let caught: unknown;
      try {
        guard.handleRequest(deliberateAuthFailure, false, null, makeContext());
      } catch (e) {
        caught = e;
      }

      expect(caught).toBe(deliberateAuthFailure);
      expect((caught as UnauthorizedException).getStatus()).toBe(401);
      expect((caught as UnauthorizedException).message).toBe('Unauthorized');
    });

    it('rejects even when a truthy err is paired with a truthy user (err always wins)', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      const rawError = new Error('token expired');
      const user = { id: 'u1' };

      expect(() =>
        guard.handleRequest(rawError, user as any, null, makeContext()),
      ).toThrow('token expired');
    });

    it('on a required-auth route, an optional-auth-shaped falsy user is still rejected, not silently passed through as null', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false); // isOptional() -> false

      expect(() =>
        guard.handleRequest(undefined, false, undefined, makeContext()),
      ).toThrow(UnauthorizedException);
    });
  });
});
