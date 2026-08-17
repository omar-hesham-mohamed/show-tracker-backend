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

    if (err || !user) {
      throw err instanceof Error ? err : new UnauthorizedException();
    }

    return user;
  }
}
