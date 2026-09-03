# Personalization (Phase 15)

How a user shapes Stockly around themselves, and the boundary that keeps that from ever shaping a
number.

The rule everything below obeys:

> **A preference decides what is displayed. It can never decide what is calculated.**

Delete every preference, tag and saved view in the database and every holding, cost basis and P&L
figure is byte-identical. `domain/personalization-boundary.test.ts` asserts exactly that, and reads
`domain/personalization.ts` to keep it free of anything that could reach a database or a network.
It is the same boundary phase 10 drew for journals and phase 13 drew for sharing, re-proved here
because personalization is the layer most likely to be tempted across it: a "favourite metric" is
one refactor away from being a stored figure, and a "saved view" is one refactor away from being a
filtered portfolio somebody trusts.

---

## 1. Data model

Four tables, not eight.

| Table | Holds | Why it is its own table |
|---|---|---|
| `user_preferences` | theme, density, default portfolio, and **five jsonb documents** — favourite metrics, dashboard layout, dismissed insights, pins, recents | One row per user, read together and written together |
| `tags` | a user's own labels | Queried and joined |
| `holding_tags` | a tag applied to `(portfolio, market, symbol)` | Queried and joined |
| `saved_views` | a filter, a sort, columns, a grouping | Queried and listed |

The obvious design is a table per concept: `DashboardLayout`, `PinnedItem`, `RecentItem`,
`InsightPreference`, `FavoriteMetric`. Every one of those is small, user-scoped, read together,
written together, has no relationships and is never queried by its contents — so five tables would
be five sets of RLS policies and five round trips to render one page. They are columns on one row
instead, each size-capped by a check constraint so a preference row can never become a payload.

`saved_views` and the tag tables *are* queried and joined, so they are tables.

### Two decisions worth knowing

**`dashboard_layout = []` means the default layout, not an empty dashboard.** A new user has no row
at all; a user who presses Reset gets `[]`. Storing a *copy* of the default would freeze them at
whatever the default happened to be that day, and a later release that adds a widget would never
reach them.

**A tag is keyed by `(portfolio_id, market, symbol)`, never by a holding id.** A holding is not a
row — it is derived by replaying transactions. Giving one an id in order to tag it would be the
first step towards a second source of truth. A tag on a position since sold simply stops appearing;
nothing breaks and nothing is deleted.

---

## 2. Ownership

Every table carries `user_id`, has RLS enabled and four explicit policies. `holding_tags` also
carries the composite foreign key to `(portfolio_id, user_id)`, so a request naming somebody else's
portfolio cannot produce a row whatever the handler does.

None of the query functions takes a user id — there is nothing to pass and nothing to forget,
because RLS scopes the read. A resource that is not the caller's matches no row, so an update or
delete affects nothing and the endpoint returns **404, not 403**: confirming that an id exists is
information a prober did not have.

No request body accepts a `userId`. `features/personalization/schema.test.ts` asserts it for every
schema.

---

## 3. Dashboard widgets

`WIDGET_REGISTRY` names fourteen widgets. Every one is **a section that already existed** on the
dashboard, given an id so it can be ordered and hidden — the phase added arrangement, not figures.

```
loadIntelligence()  ← one pass, one batched quote call
        │
        ├── summary        ├── allocation     ├── goals
        ├── quickActions   ├── alerts         ├── insights
        └── …                                 └── transactions
```

**Ten widgets do not cost ten requests.** Every widget renders from the same single analytics pass
the dashboard always made; the layout decides what appears and in what order, never how many times
the engine runs. Hiding a widget saves rendering, not a query. The only extra cost personalization
adds to the page is one preference row, read in parallel with everything else.

`resolveLayout` reconciles a stored layout against the registry on every read. Three things can be
wrong with a stored layout and all three are normal rather than exceptional:

- a widget was **added** since it was saved → appended, in its default visibility, never switched on
  at the top where it would displace what the user arranged;
- a widget was **removed** → dropped, rather than rendered as a blank card;
- a required widget was stored as hidden → forced visible.

The same function is applied on the way *in*, in the PATCH handler: the client posts what it
rendered, the server stores what the registry says that means. Storing the raw claim would leave
every later read to repair it.

### Reordering is buttons, not drag-and-drop

`moveWidget(layout, id, "up" | "down")` is the whole mechanism. That is the accessible option rather
than a fallback: "move up" works with a keyboard, with a screen reader and with a thumb, and every
control is a real `<button>` with an `aria-label`. A drag gesture would be an enhancement that has
to be duplicated for all three anyway, so it is not built.

---

## 4. Metrics

`METRIC_REGISTRY` has thirteen entries, each **pointing at a figure the analytics engine already
produces**. Nothing is computed there, and adding one means finding the existing field rather than
writing a formula. `MetricTiles` looks values up; the one exception is the cash ratio, which is the
only tile the bundle does not already carry, and it is `null` for an empty portfolio rather than 0%.

The names are unambiguous on purpose. There is no "Profit", no bare "Return" and no bare "Yield" —
each of those is two different numbers in a portfolio tracker, and a tile that does not say which
one it means is worse than no tile. "Yield on cost" and "Yield on current value" are separate
entries with separate definitions, and the definition is shown beside the choice so nobody has to
guess which one they picked.

