import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { IS_OPTIONAL_AUTH_KEY } from '../decorators/optional-auth.decorator';

/**
 * Secure-by-default global guard. Routes are locked down unless marked
 * `@Public()` (no auth at all) or `@OptionalAuth()` (auth attempted, but a
 * missing/invalid token falls back to an anonymous request instead of a 401).
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    return super.canActivate(context);
  }

  private isOptional(context: ExecutionContext): boolean {
    return !!this.reflector.getAllAndOverride<boolean>(IS_OPTIONAL_AUTH_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
  }

  handleRequest<TUser = unknown>(
    err: unknown,
    user: TUser | false,
    _info: unknown,
    context: ExecutionContext,
  ): TUser | null {
    if (this.isOptional(context)) {
      return user ? user : null;
    }

    if (err) {
      // `err` here only ever originates from JwtStrategy.validate() itself
      // throwing — passport-jwt reports a malformed/expired JWT via `info`,
      // not `err` (verification failures call self.fail(), only the verify
      // callback's own thrown errors call self.error() — see passport-jwt's
      // strategy.js). So this is either our own deliberate
      // UnauthorizedException (unknown/deleted user — already a safe,
      // well-formed HttpException) or an unexpected error such as a DB
      // failure inside validate(). Previously this was unconditionally
      // re-wrapped as `UnauthorizedException(err.message)`, which mislabeled
      // infra failures as 401s and leaked their internal message straight to
      // the client (bug found via testing — see plan.md). Rethrowing
      // unchanged lets an HttpException pass through exactly as intended,
      // and lets anything else fall to the global filter's generic,
      // non-leaking 500 instead. Always throws a genuine Error (wrapping a
      // non-Error rejection reason, which shouldn't occur in practice but
      // isn't guaranteed by the type) rather than an arbitrary thrown value.
      throw err instanceof Error
        ? err
        : new Error(
            typeof err === 'string'
              ? err
              : 'Non-Error value thrown by JwtStrategy.validate()',
          );
    }

    if (!user) {
      throw new UnauthorizedException();
    }

    return user;
  }
}
