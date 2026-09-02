# Sharing & Snapshots (Phase 13)

How a portfolio becomes a page somebody else can open, what stops it becoming more than that, and
why a shared page is a *publication* rather than a live feed.

The rule the whole feature is arranged around:

> **Sharing is a projection, not a portfolio.** An anonymous visitor never reads a portfolio. They
> read a document the owner's own session produced, containing only what their settings allowed.

---

## 1. The shape of it

```
transactions ──► engine ──► analytics ──► intelligence bundle
                                                │
                                    toShareSource()      ← selection, no arithmetic
                                                │
                                    projectPublicPortfolio(source, config)   ← the privacy boundary
                                                │
                                    published_shares.payload (jsonb)
                                                │
              ┌─────────────────────────────────┼─────────────────────────────────┐
        /p/<slug>                        /share/<token>                    /snapshot/<token>
   anonymous RLS select              security definer fn                security definer fn
   (visibility = 'PUBLIC')          (token, not expired,               (token; frozen copy)
                                      not revoked)
```

### Why the projection is stored rather than computed per request

Stockly's authorization boundary is RLS, and the service-role key is deliberately unreachable from
a request — a rule from phase 5 that has held ever since. Rendering a *live* public page would mean
running the engine as somebody who is not the owner, which needs exactly that privileged read.

So the owner publishes instead. The consequences are all good ones:

- The anonymous role's entire grant is `select` on `published_shares` where `visibility = 'PUBLIC'`,
  plus two token functions. **There is no path from an anonymous request to a transaction**, and a
  bug in the projector leaks at most what the owner asked to publish.
- A public page costs one indexed row read. No engine pass, no quote call, no FX call — which is
  what makes a link posted to Reddit survivable.
- Nothing has to be cached to make it cheap, so revocation is never waiting on a cache.

The cost, stated plainly: **a shared page is as fresh as the last publish, and it says so.** Every
shared page prints "Published \<time\>" and the owner has an "Update published figures" button.
Calling a document that is minutes old "live" would be a small dishonesty in an application that
spends its comments avoiding those.

*(If a live public view is ever wanted, the insertion point is `readPublicShare` — the projector and
the page stay as they are, and only the source of the document changes. It would need a scoped
privileged read, and that is the trade to weigh at the time.)*

---

## 2. Visibility

| | Who can reach it | Indexed |
|---|---|---|
| `PRIVATE` | only the owner | never |
| `LINK_ONLY` | anyone holding a valid token | never |
| `PUBLIC` | anyone at `/p/<slug>` | only if the owner also allowed it |

An enum rather than `is_public boolean`, because these are three answers to "who can reach this" and
a boolean cannot hold the third without a second boolean beside it that can contradict the first.

**A portfolio with no `portfolio_shares` row is private.** The default is the absence of the
feature, not a row full of falses that somebody has to remember to write correctly.

---

## 3. What can be shared

Nine sections and five figure switches, every one defaulting to **false**:

**Sections** — overview · holdings · allocation · performance · benchmark · risk · dividends ·
observations · goal progress.

**Figures** — amounts · quantities · unrealised P&L · realised P&L · cash.

The split is the point. "Show my holdings" and "show what they are worth" are different decisions,
and a UI that bundles them shares an account balance because somebody wanted to show a stock list.
The three holdings modes people ask for fall out of the combination rather than needing a fourth
enum: holdings off is *hidden*, on with quantities and amounts off is *allocation only*, on with
both is *full*.

### What has no switch at all

Transactions, the investment journal, theses, sell reviews, goal notes, saved simulations, imports,
cash movements, alerts, the account's email address, and every internal id. `ShareSource` — the
only thing the projector is given — has nowhere to put any of them. A field cannot be leaked by a
projector that was never handed it.

A goal is shared as its **type** and its progress. Its note is the owner's own words about their
money, which is the same category of content as a journal entry.

### Withheld is not the same as unknown

- **Absent key** — the owner did not share this.
- **`null`** — Stockly could not compute it honestly, and the page renders `N/A`.

A holding no exchange rate reached keeps `weightPct: null` all the way onto the public page. Never
`0`, which would be a lie about a position that exists.

---

## 4. Presets

`Private` · `Performance` · `Portfolio overview` · `Everything shareable`.

A preset is a starting point the owner then edits, never a mode the page runs in. Two things no
preset does, including the one called "everything": turn on **realised P&L**, **cash** or **search
indexing**. Booked profit and a bank balance are the two figures a reader can least justify needing,
and a preset called "everything" is exactly where an unnoticed default does its damage.

---

## 5. Share links

A link is a **capability**: holding the token is the entire authorization.

- **32 bytes from the OS CSPRNG**, base64url. Not a uuid — v4 carries 122 bits and v7 encodes the
  time it was made. Not a portfolio id, not a timestamp, nothing derived from the owner.
- **Only the SHA-256 is stored.** A database dump discloses no working link. The raw token exists in
  the response that created it and in the URL the owner then holds — it is never logged, never in an
  audit row, and cannot be shown again. Losing it means revoking and issuing another, which is the
  honest consequence of storing a hash.
- A plain hash rather than bcrypt, deliberately: a KDF makes *guessable* secrets expensive to
  attack, and a 256-bit random token has no guessable structure. Stretching it would protect nothing
  and add a cost to every view of every shared page.
