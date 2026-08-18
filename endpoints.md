# Social Show Tracker — API Endpoints

Companion to `plan.md`. This is the source list for the Swagger/OpenAPI contract (`@nestjs/swagger` decorators should mirror this document 1:1). Grouped by NestJS module. Update this file first when an endpoint's shape changes, then regenerate/adjust the decorators.

## Conventions

- **Base path**: `/api/v1`.
- **Auth**: `Authorization: Bearer <accessToken>` unless marked **Public**. Endpoints marked **Optional auth** behave differently for authenticated vs anonymous callers (e.g. private-profile gating).
- **Pagination**: cursor-based on list endpoints that can grow unbounded (feed, diary, followers/following). Query params `cursor` (opaque string, omit for first page) and `limit` (default 20, max 50). Response includes `nextCursor: string | null`.
- **Errors**: standard shape across all endpoints —
  ```json
  { "statusCode": 404, "error": "Not Found", "message": "Show not found", "path": "/api/v1/shows/123" }
  ```
  Validation errors (400) include a `details` array of per-field messages.
- **IDs**: internal entities use UUID strings (`id`). TMDB's own numeric ID is always named `tmdbId` to disambiguate.
- **Dates**: ISO-8601 strings (`YYYY-MM-DD` for date-only fields like `watchedAt`/`releaseDate`, full timestamp for `createdAt`/`updatedAt`).
- **Rating**: number, 0.5–5.0 in 0.5 increments (half-star scale, confirmed in `plan.md`).

---

## Health

### `GET /health` — Public
Liveness/readiness check for deploy platform + local Docker compose verification (plan.md milestone 1).

**Response `200`**
```json
{ "status": "ok", "db": "ok", "uptimeSeconds": 1234 }
```
**Response `503`** (DB ping failed) — same shape, `db: "error"`.

---

## Auth (`/auth`)

### `POST /auth/signup` — Public
**Request**
```json
{ "email": "a@b.com", "username": "mazen", "password": "min-8-chars", "displayName": "Mazen", "timezone": "Africa/Cairo" }
```
**Response `201`**
```json
{ "accessToken": "...", "refreshToken": "...", "user": { "id": "uuid", "username": "mazen", "email": "a@b.com", "displayName": "Mazen", "avatarUrl": null, "timezone": "Africa/Cairo" } }
```
**Errors**: `409` username or email already taken.

### `POST /auth/login` — Public
**Request**
```json
{ "emailOrUsername": "mazen", "password": "..." }
```
**Response `200`**: same shape as signup response.
**Errors**: `401` invalid credentials.

### `POST /auth/refresh` — Public (requires valid refresh token in body)
**Request**
```json
{ "refreshToken": "..." }
```
**Response `200`**
```json
{ "accessToken": "...", "refreshToken": "..." }
```
Refresh tokens are rotated (old one invalidated on use). **Errors**: `401` expired/revoked/invalid token.

### `POST /auth/logout` — Auth required
Invalidates the presented refresh token (body) server-side.
**Request**
```json
{ "refreshToken": "..." }
```
**Response `204`**

---

## Users (`/users`)

### `GET /users/me` — Auth required
Full profile for the logged-in user, including private fields (email, timezone, streak).
**Response `200`**
```json
{
  "id": "uuid", "username": "mazen", "email": "a@b.com", "displayName": "Mazen",
  "avatarUrl": null, "bio": "", "timezone": "Africa/Cairo", "isPrivate": false,
  "currentStreakCount": 5, "longestStreakCount": 12, "lastStreakDate": "2026-08-06",
  "followerCount": 10, "followingCount": 8, "createdAt": "..."
}
```

### `PATCH /users/me` — Auth required
Partial update. All fields optional.
**Request**
```json
{ "displayName": "Mazen A.", "bio": "watching too much TV", "timezone": "Africa/Cairo", "isPrivate": true }
```
**Response `200`**: updated `User` object (same shape as `GET /users/me`).
**Errors**: `400` invalid timezone string.

### `POST /users/me/avatar` — Auth required
Multipart upload (`avatar` field, image). Backend stores and returns a URL (S3/Cloudinary/etc — storage TBD in polish milestone).
**Response `200`**
```json
{ "avatarUrl": "https://..." }
```
**Errors**: `400` invalid file type/size.

