import { SetMetadata } from '@nestjs/common';

export const IS_OPTIONAL_AUTH_KEY = 'isOptionalAuth';

/**
 * Marks a route as accepting an optional bearer token: a valid token populates
 * `req.user`, a missing or invalid one leaves it `null` instead of rejecting
 * the request (e.g. public-profile lookups that behave differently when the
 * caller is authenticated).
 */
export const OptionalAuth = () => SetMetadata(IS_OPTIONAL_AUTH_KEY, true);