- Expiry: 1 day · 7 days · 30 days · never. Default **30 days**, so the lazy choice is a bounded one.
- Revocation sets `revoked_at`. `share_by_token` checks it in the same statement that reads the row,
  and link pages are `revalidate = 0` — a revoked link that keeps working until a cache expires has
  not been revoked.

### Why a `security definer` function

An anonymous caller must be able to *present* a token without being able to *read* the link table —
otherwise "guess a 256-bit token" becomes "read a column". The function bypasses RLS, checks the
hash, the expiry and the revocation together, and returns only the published payload. Its
`search_path` is pinned; a definer function resolving unqualified names through a caller-controlled
path is the classic escalation shape.

It also increments the link's access counter. That counter and a last-seen timestamp are the whole
of Stockly's viewer analytics — **no address, no user agent, no referrer, no geography**. "Who
looked at my portfolio" is a question this application chooses not to be able to answer.

---

## 6. Snapshots

A snapshot freezes a projection at its own token address.

- **Immutable.** `share_snapshots` has no update policy, so RLS denies what it does not permit.
  There is no route to editing a figure after the fact.
- **Versioned** (`SNAPSHOT_VERSION`), so an old snapshot stays readable when the document's shape
  changes.
- **Not a source of truth.** It is a rendering held still. If transactions change, the live portfolio
  changes and the snapshot does not — which is what makes it worth taking.
- **Labelled as one.** The page shows `Snapshot · <date>` and says it does not update. Nothing on a
  snapshot may look like a current figure.
- Reachable whether or not the portfolio is shared at all: a snapshot is a thing the owner posted,
  not a window onto a live portfolio.
- Deleting one removes a page. It never touches a transaction, a holding or a P&L figure.

> **Naming note.** `portfolio_snapshots` already existed — it is phase 3's daily value series, an
> input to the performance chart. The phase 13 table is `share_snapshots`. They are unrelated, and
> conflating them would put a rendered artefact into a calculation input.

---

## 7. The preview is the page

The owner's sharing screen renders `PublicPortfolioView` from a real `projectPublicPortfolio` call —
the same component and the same projection the public route uses. A preview drawn by separate code
is a preview that can be wrong about what a stranger sees, and being wrong about that is the one bug
this feature must not have.

It previews the **saved** settings, not the unsaved form, because what a visitor can see is what has
been published. When the two differ the panel says so.

---

## 8. Security

| Concern | What answers it |
|---|---|
| IDOR on settings | RLS + composite FK to `(portfolio_id, user_id)`. `user_id` always from the session, never the body. |
| IDOR on a link or snapshot | Update and delete are scoped by RLS; a row that is not the caller's returns no rows and becomes a **404**. |
| Enumeration | A private portfolio, a revoked link, an expired link, a deleted snapshot and an address that never existed all return the same `null` and the same sentence. |
| Token guessing | 256 bits, CSPRNG, hashed at rest. |
| Private fields in a response | `domain/sharing-leak.test.ts` walks the real document across every settings combination, by key *and* by value. |
| Crawlers on a capability | `/share/` and `/snapshot/` disallowed in robots.txt **and** `noindex, nofollow` on the pages. |
| Crawlers on a private page | Indexing is opt-in twice: PUBLIC *and* `allow_search_indexing`. A check constraint makes the other combination unstorable. |
| Private data in a public cache | The service worker never caches a navigation or `/api/**`; token pages are `revalidate = 0`; the CDN sees only what is already public. |
| Stale privacy after a change | Saving republishes in the same request, and a failed rebuild **deletes** the published row rather than leaving a stale one. |
| Logs | Counters and a visibility. No token, no slug traffic, no figure. |

### Rate limits

Config save 20/min · publish 10/min · link 20/min · snapshot 10/min. Publishing and snapshotting
each run a full analytics pass and a batched quote call, so those two are the money brake. Public
page reads cost one indexed row and no upstream call.

---

## 9. Multi-market and multi-currency

Phase 9's semantics survive the projection unchanged. Every figure is in the portfolio's base
currency, holdings carry their own market and currency, an untranslated holding is `null` rather
than `0`, and the page reports how many were excluded from a total. The benchmark's
`differencePct` stays `null` across a currency mismatch, because translating it would need
historical FX that Stockly does not store.

The performance series is the **flow-adjusted return index rebased to 100** — the shape of the
performance with none of the portfolio's size, so a shared chart cannot be read backwards into an
account balance.

---

## 10. Deliberately not built

- **Static Open Graph metadata only.** Dynamic OG image generation adds a rendering runtime, a cache
  and a new way to leak a figure into an image nobody re-checks. Title, description and canonical
  URL are built from what the owner published, and nothing else.
- **No public directory, no profiles, no search.** A listing of everyone's portfolios is a different
  product with a different consent question.
- **No likes, comments, followers, messaging or feeds.** Phase 13 is sharing, not a social network.
- **No shared transactions.** Not even behind a switch. The history of what someone bought and when
  is the most sensitive thing in the application.
- **No shared journal, thesis or simulation.** Same reason.
- **No viewer identity of any kind.** A counter and a timestamp, and that is all.