### `DELETE /users/me` — Auth required
Account deletion. Cascades or anonymizes per plan.md's polish-milestone design (soft-delete recommended: anonymize PII, keep `WatchLogEntry` rows for other users' feed history integrity, drop `Follow` edges).
**Response `204`**

### `GET /users/:username` — Optional auth
Public profile lookup by username. If the target is private and the caller doesn't follow them (or isn't authenticated), only a minimal stub is returned.
**Response `200` (public/followed)**
```json
{
  "id": "uuid", "username": "sam", "displayName": "Sam", "avatarUrl": null, "bio": "",
  "isPrivate": false, "currentStreakCount": 3, "longestStreakCount": 20,
  "followerCount": 40, "followingCount": 12,
  "isFollowedByMe": true, "followsMe": false
}
```
**Response `200` (private, not followed)**
```json
{ "id": "uuid", "username": "sam", "displayName": "Sam", "avatarUrl": null, "isPrivate": true, "isFollowedByMe": false }
```
**Errors**: `404` no such username.

---

## Follow (`/users/:username/follow`, `/users/:username/followers`, `/users/:username/following`)

One-way follow model (confirmed). Following a private account still creates the edge immediately — no request/accept state machine in MVP.

### `POST /users/:username/follow` — Auth required
**Response `204`**. Idempotent — following an already-followed user is a no-op `204`, not an error.
**Errors**: `404` user not found, `400` attempting to follow self.

### `DELETE /users/:username/follow` — Auth required
Unfollow. **Response `204`**, idempotent.

### `GET /users/:username/followers` — Optional auth, paginated
List of users who follow `:username`.
**Query**: `cursor`, `limit`.
**Response `200`**
```json
{
  "items": [ { "id": "uuid", "username": "sam", "displayName": "Sam", "avatarUrl": null, "isFollowedByMe": false } ],
  "nextCursor": "opaque-cursor-or-null"
}
```

### `GET /users/:username/following` — Optional auth, paginated
Same shape as `/followers`, listing who `:username` follows.

---

## TMDB Proxy / Shows (`/shows`)

Never call TMDB directly from mobile — everything routes through here, cache-aside against local `Show`/`Episode` tables (plan.md §Core Data Model).

### `GET /shows/search` — Auth required
**Query**: `query` (string, required), `type` (`movie` | `tv` | `all`, default `all`), `page` (default 1).
**Response `200`**
```json
{
  "results": [
    { "tmdbId": 1399, "mediaType": "tv", "title": "Game of Thrones", "posterPath": "/...", "releaseDate": "2011-04-17", "tmdbRating": 8.4 }
  ],
  "page": 1, "totalPages": 12
}
```

