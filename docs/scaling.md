# Growing Grab & Go

How the platform is built to grow, what each stage needs, and what to change
when. Nothing here is needed on day one; each step has a signal that says it
is time.

## What already scales

- **The API is stateless.** Sessions live in the database (hashed refresh
  tokens), not in memory, so any number of identical API servers can run
  behind a load balancer.
- **Money and rules are pure functions** (`packages/core`), the same on every
  server and in the app, so adding servers cannot make them disagree.
- **Background jobs and POS deliveries are safe on many servers.** Every job is
  idempotent, and POS deliveries are claimed with a conditional update before
  sending, so two servers never send the same one.
- **Cities are data.** Cities, areas, cafés, opening hours (with each café's
  time zone) and all prices are rows, not constants. Business types beyond
  cafés (bakeries, juice bars) are an enum value.
- **Configuration is data.** Loyalty rates, referral rules, commission,
  pickup-slot sizes and similar live in `platform_settings`, edited from the
  admin dashboard without a release.
- **The app can be fixed without the App Store.** Expo updates ship JavaScript
  fixes to installed apps (EAS Update) once configured; native changes still
  need a store release.

## Stage 1: launch (one city, tens of cafés, up to ~10,000 customers)

| Piece | Setup |
| --- | --- |
| API | One or two small instances behind a load balancer (Render, Fly.io, Railway, AWS App Runner) |
| Database | Managed Postgres with daily backups and point-in-time recovery (Neon, Supabase, RDS) |
| Dashboards | Static hosting with a CDN (Vercel, Netlify, Cloudflare Pages) |
| App | EAS Build and Submit; EAS Update for JavaScript fixes |
| Push | Expo push (APNs and FCM behind it) |
| Monitoring | Sentry (API and app), uptime checks on `/api/v1/health` and `/ready`, database alerts |
| Staging | A second, smaller copy with its own database, deployed before production |

With one API instance, nothing else is needed. **The moment there are two**,
do the two items in the next table marked *required*.

## Stage 2: several servers (one to three cities, hundreds of cafés, ~100,000 customers)

| Change | Why | Effort |
| --- | --- | --- |
| **Socket.IO Redis adapter** (*required* with 2+ servers) | Live order updates are pushed from the server that handled the change; without a shared adapter, a café whose board is connected to another server misses them | Small: one adapter, one Redis |
| **Rate limits in Redis** (*required* with 2+ servers) | Limits are counted in each server's memory today, so N servers allow N times the attempts (login, OTP) | Small: `@fastify/rate-limit` Redis store |
| Run maintenance jobs on one instance (`JOBS_ENABLED`) | Safe on all, but one is enough and cheaper | Config |
| Connection pooling (PgBouncer or the host's pooler) | Each API instance opens its own pool; Postgres has a connection ceiling | Config |
| Read replica for analytics | Dashboard charts and admin reports stop competing with checkout | Medium |
| City picker in the app | Karachi is the launch city in the app's location defaults; cities and areas are already data | Small |
| Image uploads to object storage + CDN | Cafés paste image URLs today | Medium |
| Queue for jobs and POS (BullMQ, SQS) | When a sweep stops finishing inside its interval, or POS volume grows | Medium |

Signals: API CPU or response times climbing, database connections near the
limit, the maintenance sweep taking longer than `JOB_INTERVAL_SECONDS`.

## Stage 3: national (many cities, thousands of cafés, 1,000,000+ customers)

| Change | Why |
| --- | --- |
| PostGIS for discovery | Discovery takes a bounding box of up to 300 candidate cafés and ranks them in memory, fine for hundreds of cafés per area. Beyond that, a spatial index does it in the database |
| Search service (Typesense, Meilisearch) or Postgres full-text | Menu and café search across many cities |
| Partition hot tables by time (orders, points ledger, audit log) | Keeps indexes small; old months archived |
| Separate realtime and worker services | Scale sockets, HTTP and background work independently |
| Regional deployment | Serve each region from nearby infrastructure |
| Urdu (and other languages), right-to-left layout | The app is English-only today; strings are inline, so this is a pass to extract them (i18n library) plus RTL layout checks |
| Merchant payouts and finance reporting | Each order already records commission, fees and café earnings |

## Expanding the product

| Expansion | What exists | What it takes |
| --- | --- | --- |
| New city | Cities, areas, time zones are data; OSM import takes any city | Seed the city and areas, import its cafés, add a city picker |
| New business types | `BusinessType` enum, category tags | Add the type and categories; the ordering flow is the same |
| More POS systems | Webhook adapter and an adapter seam | One file per vendor in `apps/api/src/services/pos/` |
| More payment methods | `PaymentProvider` interface; Apple Pay and Google Pay are listed methods | One provider file per gateway |
| Delivery (beyond pickup and curbside) | `OrderType` and `PickupMethod` enums | A real addition: addresses at checkout, delivery fees, driver handoff |
| Café chains | One owner can run several cafés; staff belong to cafés | Chain-level reports and shared menus |
| Subscriptions, gift cards | Loyalty ledger and promotions | New features on the same ledger |

## Keeping it safe while it grows

- Every change goes through `npm run verify` and the end-to-end suites
  (`test:e2e`, `test:web`, `test:app`), in CI, before deploying.
- Migrations are forward-only (`prisma migrate deploy`); a destructive change
  (dropping a column) is done in two releases: stop using it, then remove it.
- Feature work behind settings in `platform_settings` can be switched off
  without a release.
- Back up before every migration; rehearse a restore once a quarter.
