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

    it('wraps a raw passport/JWT error (e.g. JsonWebTokenError) into a clean UnauthorizedException instead of leaking it through', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      const rawError = new Error('jwt malformed');

      let caught: unknown;
      try {
        guard.handleRequest(rawError, false, null, makeContext());
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(UnauthorizedException);
      expect(caught).not.toBe(rawError); // must not be the raw error itself
      expect((caught as UnauthorizedException).message).toBe('jwt malformed');
    });

    it('throws UnauthorizedException with an undefined message when the rejection reason is not an Error instance', () => {
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

      expect(caught).toBeInstanceOf(UnauthorizedException);
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
