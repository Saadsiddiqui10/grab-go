# Architecture

How Grab & Go is put together, and why.

---

## The shape

```
┌──────────────┐   ┌─────────────────────┐   ┌──────────────────┐
│  Mobile app  │   │ Merchant dashboard  │   │ Admin dashboard  │
│  Expo / RN   │   │    Vite + React     │   │  Vite + React    │
└──────┬───────┘   └──────────┬──────────┘   └────────┬─────────┘
       │                      │                       │
       │      REST + Socket.IO over HTTPS             │
       └──────────────────────┼───────────────────────┘
                              ▼
                   ┌─────────────────────┐
                   │    Fastify API      │
                   │  routes → services  │
                   └──────────┬──────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
     ┌────────────────┐  ┌─────────┐  ┌───────────────┐
     │ @grabgo/core   │  │ Prisma  │  │  Providers    │
     │ pure rules     │  │ Postgres│  │ pay, sms, push│
     └────────────────┘  └─────────┘  └───────────────┘
```

Four clients, one API, one database, and a domain package all four share.

---

## Layers in the API

A request moves through exactly four layers, and each one has a single job.

**Route** — parses input with a Zod schema from `@grabgo/validation`, resolves
the principal from the bearer token, calls one service, wraps the result in the
response envelope. No business logic, no Prisma calls.

**Service** — orchestrates. Loads rows, calls the domain package for decisions,
writes inside a transaction, and fires side effects (realtime, push) *after* the
commit. This is the only layer that touches both the database and the domain.

**Domain** (`@grabgo/core`) — decides. Pure functions, no imports beyond
`@grabgo/types`, no clock unless one is passed in, no randomness unless it is
injected. Returns a `Result` for expected failures and throws `DomainError` only
for genuine rule violations.

**Data** (Prisma) — stores. The schema is the source of truth for shape and
constraints; several invariants are enforced there rather than in code, because
a database constraint cannot be forgotten by a new call site.

### Why the domain is separate

Three concrete payoffs:

1. **It is testable without Postgres.** 179 tests run in under a second and cover
   the rules that cost money if they are wrong.
2. **The clients reuse it.** The mobile app imports `formatPKR`,
   `progressIndex`, `formatPickupCodeForDisplay` and the order status labels
   from the same package the server prices orders with. They cannot drift.
3. **Rules are readable in one place.** "When does a referral qualify?" is one
   function, not a trail through three services.

---

## Invariants, and where they are held

Each of these is enforced at the lowest layer that can enforce it.

| Invariant | Held by |
| --- | --- |
| An order total is never supplied by a client | `createOrderSchema` has no price field; `computeQuote` derives it |
| An order cannot move backwards | `checkTransition`, called by the one function that writes status |
| Points are only awarded once per order | Unique index on `(orderId, type)` in `points_transactions` |
| A points balance cannot go negative from a spend | Conditional `updateMany ... where balance >= amount` |
| An account is referred at most once | `refereeId` is unique on `referrals` |
| A referral pays out at most once per side | Unique `(referralId, kind)` on `referral_rewards` |
| A retried checkout creates one order | Unique `(userId, idempotencyKey)` on `orders` |
| Only a collected order can be reviewed | `orderId` is required and unique on `reviews`, plus a status check |
| A pickup code cannot be brute-forced | Attempt counter on the order, checked before comparison |
| An order is paid only when the provider says so | `confirmPayment` accepts no status argument |

---

## Request lifecycle: placing an order

The most important path in the product, step by step.

```
POST /api/v1/orders
  │
  ├─ parse(createOrderSchema)            reject malformed input with field errors
  ├─ requireAuth()                       verify the JWT, resolve the principal
  │
  ├─ loadBusiness()                      with hours, holidays, area
  ├─ computeAvailability()               open? busy? what is the real lead time?
  ├─ assertCanAcceptOrder()              status, schedule, slot capacity
  │
  ├─ priceCart({ strict: true })         ← the authoritative number
  │    ├─ load current menu rows
  │    ├─ validate every variant and modifier selection
  │    ├─ evaluate the promo code against its own limits
  │    ├─ apply a redeemed reward, clamped to what is owed
  │    └─ compute tax and earnable points from live config
  │
  ├─ computeSettlement()                 commission and merchant earnings, snapshotted
  │
  └─ transaction
       ├─ insert order + item snapshots  name and price copied, not joined
       ├─ consume the reward redemption
       ├─ record the promo redemption, increment its counter
       ├─ write the PENDING status event
       └─ create the payment row
  │
  ├─ emit order.created                  the café board lights up
  └─ 201 with the order, including the pickup code
```

Two details worth calling out.

**Order lines are snapshots.** The name, unit price and every modifier are
copied onto `order_items`. A price change tomorrow cannot rewrite what a
customer was charged today.

**Side effects happen after the commit.** Realtime and push fire once the
transaction is durable. Nobody is told their coffee is ready before that is
true, and a failed push never rolls back an order.

---

## Realtime

Socket.IO with three room types:

- `user:{userId}` — joined automatically, carries that customer's order and
  points updates
- `order:{orderId}` — joined on request, after the server checks the asker
  placed the order or staffs the café
