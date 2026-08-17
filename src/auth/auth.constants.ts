/** Phase 2 (Auth) design decisions — see plan.md Decisions Log. */
export const ACCESS_TOKEN_TTL = '15m';
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const BCRYPT_SALT_ROUNDS = 12;
export const AUTH_THROTTLE_LIMIT = 5;
export const AUTH_THROTTLE_TTL_MS = 60_000;
