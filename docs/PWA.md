# PWA and mobile

How Stockly installs, what it caches, what it deliberately does not, and how it behaves offline.

---

## 1. Installability

| | |
|---|---|
| Manifest | [`app/manifest.ts`](../app/manifest.ts) — Next.js generates `/manifest.webmanifest` |
| Service worker | [`public/sw.js`](../public/sw.js), registered by [`features/pwa/components/service-worker.tsx`](../features/pwa/components/service-worker.tsx) |
| Icons | 192, 512, 512-maskable in `public/icons/`, plus `public/apple-touch-icon.png` |
| Display | `standalone`, `start_url: /dashboard`, `scope: /` |

### iOS and iPadOS

Safari ignores the manifest's icons and display mode entirely, so the iOS path is metadata in
[`app/layout.tsx`](../app/layout.tsx):

- `appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Stockly" }`
- `mobile-web-app-capable` for older iPadOS
- an explicit `apple-touch-icon` link — the manifest icons are not read
- `viewportFit: "cover"` so the app draws under the notch, with `env(safe-area-inset-*)` padding it back

Safari has **no install API**. iOS therefore gets the actual Share → Add to Home Screen steps, never
a button that would silently do nothing. `detectPlatform()` identifies iPadOS 13+, which reports
itself as a Mac, by its touch points.

### Android and desktop

Chromium fires `beforeinstallprompt`. The event is captured and held so the real install dialog can
open from a later user gesture. `appinstalled` hides the invitation permanently.

The invitation is shown **at most once a fortnight** (`localStorage`, key `stockly:install-dismissed`)
and never in an already-installed app.

---

## 2. Caching — and what is never cached

**The rule: nothing authenticated is ever written to a cache.** Every page in Stockly is
server-rendered per user, so a cached page is another user's portfolio waiting to be replayed.

| Request | Strategy | Why |
|---|---|---|
| `/_next/static/**`, icons, fonts | cache-first | content-hashed, immutable |
| navigations (HTML) | **network only**, offline page on failure | every page is user-specific |
| `/api/**`, `/auth/**` | **not intercepted at all** | authenticated, and mutations must never replay |
| other origins | not intercepted | the market-data provider is not ours to cache |
| non-GET | not intercepted | a cache cannot serve a POST, and must not try |

Quotes and history are cached — but on the **server**, by the Next Data Cache with a TTL
(see [ARCHITECTURE.md](ARCHITECTURE.md)), where the cache is keyed by request rather than by device
and no session is involved. Pushing that into a service worker would move shared data onto a device
that may have several users.

Verified in the browser: after a full load the caches contain only `/offline`, the manifest, the
icons, and `_next/static` chunks. `features/pwa/pwa.test.ts` asserts the source keeps it that way.

### Sign-out

Signing out clears the React Query cache, deletes every service-worker cache, and posts to
`/auth/signout`. Since nothing authenticated is cached this is belt-and-braces — but on a shared
device the cost of being wrong is someone else's portfolio, and the cost of being careful is three
lines.

---

## 3. Offline

```
navigation fails → cached /offline page
```

`/offline` is precached at install and is deliberately static and signed-out: it has to render with
no network and no session. It offers a Retry that re-navigates rather than a hard reload.

While offline, [`NetworkStatus`](../features/pwa/components/network-status.tsx) shows a banner
reading "Offline · showing the last data loaded", so cached UI is never mistaken for live prices.

`navigator.onLine` only reports whether a network interface exists, never whether the server is
reachable, so it is trusted when false and never used alone to claim a working connection.

### Reconnecting

One `queryClient.invalidateQueries()` and one `router.refresh()` — not a burst of requests to every
endpoint. Queries that are not mounted stay stale until something needs them, which is what a query
cache is for. There is no retry loop: TanStack Query is configured with `retry: 1`, and the market
data layer has its own timeout and error taxonomy.

### Offline mutations

**Not implemented, deliberately.** Queueing a buy while offline and replaying it later needs
idempotency keys and a conflict-resolution story; shipping the queue without them is how duplicate
transactions get into a portfolio. Phase 4 keeps writes online-only and says so.

