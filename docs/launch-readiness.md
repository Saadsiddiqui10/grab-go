# Launch readiness: finalisation report

*Branch `ios-and-map`, October 2026.*

## Verdict

**The product is feature-complete for a first city, and it has been verified
end to end. It is not ready for real customers yet**, for three reasons that
are outside the code built so far:

1. **Card payments are not connected.** The payment flow is real (server-side
   verification, webhooks, refunds, idempotency, tests) but the gateway itself
   (Safepay or similar) is not implemented, and the server deliberately refuses
   to start in production without one.
2. **No email is sent.** Password reset works end to end, but in production
   nobody would receive the reset code.
3. **It has not been run as a release build, on real phones, or on Android.**
   Everything was verified on the iOS simulator in development mode.

With the payment gateway, an email sender, SMS credentials, the privacy and
terms pages, and a release-build test on devices (a couple of weeks of focused
work, mostly integration and testing rather than new features), it would be
ready for a **soft launch**: a handful of partner cafés and invited customers.
A public App Store launch also needs the operational pieces in the
[production checklist](production-checklist.md): monitoring, CI, backups and
café onboarding.

## What was built in this finalisation

| Area | Delivered |
| --- | --- |
| **iOS app** | Native iOS tab bar and Liquid Glass, Figma redesign with dark mode, category themes (coffee, chai, matcha, breakfast…) with animated pours and wallpapers, smooth tab transitions, instant category switching with prefetching |
| **Map** | Every café in Karachi: partner pins with logos (or initials) that group when they would overlap, ~680 "not on Grab & Go yet" cafés from OpenStreetMap as clustered grey dots, a preview card, and a list view |
| **Loyalty** | Points per café; cafés define their own rewards (amount, percentage or free item); rewards only redeemable at their café; referral points land on the café the friend ordered from |
| **Pickup** | Walk in or bring to the car, with a validated number plate shown on the café's ticket |
| **Accounts** | Confirm password at sign-up, forgot and change password (signs out every device), account deletion |
| **Café page** | Address with directions and call, opening hours with today highlighted, "rewards here" |
| **Café dashboard** | Rewards manager, profile and logo, POS connection with delivery health and retry, live-order banner when the POS is behind, tablet layout (stages side by side, 44 px touch targets) |
| **Admin dashboard** | Edit any café's profile and menu (same editors as the café's), café-scoped rewards and points adjustments, per-café balances |
| **POS** | Transactional outbox, signed webhook adapter, retries with backoff, SSRF-safe endpoints, encrypted secrets; [integration guide](pos-integration.md) for POS developers |
| **Quality** | ESLint across the monorepo, 325 unit tests, 39 end-to-end journeys against a real database |

## How it was verified

- **Unit tests (325):** pricing, order state machine, loyalty, referrals,
  pickup codes, opening hours, pin clustering, validation rules, payments,
  POS signing, secret encryption and endpoint safety.
- **End-to-end (39), repeatable:** accounts, ordering (including server-side
  pricing, idempotent checkout, pickup-code lockout, cancellation windows,
  paused cafés, double payment), per-café loyalty, POS delivery and retries
  against a real receiver, café onboarding and admin. See
  [`apps/api/e2e/README.md`](../apps/api/e2e/README.md).
- **By hand:** every customer flow on the iOS simulator, both dashboards in
  the browser at desktop, iPad and phone widths.
- **Lint and type-checks** clean on all four apps and five packages.

### Security issues found and fixed during finalisation

- Image URLs accepted `javascript:` and `data:` links (now http(s) only).
- The payment return URL could become an open redirect (now https or the app's
  own `grabgo://` links only).
- Pending, suspended and rejected cafés were publicly readable (now 404 except
  to admins and their staff).
- Café onboarding was not written to the audit log (now it is, without the
  temporary password).
- POS endpoints are guarded against SSRF and DNS rebinding; POS secrets are
  encrypted at rest and never returned after creation.

## What is left

### Before any real customer (blockers)

| Item | Effort |
| --- | --- |
| Payment gateway (Safepay or similar): implement the provider, test in its sandbox | Days, mostly sandbox testing |
| Transactional email for password reset | Under a day |
| SMS provider account and sender for phone sign-in (adapter exists) | Account setup |
| Privacy policy and terms pages (the app links to them) | Writing, not code |
| Release builds tested on a real iPhone and a real Android phone | A day or two |
| Production secrets and configuration (see checklist) | Hours |

### Before a public launch

- Error monitoring (API and app), CI running `verify` and `test:e2e`, a
  Dockerfile for the API, database backups with point-in-time recovery.
- Replace demo data with real cafés: owners, menus, hours, logos.
- App Store and Play Store listings, screenshots, privacy answers.
- Café onboarding and someone watching the admin dashboard in the first weeks.

### Later

- Image upload for logos and menu photos (cafés paste URLs today).
- Editing sizes and option groups in the menu editor (read-only today).
- Merchant payouts (the ledger already records commission and earnings).
- Vendor-specific POS adapters as real integrations come along.
- Browser tests for the dashboards and device tests for the app (Playwright,
  Maestro); the API journeys are covered today.

## Known limitations to be aware of

- Café detail and menus are browsable while a café is closed; ordering is what
  waits (by design).
- Map tiles come from OpenFreeMap without a key; review its fair-use terms
  against expected traffic.
- The demo database contains test rewards, orders and customers from
  verification runs; production starts from an empty database.
