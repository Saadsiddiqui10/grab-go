# API reference

Base URL: `/api/v1`

Every response is one of two shapes, so clients have exactly one thing to branch
on:

```jsonc
// success
{ "ok": true, "data": { ... }, "meta": { "nextCursor": "...", "hasMore": true } }

// failure
{ "ok": false, "error": { "code": "ITEM_UNAVAILABLE", "message": "...", "fields": { ... } } }
```

Clients switch on `error.code`, never on message text. Codes are listed in
`packages/types/src/api.ts` with their HTTP status; unknown codes should be
treated as `INTERNAL_ERROR`.

**Auth column**: — none · **U** signed-in user · **M** café staff (scoped to that
café) · **A** admin. Anything marked U/M/A takes `Authorization: Bearer <token>`.

---

## Authentication

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/auth/register` | — | Email + password. Accepts a referral code. |
| POST | `/auth/login` | — | |
| POST | `/auth/merchant/login` | — | Same credentials, café dashboard entry point |
| POST | `/auth/otp/request` | — | Rate limited to 5 per 10 minutes |
| POST | `/auth/otp/verify` | — | Creates the account on first use |
| POST | `/auth/oauth` | — | Google or Apple. Verifies the ID token against the provider's JWKS |
| POST | `/auth/refresh` | — | Rotates the refresh token; replay revokes the session family |
| POST | `/auth/logout` | U | `allDevices` optional |
| GET | `/auth/me` | U | |
| POST | `/auth/password/reset-request` | — | Always answers the same, whether or not the account exists |
| POST | `/auth/password/reset` | — | |
| POST | `/auth/password/change` | U | Signs out every other session |
| DELETE | `/auth/account` | U | Soft delete; orders are retained as financial records |
| POST | `/auth/devices` | U | Register a push token |
| DELETE | `/auth/devices/:token` | U | |

Auth routes are limited to 10 requests per minute, separately from the global
limit.

---

## Catalogue

All public. Signing in only ever *adds* something (favourite flags,
personalised ordering).

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/config` | — | Public slice of the loyalty, referral and platform config |
| GET | `/cities` | — | Cities with their areas |
| GET | `/cafes` | — | Discovery. See parameters below |
| GET | `/cafes/:idOrSlug` | — | Optional `latitude`/`longitude` for distance |
| GET | `/cafes/:idOrSlug/menu` | — | Available items only |
| GET | `/cafes/:idOrSlug/pickup-slots` | — | Computed live from hours, lead time and load |
| GET | `/cafes/:idOrSlug/reviews` | — | |
| GET | `/search/items` | — | Menu-item search across cafés |

**`GET /cafes` parameters** — `q`, `cityId`, `areaId`, `latitude`, `longitude`,
`radiusMeters` (default 10000), `type`, `tags`, `openNow`, `favouritesOnly`,
`minRating`, `maxPrepMinutes`, `priceTier`, `sort`
(`RECOMMENDED` | `NEAREST` | `FASTEST` | `RATING` | `POPULAR`), `cursor`, `limit`.

Location is optional throughout. Without coordinates, `NEAREST` falls back to
`RECOMMENDED` and `distanceMeters` comes back `null`.

Only live (`ACTIVE`) cafés are public. A café that is pending approval,
suspended or rejected answers 404 on its detail and menu, except to admins and
its own staff, who can preview it.

---

