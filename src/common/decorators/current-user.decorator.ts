import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';

/** Pulls the user attached by JwtStrategy off the request (null on optional-auth routes with no token). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser | null => {
    const request = ctx
      .switchToHttp()
      .getRequest<{ user: AuthenticatedUser | null }>();
    return request.user ?? null;
  },
);