### `GET /shows/:mediaType/:tmdbId` — Auth required
Show/movie detail. Fetched fresh from TMDB on cache miss or TTL expiry, upserted into local `Show` table, then served from cache.
**Path params**: `mediaType` (`movie` | `tv`), `tmdbId` (TMDB's numeric ID, not internal `id`). `mediaType` is required because TMDB movie IDs and TV IDs are independent sequences — the same numeric ID can refer to an unrelated movie and TV show, so `tmdbId` alone is ambiguous (`Show` is uniqued on `(tmdbId, mediaType)`, not `tmdbId` alone).
**Response `200`**
```json
{
  "id": "uuid", "tmdbId": 1399, "mediaType": "tv", "title": "Game of Thrones",
  "overview": "...", "posterPath": "/...", "backdropPath": "/...",
  "releaseDate": "2011-04-17", "tmdbRating": 8.4, "genres": ["Drama", "Fantasy"],
  "status": "Ended", "seasonCount": 8
}
```
**Errors**: `404` unknown TMDB ID for that `mediaType`.

### `GET /shows/:mediaType/:tmdbId/watch-providers` — Auth required
**Query**: `region` (ISO 3166-1 alpha-2) — **accepted but currently a no-op**: region-keyed caching is deferred post-MVP (plan.md), so every call is served/cached for `US` only regardless of what's passed.
Same 7-day TTL as show metadata today, tracked independently (`Show.watchProvidersSyncedAt`) so it can be shortened later without touching the metadata cache.
**Response `200`**
```json
{ "region": "US", "link": "https://www.themoviedb.org/...", "flatrate": [ { "providerName": "Netflix", "logoPath": "/..." } ], "rent": [], "buy": [] }
```
Response must be rendered with required TMDB/JustWatch attribution in the mobile UI (plan.md gotcha — not an API concern but noted here since the client depends on this payload).

### `GET /shows/:mediaType/:tmdbId/recommendations` — Auth required
Live TMDB proxy for the show-detail "more like this" carousel — **never cached** (same rationale as `GET /shows/search`: a list of stubs has near-zero cache-hit value). No pagination — always TMDB's first page (~20 items); a shelf, not an infinite list.
**Response `200`**
```json
{
  "results": [
    { "tmdbId": 94997, "mediaType": "tv", "title": "House of the Dragon", "posterPath": "/...", "releaseDate": "2022-08-21", "tmdbRating": 8.4 }
  ]
}
```
An empty `results` array is expected for obscure/new titles with a thin recommendation signal — the client should hide the carousel rather than the API falling back to a second TMDB call. Recommended shows are **not** upserted into the local `Show` table just for appearing in this list — a show only gets cached once the user actually opens it via `GET /shows/:mediaType/:tmdbId`.
**Errors**: `404` unknown TMDB ID for that `mediaType`.

### `GET /shows/tv/:tmdbId/seasons/:seasonNumber` — Auth required
TV-only (fixed `tv` path segment, not a `:mediaType` param — a movie has no seasons, so this route simply doesn't exist for one). Season detail with its episode list; upserts `Episode` rows. Requires the parent `Show` to already be cached (no implicit show-fetch side effect).
**Response `200`**
```json
{
  "seasonNumber": 1, "name": "Season 1", "airDate": "2011-04-17",
  "episodes": [
    { "id": "uuid", "episodeNumber": 1, "name": "Winter Is Coming", "airDate": "2011-04-17", "overview": "...", "stillPath": "/..." }
  ]
}
```
**Errors**: `404` show not found, `404` season doesn't exist.

---

## Watch Log (`/watch-log`)

### `POST /watch-log` — Auth required
Create a log entry. Triggers streak recompute when `status: WATCHED` (plan.md §Streak). No uniqueness constraint on `(userId, showId)` — rewatches allowed.
**Request**
```json
{
  "tmdbId": 1399, "mediaType": "tv", "episodeId": "uuid-or-null",
  "status": "WATCHED", "rating": 4.5, "watchedAt": "2026-08-07", "note": "great finale"
}
```
`watchedAt` is the client's local date (`YYYY-MM-DD`) — used for streak-day comparison. Server loosely validates it isn't an obviously-spoofed future date (honor-system by design, per plan.md).
**Response `201`**
```json
{
  "id": "uuid", "userId": "uuid", "show": { "id": "uuid", "tmdbId": 1399, "title": "Game of Thrones", "posterPath": "/..." },
  "episodeId": null, "status": "WATCHED", "rating": 4.5, "watchedAt": "2026-08-07", "note": "great finale",
  "createdAt": "...", "updatedAt": "...",
  "streakAfterWrite": { "currentStreakCount": 6, "longestStreakCount": 12 }
}
```
**Errors**: `400` invalid status/rating grid, `404` unknown `tmdbId`/`episodeId`.

### `GET /watch-log/me` — Auth required, paginated
List the caller's own log entries (backs the "My List" segments and diary view).
**Query**: `status` (`WATCHED` | `WATCHING` | `WANT_TO_WATCH`, optional filter), `cursor`, `limit`, `sort` (`watchedAt_desc` default | `watchedAt_asc`).
**Response `200`**
```json
{
  "items": [
    { "id": "uuid", "show": { "id": "uuid", "tmdbId": 1399, "title": "Game of Thrones", "posterPath": "/..." }, "episodeId": null, "status": "WATCHED", "rating": 4.5, "watchedAt": "2026-08-07", "note": "" }
  ],
  "nextCursor": "opaque-or-null"
}
```

### `GET /watch-log/:id` — Auth required (owner only)
Single entry detail. **Response `200`**: same item shape as list. **Errors**: `404` not found or not owned by caller.

### `PATCH /watch-log/:id` — Auth required (owner only)
Update rating/note/status/watchedAt. Changing `status` to/from `WATCHED` or changing `watchedAt` re-triggers streak recompute.
**Request**: any subset of `{ status, rating, watchedAt, note }`.
**Response `200`**: updated entry, same shape as create response (including `streakAfterWrite` if the write affected streak-relevant fields).
**Errors**: `404` not found/not owned.

### `DELETE /watch-log/:id` — Auth required (owner only)
Deleting a `WATCHED` entry that was the sole entry for its day triggers a streak reconciliation (recompute from remaining `watchedAt` rows — plan.md notes `watchedAt` as the durable source of truth for exactly this case).
**Response `204`**

### `GET /watch-log/user/:username` — Optional auth, paginated
Another user's public watch history (their diary), subject to the same private-profile gating as `GET /users/:username`.
**Query**: same as `/watch-log/me`.
**Response `200`**: same shape as `/watch-log/me`.
**Errors**: `403` target profile is private and caller doesn't follow them.

---

## Streak (`/users/:username/streak`)

Streak counters are denormalized on `User` and surfaced there too (`GET /users/me`, `GET /users/:username`); this dedicated endpoint exists for the streak-detail screen (e.g. showing a calendar/history view) without over-fetching the full profile.

### `GET /users/:username/streak` — Optional auth (subject to privacy gating)
**Response `200`**
```json
{ "currentStreakCount": 6, "longestStreakCount": 12, "lastStreakDate": "2026-08-07" }
```

---

## Feed (`/feed`)

### `GET /feed` — Auth required, paginated
Query-time join across the caller's followees' `WatchLogEntry` rows (plan.md §Feed — not fan-out-on-write for MVP).
**Query**: `cursor`, `limit`.
**Response `200`**
```json
{
  "items": [
    {
      "id": "uuid",
      "user": { "id": "uuid", "username": "sam", "displayName": "Sam", "avatarUrl": null },
      "show": { "id": "uuid", "tmdbId": 1399, "title": "Game of Thrones", "posterPath": "/..." },
      "episodeId": null, "status": "WATCHED", "rating": 4.5, "watchedAt": "2026-08-07", "note": "great finale",
      "createdAt": "..."
    }
  ],
  "nextCursor": "opaque-or-null"
}
```
Only entries from followees are included; the caller's own entries are not echoed back into their own feed.

---

## Moderation (`/users/:username/block`, `/users/me/blocked`)

Baseline moderation, per plan.md's cross-cutting gotchas.

### `POST /users/:username/block` — Auth required
Blocking implicitly removes any existing follow edge in both directions and prevents future follows/feed visibility between the two users.
**Response `204`**

### `DELETE /users/:username/block` — Auth required
Unblock. **Response `204`**

### `GET /users/me/blocked` — Auth required, paginated
**Response `200`**: same item shape as `/followers`.

---

## Notifications (`/notifications`) — Polish milestone

### `POST /notifications/device-tokens` — Auth required
Registers an Expo push token for the calling user's device.
**Request**
```json
{ "expoPushToken": "ExponentPushToken[...]", "platform": "ios" }
```
**Response `204`**

### `DELETE /notifications/device-tokens` — Auth required
**Request**
```json
{ "expoPushToken": "ExponentPushToken[...]" }
```
**Response `204`** (e.g. on logout, to stop sending pushes to that device).

### `GET /notifications/preferences` / `PATCH /notifications/preferences` — Auth required
Streak-reminder and new-follower/activity toggles.
**Response / Request `200`**
```json
{ "streakReminders": true, "newFollowerAlerts": true, "activityAlerts": false }
```

---

## Not Yet Assigned an Endpoint (deliberately deferred, per plan.md)

Likes/comments on watch entries, region-keyed watch-provider write path (beyond read-through cache above), OAuth login endpoints, private-profile follow *requests* (as opposed to the immediate one-way follow above), rate-limiting responses (`429` shape, applies globally to all write endpoints once implemented — not a distinct endpoint).