- `business:{businessId}` — the café's live board, gated on the staff list in
  the access token

Entitlement is always decided server-side. A client that guesses an order id
gets nothing.

Realtime is an **accelerator, not a source of truth**. Every screen also polls
or refetches on focus, so a dropped socket degrades to a slower correct app
rather than a wrong one. The mobile app disconnects when backgrounded — push
covers that window.

---

## Authentication

Access tokens are short-lived (15 min) JWTs carrying the user id, role, and the
businesses they staff — enough to authorise a merchant request with no database
round trip.

Refresh tokens are opaque random strings, stored only as a SHA-256 hash, and
**rotated on every use**. Presenting an already-rotated token revokes the entire
session family, because the only way that happens is if a token was stolen.

Both clients refresh **single-flight**: several queries failing with 401 at the
same moment must not each rotate the token, or the replay detection would
correctly revoke a legitimate session.

Passwords are bcrypt at cost 12. Login always runs a comparison, against a decoy
hash when the account does not exist, so response time cannot be used to
enumerate registered emails.

---

## Payments

The provider interface is deliberately small:

```ts
supports(method)                     can this provider handle it at all
createPayment(input)                 open a charge, return a client token
verifyPayment(providerPaymentId)     ← the only source of PAID
refund(providerPaymentId, amount)
verifyWebhookSignature(body, sig)    constant-time, over the raw body
parseWebhook(body)
```

`verifyPayment` takes an id and returns what the provider says. There is no
parameter through which a caller could assert success, and the webhook path
re-verifies rather than trusting a signed body — so a replayed webhook cannot
invent a capture.

A capture smaller than the order total is treated as a failure, not a partial
success.

---

## Data model notes

**Money is integer paisa** everywhere. `Int` in Postgres, `number` in
TypeScript, never a float or a `Decimal` that could be coerced to one.

**Order economics are snapshotted.** `commissionBasisPoints`,
`platformCommission` and `merchantEarnings` are written onto each order. Raising
the commission rate next quarter cannot retroactively change what a café earned
last quarter.

**Soft deletes where records must survive.** Deleting an account clears the
identifying fields and retires the row; orders and payments are financial
records. Menu items are soft-deleted so historical order lines keep their
foreign key.

**Cached aggregates are transactional.** `PointsAccount.balance` is a cache over
`points_transactions`, only ever written in the same transaction as the ledger
row that moved it, and rebuildable from the ledger at any time.

**On roles.** Authorisation is a platform-level `UserRole` plus per-business
`CafeStaff` rows, rather than generic `roles`/`permissions` join tables. Every
access check in this product is "is this person staff at this café, and at what
level" — which those two express directly. A generic RBAC engine would be
indirection with no current caller.

---

## Discovery and location

Distance sorting cannot be pushed into SQL without PostGIS, so discovery fetches
a bounded candidate set using an indexed bounding box on lat/lng, ranks it in
memory with exact haversine, and pages the result.

At launch scale — one city, tens of cafés — this is a single fast query. The
ceiling is the point at which PostGIS earns its keep, and the boundary is one
function (`discoverBusinesses`).

Open/closed and "ready in ~N min" are **computed live** from the café's schedule
and current in-flight order count, never read from a stale column. A card that
says "Open" when the shutters are down is worse than no card.

---

## Background jobs

A plain interval inside the API process, not a queue. Each task is idempotent,
so running it twice or on two instances is harmless.

- **Expire unaccepted orders** — a `PENDING` order past the accept window
  becomes `EXPIRED`. Without this a customer waits for a coffee nobody is making.
- **Expire stale points** — writes an `EXPIRY` ledger row rather than editing the
  original earn, so history still shows what was earned and when it lapsed.
- **Prune dead sessions** — keeps the table from growing without bound.

At launch scale these are seconds of work. A queue would be infrastructure to
operate for no benefit; the swap point is when a task stops finishing inside its
interval.

---

## Deployment

**API** — any Node host. `npm run build`, then `node dist/index.js`. Needs
`DATABASE_URL` and the two signing secrets. `/health` answers without touching
the database (liveness); `/ready` checks Postgres (readiness).

**Migrations** — `npm run db:deploy` runs `prisma migrate deploy`, which applies
committed migrations and never generates or drops anything.

**Dashboards** — static bundles. `npm run build` in each produces `dist/`; serve
it behind anything, with a rewrite to `index.html` for client-side routing.

**Mobile** — EAS Build. The API URL comes from `app.json`'s `extra` block or
`EXPO_PUBLIC_API_URL`.

**Scaling order**, when it is needed: the API is stateless and scales
horizontally first; Socket.IO then needs its Redis adapter so rooms span
instances; Postgres gets a read replica for analytics; discovery moves to
PostGIS. None of that changes the domain package.

---

## What this architecture buys

- The rules that cost money are pure functions with tests, not scattered `if`s.
- A client cannot set a price, a payment status, or a points balance — not
  because it is asked not to, but because no such field exists.
- Adding a city, a vertical, or a payment provider is data or one file.
- The mobile app and the server cannot disagree about what an order costs,
  because they run the same code to find out.
