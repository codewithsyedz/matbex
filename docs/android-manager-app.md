# Matbex Manager — Capacitor Android build

The management app reuses the same web bundle as the POS build; it simply
boots into the mobile management dashboard at `/manager` instead of the POS
screen.

## What's in the app

`/manager` (mobile-first, no sidebar) with a branch selector that drives
everything on screen:

- **Overview** — today's net profit vs yesterday, sales, prime cost, range
  revenue / avg ticket / orders, and a daily revenue trend chart.
- **Branches** — per-branch revenue, share of total, expenses, prime cost %,
  cash variance, unpaid / cash / card split, ranked by revenue.
- **Trends** — revenue by hour, by weekday, weekly trend line, top sellers and
  orders by daypart.
- Range switcher: 7 / 30 / 90 days. Pull-to-refresh equivalent: the refresh
  button in the header invalidates all cached queries.

## Build the APK

```bash
npm run build
npx cap sync android
cd android && ./gradlew assembleRelease
```

To ship a dedicated "Matbex Manager" app alongside the POS APK, copy
`capacitor.config.ts` to `capacitor.manager.config.ts` and override:

```ts
appId: "net.matbex.manager",
appName: "Matbex Manager",
```

then build with `npx cap sync android --config capacitor.manager.config.ts`.
Managers sign in with their normal Matbex account — no device pairing or
kiosk lock is used for the management build.
