# POS integration (webhook)

For the developer connecting a café's point-of-sale system (till, kitchen
display, printer bridge) to Grab & Go.

Grab & Go stays the order board: cafés accept, prepare and hand over orders in
the merchant dashboard, and a POS that is down never blocks an order. With a
connection set up, every order event is also sent to the café's POS, so app
orders reach the till and the kitchen without anyone re-keying them.

## Setting it up

1. In the merchant dashboard, **Settings → Point of sale**, a manager chooses
   **Webhook** and enters the endpoint URL your receiver listens on.
2. On save, the dashboard shows a **signing secret** once. Store it in your
   receiver; it is never shown again (a manager can generate a new one, which
   invalidates the old).
3. **Send a test** posts a signed `ping` and reports what your endpoint answered.

The endpoint must be `https://` on port 443, with no credentials in the URL,
and resolve only to public addresses. Redirects are not followed.

## What you receive

One `POST` per event, `Content-Type: application/json`.

| Header | Meaning |
| --- | --- |
| `X-GrabGo-Event` | The event name, below |
| `X-GrabGo-Delivery` | Unique per event. **Deduplicate on it**: delivery is at least once |
| `X-GrabGo-Timestamp` | Unix seconds when this attempt was signed |
| `X-GrabGo-Signature` | `v1=` + hex HMAC-SHA256 of `` `${timestamp}.${rawBody}` `` with the signing secret |

### Events

| Event | When |
| --- | --- |
| `order.created` | A customer placed the order (card orders may still be unpaid) |
| `order.paid` | The card payment settled |
| `order.accepted` | The café accepted it; `pickup.estimatedReadyAt` is set |
| `order.preparing` | Being made |
| `order.ready` | Ready to collect |
| `order.picked_up` | Handed over (pickup code verified) |
| `order.completed` | Closed |
| `order.cancelled_by_customer`, `order.cancelled_by_cafe`, `order.cancelled_by_admin`, `order.expired` | It will not be collected |
| `ping` | A test from the dashboard |

Events for one order are sent in the order they happened, but a retried event
can arrive after a later one; use `order.status` and `occurredAt` if order
matters to you.

### Payload

```jsonc
{
  "version": 1,
  "event": "order.accepted",
  "occurredAt": "2026-10-12T09:41:07.123Z",
  "order": {
    "id": "cmv41…",
    "orderNumber": "G951904",          // what staff and customer call it
    "source": "APP",
    "status": "ACCEPTED",
    "businessId": "cmuvel…",
    "pickup": {
      "mode": "ASAP",                  // or SCHEDULED
      "at": "2026-10-12T09:53:00.000Z",
      "estimatedReadyAt": "2026-10-12T09:51:00.000Z",
      "method": "CURBSIDE",            // or WALK_IN
      "vehiclePlate": "KHI 4521",      // CURBSIDE only
      "vehicleDetails": "White Corolla"
    },
    "customerNote": "No sugar please",
    "items": [
      {
        "id": "…", "menuItemId": "…",
        "name": "Flat White", "variant": "Large",
        "quantity": 1, "unitPrice": 70000, "lineTotal": 70000,
        "notes": null,
        "modifiers": [{ "group": "Milk", "option": "Oat", "priceDelta": 15000 }]
      }
    ],
    "totals": { "currency": "PKR", "subtotal": 70000, "discount": 0, "tax": 0, "total": 70000 },
    "payment": { "method": "CARD", "status": "PAID" },
    "cancellationReason": null
  }
}
```

Money is in **paisa** (Rs. 1 = 100). The payload never contains the
customer's pickup code: the code is checked in Grab & Go at handover.

## Verifying a delivery

Reject anything whose signature does not match or whose timestamp is more than
five minutes old. Compare in constant time, over the **raw** body.

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verify(rawBody, headers, secret) {
  const timestamp = Number(headers['x-grabgo-timestamp']);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300) return false;
  const expected = `v1=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`;
  const given = String(headers['x-grabgo-signature'] ?? '');
  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}
```

## Answering

- **2xx** — accepted. Answer quickly (within 10 seconds) and do slow work
  afterwards.
- **408, 429, 5xx, or no answer** — retried after 30 s, 2 min, 10 min, 30 min,
  2 h and 6 h, then marked failed.
- **Any other 4xx** — treated as "this payload is wrong" and not retried
  automatically.

Failed and still-retrying deliveries are listed in the dashboard, and the Live
orders screen shows a banner while any order has not reached the POS. Any
staff member can retry them once the POS is fixed; a retry sends the same
delivery id, so deduplication keeps it safe.
