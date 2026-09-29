# Grab & Go

**Order ahead. Skip the line.**

A pickup-first ordering platform for cafés, launching in Karachi. Customers order
before they arrive, pay in the app, watch the order progress live, show a code at
the counter, and walk out. No delivery, no queue.

This repository contains the whole product: the customer app, the café dashboard,
the admin dashboard, the API, and the shared domain logic all four depend on.

---

## What is here

```
apps/
  api/                  Fastify + Prisma + PostgreSQL + Socket.IO
  mobile/               Expo / React Native customer app (iOS + Android)
  merchant-dashboard/   Café live-order board, menu, hours, staff, analytics
  admin-dashboard/      Users, cafés, orders, loyalty rules, promotions
packages/
  core/                 Pure domain logic — pricing, state machine, loyalty, referrals
  types/                Shared domain vocabulary and API contracts
  validation/           Zod schemas shared by server and clients
  config/               Design tokens and cross-client constants
  ui/                   Web building blocks for the two dashboards
```

### The idea that holds it together

`packages/core` contains every rule that has to be correct — how an order is
priced, which status transitions are legal, how points are earned, when a
referral qualifies — as **pure functions with no I/O**. The API calls them, and
the clients import the same money formatting and status labels.

That is what makes the rules testable without a database, and what stops the
mobile app and the server disagreeing about what an order costs.

---

## Getting started

Requirements: **Node 20.11+** and **Docker** (for Postgres).

```bash
# 1. Install and generate the Prisma client
npm run setup

# 2. Start Postgres
docker compose up -d

# 3. Configure the API
cp apps/api/.env.example apps/api/.env
#    then set AUTH_SECRET and PICKUP_TOKEN_SECRET:
#    node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

# 4. Create the schema and seed Karachi
npm run db:deploy
npm run db:seed

# 5. Run it
npm run dev:api        # http://localhost:4000
npm run dev:merchant   # http://localhost:5173
npm run dev:admin      # http://localhost:5174
npm run dev:mobile     # Expo — press i / a, or scan the QR
```

> **Windows note.** This repository lives in a folder whose name contains `&`,
> which `cmd.exe` treats as a command separator and which breaks every npm
> script. The included `.npmrc` sets `script-shell=bash` to work around it. If
> you move the project, a path without `&` avoids the problem entirely.

### Demo accounts

Seeded by `npm run db:seed`. Password for all of them: **`grabandgo2026`**

| Role     | Sign in with                                   |
| -------- | ---------------------------------------------- |
| Admin    | `admin@grabgo.pk`                              |
| Customer | `saad@example.com` — or phone `0300 1234567`   |
| Customer | `hina@example.com`                             |
| Café     | `owner@espressolab.example` and five others    |

Promo codes: `WELCOME50` (Rs. 50 off a first order over Rs. 300) and
`MORNINGRUSH` (15% off, capped at Rs. 200).

In development `OTP_DEV_CODE=000000` lets you sign in by phone on a simulator
with no SIM. The API refuses to boot in production if it is set.

---

## Walking the core loop

The loop the whole product exists for, and how to exercise it end to end:

1. **Mobile** — sign in, pick *Espresso Lab*, add an Iced Latte (large, oat
   milk, extra shot), choose a pickup time, pay. The mock payment provider
   settles instantly.
2. **Merchant dashboard** — the order appears on the live board within a second,
   with a chime. Accept it, mark it preparing, mark it ready.
3. **Mobile** — the order screen updates without a refresh, and a push arrives.
   The pickup code is now full-bleed on the screen.
4. **Merchant dashboard** — *Verify pickup*, type the code, hand it over.
5. **Mobile** — Grab Points land on the Rewards tab.

To watch the failure paths: order a total ending in **Rs. 0.13** and the mock
provider declines it.

---

## Testing

```bash
npm test        # 200+ tests across core, validation and the API
npm run verify  # typecheck everything, then test
```

| Suite                 | What it covers                                                                   |
| --------------------- | -------------------------------------------------------------------------------- |
| `packages/core`       | Pricing, order state machine, points, referrals, promotions, pickup codes, hours   |
| `packages/validation` | Phone normalisation, cart and menu rules, promo constraints                        |
| `apps/api`            | Env guards, JWT and pickup tokens, error mapping, auth on every protected route    |

The domain tests are the ones that matter most. They cover the things that cost
real money if they are wrong: that a discount can never exceed the basket, that
`COMPLETED → PREPARING` is impossible, that signing up does not earn a referral
reward, and that a pickup code cannot be brute-forced.

---

## How the important parts work

### Money

Every amount is an integer number of **paisa**. No float touches a monetary
value anywhere — not in the database, not on the wire, not in the app.
`formatPKR` renders `65000` as `Rs. 650`.

### Server-authoritative pricing

The client sends item ids, a variant id, chosen option ids and a quantity. It
never sends a price. `computeQuote` in `packages/core` reads the live menu,
re-derives every number, and that result is what gets charged. A tampered client
can change *what* is ordered, never *what it costs*.

### The order state machine

Every status change goes through `checkTransition`, which knows the legal
transitions, who is allowed to request each one, and what else must be true
(a cancellation reason, a verified pickup code, a cancel window that has not
closed). The API never writes `order.status` directly.

