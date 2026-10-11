# API end-to-end tests

The whole API (routes, services, Prisma, the POS outbox) against a real
Postgres database, driven over HTTP in process. Each file is a set of
customer, café and admin journeys:

| File | Covers |
| --- | --- |
| `accounts` | sign-up, sign-in, login throttling, password reset and change, protected routes |
| `ordering` | walk-in and curbside orders, server-side pricing, idempotent checkout, pickup codes and their lockout, cancellation rules, paused cafés, cash, double payment |
| `loyalty` | per-café points, café-run rewards, redemptions that only work at their café, admin adjustments, referral points |
| `pos` | signed webhook delivery, event order, retries with the sweep, rejected payloads, manual retry, switching off |
| `cafes-and-admin` | browsing, onboarding (pending cafés hidden, audited), admin menu edits, profile and logo, staff permissions |

## Running

Postgres must be running. Then, from the repo root:

```bash
npm run test:e2e
```

The suite uses its own database, `grabgo_e2e`, next to the one in
`apps/api/.env` (override with `E2E_DATABASE_URL`; the name must end in
`_e2e`). It is created if missing, migrated and seeded on every run. Nothing is
dropped: tests create their own customers, restore any café settings they
change, and open orders left by a previous run are closed out at the start.
To begin from empty, drop `grabgo_e2e` by hand.

The suite runs the API with `NODE_ENV=development`, which is what returns
password-reset codes (email is not wired up) and allows a POS receiver on
localhost. Seeded cafés are opened 24 hours a day so it passes at any hour.

It is not part of `npm run verify`, which needs no database.
