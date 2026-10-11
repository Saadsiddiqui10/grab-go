# Production checklist

Everything that has to be true before real customers order. Items marked
**blocker** stop the launch outright; the API itself refuses to start without
some of them.

## External services

| | Service | Status in this repo | What to do |
| --- | --- | --- | --- |
| **blocker** | Card payments (Safepay or similar) | Interface, verification flow, webhooks and tests are real; the provider is not implemented. The API **refuses to start in production** with `PAYMENT_PROVIDER=mock` | Implement `PaymentProvider` for the chosen gateway (one file in `apps/api/src/services/payments/`), test against its sandbox, set `PAYMENT_PROVIDER`, keys and webhook secret |
| **blocker** | SMS for phone sign-in (OTP) | Twilio adapter implemented | Create the account and a Pakistani-capable sender; set `SMS_PROVIDER=twilio` and the `TWILIO_*` keys. The API refuses `SMS_PROVIDER=mock` in production |
| **blocker** | Transactional email | Not wired: password reset codes are only returned in development | Pick a sender (Postmark, SES, Resend), implement the `TODO(email)` in `auth.service.ts`, and send `grabgo://forgot?token=…` links |
| | Push notifications | Expo push implemented | Set `EXPO_ACCESS_TOKEN`; upload the APNs key and FCM credentials to EAS |
| | Sign in with Apple / Google | Implemented | Register the bundle id with both; set `APPLE_CLIENT_ID`, `GOOGLE_CLIENT_ID*` |
| | Image hosting | Not built: cafés paste image URLs | Acceptable at launch; add uploads (`STORAGE_*` are reserved) when cafés ask |
| | Map tiles | OpenFreeMap (no key) | Fine to launch; review its fair-use terms against expected traffic |

## Secrets and configuration (API)

Generate every secret fresh for production:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

| Variable | Notes |
| --- | --- |
| `NODE_ENV=production` | Turns on the guards below |
| `DATABASE_URL` | Managed Postgres with daily backups and point-in-time recovery |
| `AUTH_SECRET`, `PICKUP_TOKEN_SECRET` | 32+ characters, different from each other |
| `POS_SECRET_KEY` | 32+ characters. Needed before any café connects a POS. Changing it later makes every café generate a new POS secret |
| `CORS_ORIGINS` | The two dashboard origins, comma-separated. `*` is refused in production |
| `TRUST_PROXY_HOPS` | Number of proxies in front of the API, so rate limits see real client IPs |
| `API_PUBLIC_URL`, `WEB_PUBLIC_URL` | Public URLs |
| `JOBS_ENABLED=true` | On exactly the instances that should run maintenance (safe on several; every job is idempotent) |
| `OTP_DEV_CODE` | **Must be unset**. The API refuses to start with it in production |

## Deploying

1. `npm ci && npm run build`
2. `npm run db:deploy` (applies committed migrations; never drops anything)
3. Start the API (`node apps/api/dist/index.js`); point the load balancer's
   liveness check at `/api/v1/health` and readiness at `/api/v1/ready`
4. Serve `apps/merchant-dashboard/dist` and `apps/admin-dashboard/dist` as
   static sites with a rewrite to `index.html`
5. Behind several API instances, add the Socket.IO Redis adapter so live order
   updates reach every café board

Not in the repo yet: a Dockerfile for the API, CI that runs `npm run verify`
and `npm run test:e2e` on every push, and error monitoring (Sentry or similar,
API and app). All three are small and worth having before launch.

## Data

- Create the admin account and remove the seed's demo accounts and cafés
  (`npm run db:seed` is for development only).
- Onboard real cafés: owner account, menu, opening hours, logo, then approve.
- `npm run db:import-osm` loads the grey "not on Grab & Go yet" cafés
  (OpenStreetMap, ODbL; credited in the app).

## Mobile app (App Store / Play Store)

- Set the production API URL (`EXPO_PUBLIC_API_URL` or `app.json` `extra`).
- `eas build --profile production`, then `eas submit`.
- Store listing: screenshots, description, support URL, and a **privacy policy
  and terms at `https://grabandgo.pk/privacy` and `/terms`** (the app links to
  them; the pages do not exist yet).
- App privacy answers: location (optional, for distance), contact info (email,
  phone), purchases, identifiers for push.
- Account deletion exists in the app (Profile → Account), as Apple requires.
- Test a **release** build on a real iPhone and a real Android phone before
  submitting; development builds hide performance problems and Android has not
  been exercised on a device.

## Operations

- Someone watches the admin dashboard during opening hours for the first weeks:
  stuck orders, failed POS deliveries, cafés that stop accepting.
- Cafés need a short onboarding: the order board, pickup codes, curbside
  plates, marking items sold out, pausing orders.
- Support contact for customers (refunds go through the admin dashboard and the
  payment provider).