```
PENDING → ACCEPTED → PREPARING → READY → PICKED_UP → COMPLETED
```

`ACCEPTED → READY` is also allowed — a barista pulling one espresso should not
have to tap twice a second apart. It is forward-only, so it cannot skip
verification.

### Payments

`verifyPayment` is the only thing that can mark an order paid, and it asks the
provider. `POST /payments/confirm` takes a payment id and nothing else — there
is no field a client could use to assert success. Providers sit behind a
five-method interface, so swapping the gateway is one new file.

### Loyalty

Points are an append-only ledger. The balance on `PointsAccount` is a cached sum
maintained in the same transaction as the row that moved it, and a spend is a
conditional update (`balance >= amount`) rather than read-then-write, so two
concurrent redemptions cannot both succeed. There is deliberately no endpoint
that lets a client name a points amount.

### Referrals

Signing up never pays out. A referral moves `PENDING → QUALIFIED` only when the
invited person collects a real order that clears the configured minimum, with
guards for self-referral, repeat claims, device farming and a monthly cap.
The threshold — three friends by default — is configuration, not a constant.

### Pickup verification

Six characters from a 31-symbol alphabet with no `0/O/1/I/L`, drawn by rejection
sampling from a CSPRNG, compared in constant time, attempt-limited, and single
use. Customers also get a short-lived signed QR, so a screenshot shared in a
group chat stops working while their own screen keeps refreshing.

### Location is optional

Every discovery path works without coordinates. Declining the OS prompt is a
supported route, not a dead end — the customer picks a Karachi area instead and
gets the same experience, sorted by relevance rather than distance.

### Configuration, not constants

"Rs. 100 = 1 point", "three friends earn a free coffee", "orders expire after
ten unaccepted minutes" are all rows in `platform_settings`, edited from the
admin dashboard and read by the API on every order. `DEFAULT_*` values in
`packages/types/src/config.ts` only seed a fresh install.

---

## Platform-specific behaviour

The mobile app shares one visual identity but adapts its interactions:

| | iOS | Android |
| --- | --- | --- |
| Buttons | Spring scale on press, softer radius | Material ripple, pill radius |
| Item screen | Native card modal | Full screen |
| Tab bar | Translucent blur, content scrolls under | Opaque surface with hairline |
| Keyboard | `KeyboardAvoidingView` with padding | System `windowSoftInput` resize |
| Back | Swipe-back gesture | System back gesture and button |
| Sign-in | Apple Sign In offered | Google offered |
| Payment | Apple Pay offered | Google Pay offered |
| Notifications | Permission requested post-signup | Channels with explicit importance |
| Search field | Native clear button | Drawn clear button |

---

## Multi-city and multi-vertical

Nothing is named after coffee. The schema has `businesses`, `menu_items`,
`orders` — not `cafes` and `coffee_orders`. `BusinessType` already contains
`RESTAURANT`, `BAKERY`, `FAST_FOOD`, `DESSERT` and `BUBBLE_TEA`; opening a new
vertical is seed data, not a migration.

Cities and areas are tables. Karachi is seeded active, Lahore is seeded inactive
specifically to prove nothing is hardcoded — launching it is a flag.

---

## Commands

| Command | What it does |
| --- | --- |
| `npm run setup` | Install, build shared packages, generate the Prisma client |
| `npm run dev:api` | API with hot reload on :4000 |
| `npm run dev:mobile` | Expo dev server |
| `npm run dev:merchant` | Café dashboard on :5173 |
| `npm run dev:admin` | Admin dashboard on :5174 |
| `npm run db:deploy` | Apply migrations (production-safe) |
| `npm run db:migrate` | Create a migration from a schema change |
| `npm run db:seed` | Seed Karachi, six cafés, menus, users, rewards |
| `npm run db:reset` | Drop, re-migrate and re-seed |
| `npm run db:studio` | Prisma Studio |
| `npm run build` | Build packages, API and both dashboards |
| `npm test` | Run every test suite |
| `npm run verify` | Typecheck everything, then test |

---

## Further reading

- [`docs/architecture.md`](docs/architecture.md) — request lifecycle, data flow, deployment
- [`docs/api.md`](docs/api.md) — every endpoint, with the auth each requires
- [`apps/api/prisma/schema.prisma`](apps/api/prisma/schema.prisma) — the data model, commented

## Known gaps

Honest about what is not finished, so nobody discovers it in production:

- **Payments** ship with a mock provider. The `PaymentProvider` interface and the
  whole verification flow are real; a Safepay implementation is one file, and the
  API refuses to start in production while `PAYMENT_PROVIDER=mock`.
- **Transactional email** is not wired to a sender. Password reset issues and
  validates real tokens, but delivery is a `TODO(email)` in `auth.service.ts`;
  in development the token is returned in the response.
- **Variant and modifier editing** in the merchant dashboard is read-only. The
  data model, the API and the seed all support them fully; only that one editor
  is outstanding.
- **Image upload** expects URLs. There is no storage integration yet — the
  `STORAGE_*` variables are reserved for it.
- **Merchant payouts** are not implemented. Every order stores its commission,
  merchant earnings and processing fee, so the ledger to build them from exists.