## Cart and orders

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/cart/quote` | U | Authoritative pricing. Non-strict: problems come back as warnings |
| POST | `/orders` | U | Checkout. Strict pricing. Requires `idempotencyKey` |
| GET | `/orders` | U | `status`: `ACTIVE` \| `COMPLETED` \| `CANCELLED` \| `ALL` |
| GET | `/orders/:orderId` | U | Includes the pickup code and a short-lived QR token |
| POST | `/orders/:orderId/cancel` | U | Allowed before acceptance, plus a configurable grace window |
| POST | `/orders/:orderId/reorder` | U | Rebuilds the basket against today's menu and prices |
| POST | `/reviews` | U | Only for an order the caller collected |

### `POST /orders`

```jsonc
{
  "businessId": "clx…",
  "lines": [
    {
      "menuItemId": "clx…",
      "variantId": "clx…",
      "modifierOptionIds": ["clx…", "clx…"],
      "quantity": 1,
      "notes": "extra hot"
    }
  ],
  "pickup": { "mode": "ASAP" },              // or SCHEDULED + pickupAt
  "collection": { "method": "WALK_IN" },     // or CURBSIDE + vehiclePlate (+ vehicleDetails)
  "promoCode": "WELCOME50",
  "redemptionId": null,
  "paymentMethod": "CARD",
  "idempotencyKey": "a-client-generated-uuid"
}
```

Note what is **not** in the body: no prices, no totals, no points, no payment
status. The server derives all of them.

`collection` defaults to walking in. For `CURBSIDE` the number plate is
required (2–16 letters, digits, spaces or dashes; stored upper-cased) and is
shown on the café's ticket so staff can find the car. A `redemptionId` must
belong to a reward of the same café.

`idempotencyKey` is required. A retry with the same key returns the original
order instead of creating a second one — a flaky connection must not turn one
tap on "Pay" into two coffees and two charges.

Common failures: `BUSINESS_CLOSED`, `BUSINESS_NOT_ACCEPTING_ORDERS`,
`BUSINESS_AT_CAPACITY`, `ITEM_UNAVAILABLE`, `INVALID_PICKUP_TIME`,
`MODIFIER_SELECTION_INVALID`, `MINIMUM_ORDER_NOT_MET`.

---

## Payments

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/payments/initiate` | U | Opens a charge with the provider |
| POST | `/payments/confirm` | U | Body is `{ paymentId }` and nothing else |
| POST | `/webhooks/payments` | — | Signature-verified, then re-verified with the provider |

`/payments/confirm` takes no status. The server asks the provider what happened;
a client claiming success does not make an order paid, and a capture smaller than
the order total is treated as a failure.

---

## The customer

| Method | Path | Auth |
| --- | --- | --- |
| PATCH | `/users/me` | U |
| GET / POST | `/users/me/favourites` | U |
| DELETE | `/users/me/favourites/:businessId` | U |
| GET / POST | `/users/me/addresses` | U |
| DELETE | `/users/me/addresses/:addressId` | U |
| GET | `/users/me/points` | U |
| GET | `/users/me/points/transactions` | U |
| GET | `/rewards` | optional |
| GET | `/users/me/rewards` | U |
| POST | `/rewards/:rewardId/redeem` | U |
| GET | `/users/me/referrals` | U |
| GET | `/users/me/notifications` | U |
| POST | `/users/me/notifications/read` | U |
| GET / PUT | `/users/me/notification-preferences` | U |
| POST | `/analytics/events` | optional |

**There is no `POST /points`.** Points enter the ledger only from server-side
events — an order collected, a referral qualifying, an admin adjustment. No
client-facing shape can express "give me 500 points".

**Points are per café.** `GET /users/me/points` returns totals plus `cafes[]`,
one card per café with its balance and next reward. Every reward belongs to a
café; `GET /rewards?businessId=` narrows the list, and redeeming spends the
points on that café's card only. A redemption code discounts orders at that
café only.

---

## Merchant

Every path is scoped by `:businessId`, and `requireStaffOf` is the first line of
each handler. An authenticated merchant cannot reach another café by changing an
id.

| Method | Path | Auth |
| --- | --- | --- |
| GET | `/merchant/businesses` | M |
| GET | `/merchant/:businessId/orders` | M |
| GET | `/merchant/:businessId/orders/:orderId` | M |
| POST | `/merchant/:businessId/orders/:orderId/accept` | M |
| POST | `/merchant/:businessId/orders/:orderId/reject` | M |
| POST | `/merchant/:businessId/orders/:orderId/preparing` | M |
| POST | `/merchant/:businessId/orders/:orderId/ready` | M |
| POST | `/merchant/:businessId/orders/:orderId/pickup` | M |
| POST | `/merchant/:businessId/orders/pickup-scan` | M |
| POST | `/merchant/:businessId/orders/:orderId/complete` | M |
| PATCH | `/merchant/:businessId/orders/:orderId/prep-time` | M |
| GET | `/merchant/:businessId/menu` | M |
| POST / PATCH / DELETE | `/merchant/:businessId/categories[/:id]` | M |
| POST | `/merchant/:businessId/categories/reorder` | M |
| POST / PATCH / DELETE | `/merchant/:businessId/items[/:id]` | M |
| PATCH | `/merchant/:businessId/items/:itemId/availability` | M |
| POST | `/merchant/:businessId/items/reorder` | M |
| PATCH | `/merchant/:businessId/profile` | M |
| PATCH | `/merchant/:businessId/settings` | M |
| PUT | `/merchant/:businessId/hours` | M |
| POST / DELETE | `/merchant/:businessId/holidays[/:id]` | M |
| GET / POST / PATCH | `/merchant/:businessId/staff[/:id]` | M — manager or owner |
| GET | `/merchant/:businessId/analytics` | M |
| GET / POST / PATCH | `/merchant/:businessId/rewards[/:id]` | M — the café's own rewards; never deleted, retire with `isActive: false` |
| GET | `/merchant/:businessId/pos` | M — connection status, pending and failed deliveries (never the secret) |
| PUT | `/merchant/:businessId/pos` | M — manager or owner. Returns the signing secret once, when created |
| POST | `/merchant/:businessId/pos/rotate-secret` | M — manager or owner |
| POST | `/merchant/:businessId/pos/test` | M — manager or owner. Sends a signed `ping` |
| POST | `/merchant/:businessId/pos/retry` | M — any staff. `{ jobId? }`, all when omitted |

