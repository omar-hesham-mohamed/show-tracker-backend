# Social Show Tracker — Backend

NestJS + Prisma/PostgreSQL API for a social TV/movie tracker: log what you've watched, follow friends, see a feed of their activity, and keep a self-reported daily watch streak. TMDB is proxied through this backend for show/episode metadata — the client never calls TMDB directly.

See [`plan.md`](./plan.md) for the full architecture, data model, and build-phase roadmap, and [`endpoints.md`](./endpoints.md) for the API contract.

## Prerequisites

- Node.js `>=22` (see `engines` in `package.json`)
- A running PostgreSQL instance
- A TMDB account with a **v4 Read Access Token** (not the v3 API key) — from themoviedb.org account settings → API

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

- `DATABASE_URL` — your Postgres connection string
- `JWT_ACCESS_SECRET` — 64+ random bytes, e.g. `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
- `TMDB_ACCESS_TOKEN` — your TMDB v4 Read Access Token
- `ALLOWED_ORIGINS` — comma-separated web origins allowed to call the API cross-origin (only matters for the web build; native mobile requests aren't subject to CORS)

Apply the database schema:

```bash
npx prisma migrate deploy
```

## Running

```bash
npm run start:dev    # watch mode
npm run start         # no watch
npm run start:prod    # runs the compiled dist/ build
```

The API is served under `/api/v1` (except `GET /health`, which is unprefixed for deploy-platform liveness checks).

## Testing

```bash
npm test              # unit tests
npm run test:cov      # unit tests with coverage
npm run test:e2e       # e2e tests (needs a real Postgres connection AND a valid TMDB_ACCESS_TOKEN — the TMDB e2e specs call the real TMDB API, no mocking)
```

e2e tests run against whatever Postgres `DATABASE_URL` points at (typically your local dev DB) — each spec cleans up the users/rows it creates afterward. They create real users with `e2e*`-prefixed usernames/emails, which is safe to grep for if you ever need to confirm nothing was left behind.

## Other scripts

```bash
npm run lint     # ESLint, --fix
npm run format   # Prettier
npm run build    # compiles to dist/
```