A metric that cannot be computed honestly renders **N/A**, never 0.

---

## 5. Saved views

A view is **a filter, a sort, a set of columns and a grouping**, saved under a name. It stores no
figure, so it cannot go stale and cannot disagree with the table it configures — everything it shows
is recomputed by the engine on each render.

A filter is a closed triple — `{ field, operator, value }` — with every part an enum. Never an
expression, never a string the server interprets, exactly as the screener's filters are not. Adding
a filter means adding a member to the enum and a case to `matchesViewFilter`. The value may be a
string or a number and nothing else: a value that could be a structure is a value that could be a
query.

Two behaviours worth stating:

- **A null excludes a row from every numeric comparison, in both directions.** A holding no exchange
  rate reached has an *unknown* weight, not a small one, so it appears in neither `weight > 10` nor
  `weight < 10`. Nulls also sort last in both directions, for the same reason.
- **`Ungrouped` always exists and always comes last.** A position with no tag, or an instrument the
  provider returned no sector for, lands there. A sector is never inferred from a symbol.

Grouping by tag puts a position under **every** tag it carries, which is what a tag means.

---

## 6. Insight dismissal

Insights were already deterministic before this phase — `domain/insights.ts`, every threshold in
`INSIGHT_THRESHOLDS`, every sentence checked against `FORBIDDEN_INSIGHT_PATTERNS` by a test. Phase
15 added only the ability to stop seeing one.

Dismissal stores the **rule code**, not the rendered sentence: dismissing "your largest position is
24.5%" must not bring the same observation back tomorrow at 24.6%.

`UNDISMISSABLE_INSIGHTS` cannot be hidden — stale prices, a missing exchange rate, an untranslated
holding. Those describe a state of the *data* rather than of the portfolio, and hiding one means
hiding the reason a figure on the same screen is wrong. A user may dismiss an observation about
their concentration; they may not dismiss the notice explaining why a total excludes a holding.

Dismissal is a filter applied to a list the rules already produced. The engine runs identically for
a user who has dismissed everything.

---

## 7. Privacy

Personalization is private, and stays private when a portfolio is shared.

The risk is specific and easy to create by accident: somebody adds tags to the holdings table, the
share projection reads the same shape, and a stranger reading a public page learns that a position
is labelled "Retirement" or "Speculative" — a sentence about the owner's intentions they never chose
to publish.

The structural defence is that **`ShareSource` has nowhere to put any of it**, and
`features/personalization/privacy.test.ts` proves it three ways: it feeds a contaminated source
through the projector under every preset and searches the output for planted markers; it reads
`domain/sharing.ts` and asserts `ShareSource` declares no personalization field; and it asserts
neither the share projection nor its source builder imports this layer at all.

Nothing personal is cached across users. `loadPreferences` uses React's per-render `cache()`, which
is scoped to one request — not a module-level `Map`, which on a serverless instance would be shared
between whoever it happened to serve. The service worker never touches `/api/**`, so no preference
response can land in a device cache.

### Recently viewed

The one feature here that records behaviour, so its bounds are deliberate: **eight entries**, a
reference and a label and nothing else, readable only by its owner, absent from every shared page.
It is a way back to what you were just looking at, and deliberately too short to reconstruct what
somebody has been researching. Recording it fails silently — a convenience is not worth a toast.

---

## 8. Mobile and PWA

- Reordering, hiding and tagging are all buttons and checkboxes, so they work with a thumb, a
  keyboard and a screen reader without a second implementation.
- Quick actions are **links in a scrolling row, not a floating button**. A FAB covers content and,
  on a phone, sits exactly where the bottom tab bar already is.
- Every touch target keys off `pointer-coarse:`, not a width breakpoint — a tablet is a touch
  device and a small desktop window is not.
- The holdings table keeps its existing split: cards below `lg`, the full table above.
- Preferences live on the **server**, so they follow a user to a new device and survive a
  reinstall. Theme also goes through next-themes, which owns the DOM class and the no-flash script;
  the preference row is what makes the choice outlive that browser's local storage.
- Nothing here changes what happens offline. Personalization is a layout, and a layout rendered
  from a cached page still says exactly what the freshness indicators on it said.

---

## 9. Deliberately not built

Three items in the phase brief were judged as duplicating something, or as belonging to a different
layer. They are recorded here rather than silently skipped.

- **Portfolio notes.** The investment journal (phase 10) already stores a user's reasoning about a
  portfolio, with types, dates and a search. A second free-text area beside it would be two places
  to look for the same thought.
- **Display-currency override.** A portfolio already has a base currency, and every figure is
  presented in it with a rate, a timestamp and an N/A when unavailable. A *user-level* override
  would translate an already-translated figure — a second rate applied to a number that has already
  crossed one — with no honest way to describe the compounded staleness. The per-portfolio setting
  is more precise than a per-user one and already does the job.
- **Portfolio comparison and the portfolio timeline.** Both are analytics features rather than
  personalization, and neither appears in the phase's own definition of done. They are worth
  building; they are not this phase.