---

## 4. Updates

The worker is registered as `/sw.js?v=<APP_VERSION>` from [`lib/version.ts`](../lib/version.ts). A
changed URL is a different worker to the browser, so a release installs one automatically — and the
version stays in one file, with no build step rewriting `sw.js`.

A waiting worker surfaces a "A new version of Stockly is available · Refresh" prompt. It is **never**
forced: reloading under someone half-way through a transaction form would discard their input. On
accept, the page posts `SKIP_WAITING`, the controller changes, and the page reloads exactly once.

`activate` deletes every cache bucket that is not the current version.

---

## 5. Mobile UX

- **Navigation.** Sidebar on `lg`, bottom tab bar below it (Dashboard, Portfolio, Transactions,
  Analytics), everything else in a hamburger sheet. Four tabs is what fits 390px before labels
  truncate.
- **Safe areas.** `.safe-top` / `.safe-bottom` use `env(safe-area-inset-*)`; the tab bar clears the
  iPhone home indicator and dialogs pad their footers.
- **Touch targets.** Every interactive element is ≥44px under `@media (pointer: coarse)` — the query
  that asks "is this a fingertip?", so an iPad at 768px gets real targets while a 1280px desktop
  stays dense. Verified with an automated audit at 390px and 768px: zero elements below 40px.
- **Dialogs are bottom sheets** on touch-sized screens: anchored to the thumb, full width, grab
  handle, safe-area footer. Centred dialogs from `sm` up.
- **Tables become cards** below `lg` (holdings, transactions, dividends, watchlist). No page scrolls
  horizontally at 390px, 768px or 1280px — asserted in the same audit.
- **Forms.** `inputMode="decimal"` for money, native `type="date"`, and 16px input text so Safari
  does not zoom the page when a field is focused. Pinch-zoom stays enabled; disabling it is an
  accessibility regression.

---

## 6. Performance

Charts are the heaviest dependency and are loaded with `next/dynamic`, `ssr: false`, behind a
skeleton — Recharts sits in its own ~330KB chunk that the login page never requests (verified by
loading `/login` in a real browser and listing every script). Price history is downsampled to roughly
one point per two pixels before it reaches the chart: a 390px screen cannot render 252 daily closes,
and every extra point is an SVG segment to lay out.

Measured on the production build, uncompressed: `/login` 1233KB of JS across 14 files, `/offline`
568KB. The bulk is react-dom, `@supabase/supabase-js` and Zod, all of which the login form genuinely
needs. Zod is the largest single lever if this needs to come down further.

---

## 7. Headers

Set in [`next.config.ts`](../next.config.ts):

| Path | Header | Why |
|---|---|---|
| `/sw.js` | `Cache-Control: no-store`, `Service-Worker-Allowed: /` | a cached worker cannot be replaced; the scope header lets it control the origin |
| `/manifest.webmanifest` | `max-age=3600` | changes rarely, but not never |
| `/icons/*` | `max-age=31536000, immutable` | content is fixed |
| `/api/*` | `Cache-Control: private, no-store` | no intermediary may hold a signed-in response |
| everything | `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy` | |

PWA requires HTTPS, which Vercel provides on every deployment.

---

## 8. Push notifications

The service worker's `push` and `notificationclick` handlers are part of the alert system; the rules
they follow live in [ALERTS.md](ALERTS.md). Two things belong here:

- **The payload is treated as untrusted.** `notificationclick` navigates only to a same-origin path
  (`href.startsWith("/")`), so a payload can never redirect a user off-site.
- **Tapping focuses an existing window** rather than opening a second copy — what an installed app
  should do. `clients.matchAll` first, `openWindow` only as a fallback.

On iOS, Safari delivers push **only to an installed app**. The settings UI says so rather than
offering a button that would do nothing.

## 9. Graceful degradation

Nothing here is required for the app to work. A browser with no service worker support, a blocked
registration, unavailable `localStorage`, or no `beforeinstallprompt` all lose a feature and nothing
else — every one of those paths is caught and logged rather than thrown.