Free-item rewards may only name items on the café's own menu. POS receivers
are documented in [`pos-integration.md`](pos-integration.md).

`reject` requires a reason (`ITEM_UNAVAILABLE`, `TOO_BUSY`, `CLOSING_SOON`,
`TECHNICAL_ISSUE`, `OTHER`) — the state machine refuses the transition without
one, because the customer is owed an explanation.

`pickup` and `pickup-scan` both verify server-side: constant-time comparison,
attempt-limited, single use, and only from `READY`.

Admins pass `requireStaffOf` for every café, so the admin dashboard edits a
café's profile and menu through these same routes (and the audit log records
the admin as the actor).

---

## Admin

| Method | Path | Auth |
| --- | --- | --- |
| GET | `/admin/users` | A |
| GET | `/admin/users/:userId` | A |
| POST | `/admin/users/:userId/suspend` | A |
| POST | `/admin/users/:userId/restore` | A |
| POST | `/admin/points/adjust` | A — `businessId` required: points live on a café card |
| GET / POST | `/admin/businesses` | A |
| POST | `/admin/businesses/:id/approve` | A |
| POST | `/admin/businesses/:id/reject` | A |
| POST | `/admin/businesses/:id/suspend` | A |
| POST | `/admin/businesses/:id/reinstate` | A |
| GET | `/admin/orders` | A |
| POST | `/admin/orders/:orderId/cancel` | A |
| POST | `/admin/orders/:orderId/refund` | A |
| GET | `/admin/config` | A |
| PUT | `/admin/config/loyalty` | A |
| PUT | `/admin/config/referral` | A |
| PUT | `/admin/config/platform` | A |
| GET / POST / PATCH | `/admin/rewards[/:id]` | A — every reward names a café, and cannot move to another |
| GET / POST / PATCH | `/admin/promotions[/:id]` | A |
| POST | `/admin/cities` | A |
| POST | `/admin/areas` | A |
| GET | `/admin/analytics` | A |
| GET | `/admin/audit-logs` | A |

Every admin mutation writes an audit entry with the actor, the target, and the
before/after values. Suspending a user revokes their sessions immediately rather
than waiting for the access token to expire.

---

## Realtime

Socket.IO at `/realtime`, authenticated with the access token:

```ts
io(REALTIME_URL, { path: '/realtime', auth: { token: accessToken } });
```

**Server → client**

| Event | Payload |
| --- | --- |
| `order.created` | `OrderSummary` |
| `order.status_changed` | order id, number, business, status, previous status, ETA |
| `order.payment_changed` | order id, payment status |
| `business.availability_changed` | accepting orders, open, busy-until |
| `points.changed` | balance, delta, reason |

**Client → server**

| Event | Notes |
| --- | --- |
| `subscribe:order` | Server verifies the caller placed it or staffs the café |
| `subscribe:business` | Server verifies the caller staffs that café |

Room membership is always decided server-side.

---

## Health

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health` | Liveness. Does not touch the database |
| GET | `/ready` | Readiness. 503 when Postgres is unreachable |

---

## Rate limits

Global: 300 requests per minute, keyed by access token where present and by IP
otherwise — so several customers behind one café's NAT do not throttle each
other. Auth routes: 10 per minute. OTP requests: 5 per 10 minutes.

Exceeding a limit returns `429` with `code: "RATE_LIMITED"`.
