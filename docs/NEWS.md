# News & Market Context (Phase 18)

Context around what somebody holds — never a reason to trade it.

---

## 1. The rule that shapes the phase

> **News is context. It is never financial truth, and it never becomes one.**

An article contains numbers — a revenue figure, a dividend amount, a price move — and every one of
them is a sentence somebody else wrote. None reaches a calculation. `domain/news.ts` has no way to
receive a portfolio, and `domain/news-invariants.test.ts` ingests a thousand articles and asserts
holdings, cost basis, P&L and cash come back byte-identical.

The second rule is sharper than anything in earlier phases:

> **Nothing is fabricated — and a fabricated headline is worse than a fabricated number.**

A wrong number is wrong. A headline attributed to a real publication that the publication never
wrote is a false statement about a named organisation. That distinction decides the provider
defaults below.

---

## 2. Provider: default `none`, and why the mock is fictional

`NEWS_PROVIDER` defaults to **`none`**. The default provider declares zero capabilities and returns
nothing, and every news surface reads `capabilities` so it can say *"this deployment has no news
provider"* rather than showing an empty feed that reads as a quiet news day.

Stockly's configured market-data vendor supplies no news feed, so there is no adapter for it. The
two alternatives were rejected:

- **An adapter returning `[]`** makes "no provider" indistinguishable from "nothing happened".
- **A mock in production** would attribute invented headlines to real publications.

`NEWS_PROVIDER=mock` exists for development and is deliberately, visibly synthetic: its sources are
`Stockly Mock Wire`, `Example Financial Times` and `Sample Market Daily`, and every URL is on
`news.example.test` — a domain reserved for testing that resolves nowhere. Even the mock cannot name
a real outlet or link to a real page.

**A provider returns raw articles; it never classifies them.** Category, tone, dedupe key and
relevance are all derived by the domain, so two providers cannot disagree about what an article is
and none can smuggle in a sentiment Stockly did not compute.

---

## 3. What is stored

**Metadata only.** A headline, the provider's summary where one was supplied, a link, and the
classification Stockly derived. Article bodies are never stored: they are somebody else's
copyrighted work, they would dominate the database, and the reader is better served by being sent to
the source.

Two tables, neither with a `user_id`, neither referencing `transactions`:

| Table | Holds |
|---|---|
| `news_articles` | one row per article, keyed by its dedupe key |
| `news_article_symbols` | which instruments an article is about |

A join table rather than an array column because the query that matters — "articles about any of
these forty symbols, newest first" — is an index range scan here and a sequential scan over an array.

**Retention: 90 days.** A feed nobody reads past a quarter is not worth an unbounded table.

---

## 4. De-duplication

The dedupe key **is** the primary key, which makes ingestion idempotent by construction: running the
job three times produces the same table as running it once.

```
canonical URL          →  url:https://a.test/x
no canonicalisable URL →  title:<source>:<normalized title>:<publication day>
```

**Canonical URL first**, because it is the strongest identity an article has: two providers
syndicating one story point at the same page. Tracking parameters are stripped, host case and a
trailing slash normalised.

**Never the title alone.** The same outlet's "Market wrap" every morning would collapse into one
row. The fallback includes the source and the publication *day* — the day rather than the timestamp,
because providers disagree about publication minutes for the same article and an hour of drift must
not create a second row.

When duplicates collapse, the **earliest** publication wins: a syndicated copy published hours later
is the same news, and dating it later would push a story that broke this morning below one that
broke since.

---

## 5. Presentability

An article is shown only if it has a real title, a **named source**, a **safe https URL** and a
publication date that is not in the future. Anything else is **dropped, not repaired** — there is
nothing to repair it from, and a story with no attributable origin is a rumour.

A future date is refused because it is a provider bug or a timezone error, and an article dated
tomorrow sorts above everything real forever. Six hours of tolerance for clock skew, then refused —
in the domain and again by a check constraint.

---

## 6. URL safety

`isSafeArticleUrl` lives in the domain because a provider response is untrusted input and its URL
reaches an `<a href>`.

- **https only** — an allowlist, so a scheme nobody thought of is refused rather than permitted.
  `javascript:`, `data:` and `vbscript:` all execute on click; plain `http` is a downgrade a news
  link is not worth.
- **A real host**, so a relative URL cannot become a same-origin navigation that looks like Stockly.
- **No credentials in the URL** — `https://apple.com@evil.test` is a phishing shape.
- **Bounded** at 2,000 characters.

Links open with `target="_blank"` and `rel="noopener noreferrer"`, with an icon and screen-reader
text saying so. **Stockly never proxies or redirects through its own origin**, so there is no
open-redirect surface: the href is the provider's URL or the article is not shown. Provider text is
rendered as React children — no `dangerouslySetInnerHTML` anywhere in the feature.

---

## 7. Freshness

`publishedAt` and `fetchedAt` are different facts and neither substitutes for the other. Age is
always computed from **`publishedAt`**: a story published yesterday and fetched a minute ago is a day
old, and labelling it fresh because of the fetch would be the most misleading thing this layer could
do.

`BREAKING` under an hour · `RECENT` under two days · `OLDER` beyond.

---

## 8. Classification

**Category** — keyword rules, ordered, first match wins, `OTHER` when nothing matches. Deterministic
because a category a user cannot predict is one they cannot filter by. `M_AND_A` is tested before
`CORPORATE` since an acquisition is a corporate action and the specific label is the useful one.

**Tone** — and it is *tone*, never direction.

- `UNKNOWN` is the default and the common answer. A headline needs **two or more** signals one way
  and none the other before a tone is claimed; most news is genuinely unclassifiable from a
  headline, and saying so beats a coin flip presented as analysis.
- The vocabulary is about *what happened*, never *what to do*: no rule looks for "buy", "sell",
  "outperform" or a price target, because those are somebody's recommendation, not the article's
  tone. "Analyst says buy this stock" classifies as `UNKNOWN`.
- Every label reads "… tone", the method (`RULE_BASED` / `PROVIDER` / `NONE`) travels with it, and a
  database constraint forces the two to agree — a tone with no provenance is a claim nobody can
  check.
- `Positive → Buy` is forbidden outright, and the disclaimer under every feed says tone "describes
  how an article is written, not what a price will do".

---

## 9. Relevance

Deterministic and inspectable, because a ranking a reader cannot reason about is one they cannot
trust. Every term is a named weight and the score is a sum — no model, no opaque blend:

| Term | Weight |
|---|---|
| Names an instrument they hold | 100 |
| Names one they watch | 60 |
| Matches an upcoming corporate event | 30 |
| Concerns a market they are invested in | 10 |
| Recency | up to 20, decaying over a week |

**Recency is capped below ownership on purpose**: a week-old story about a holding still ranks above
a headline from ten minutes ago about a company the reader has never heard of. Sorting is total and
stable, so an unchanged feed never reorders itself.

---

## 10. Corporate events

Phase 17 owns events; this only relates an article to one, with a stated confidence:

- **HIGH** — same symbol, matching category, within seven days.
- **MEDIUM** — same symbol and category, up to four weeks out.
- Beyond that, **no link at all**. An article a month from an event is not about it, and a
  relationship that cannot be defended is not shown.

**The event remains the source of truth.** A linked article never changes an event's date, type or
existence.

---

## 11. Privacy — the subtle one

News is public. **Which news a reader is shown is not.**

The feed is ranked by what somebody holds and watches, so *the feed itself is a description of the
portfolio*. A shared page carrying "your" news would leak the holdings phase 13's switches exist to
control — more subtly than a holdings list, because nobody reads a news feed as a disclosure.

So: `news_articles` grants **nothing to the anonymous role**, `ShareSource` declares no news field,
and `features/news/privacy.test.ts` proves both by projection and by reading the source. The API
response says *why* an article is in the feed — `HELD`, `WATCHED` or `MARKET` — and nothing about
the size of the position behind it.

Notifications carry the same rule: *"New NVDA news is available (earnings)"* is safe on a lock
screen; a position's value is not.

---

## 12. Automation

News rides on `/api/cron/data`, after quotes and fundamentals and unable to fail either. A fourth
endpoint would be a fourth schedule for something that runs on the same daily cadence and, unlike a
quote, has no moment it must be taken at.

- **Idempotent** — the dedupe key is the primary key.
- **Bounded** — 30 instruments per run, drawn from what users hold and watch.
- **Shared** — one fetch of NVDA's coverage serves everybody holding it, which is why the tables
  have no `user_id`.
- **Observable** — fetched, deduplicated, rejected, written, deleted and failed, all counters.

---

## 13. Notifications

The existing category enum gained `news` rather than a parallel system: one preferences table, one
badge, one notification centre.

**It defaults to off**, unlike every other category. Price and portfolio notifications are
consequences of something the user created — an alert they set, a dividend they recorded. News is a
firehose nobody asked for, and opt-in is the right direction for it.

---

## 14. What is deliberately not built

- **No comments, likes, follows or discussion.** Phase 18 is context, not a social network.
- **No AI summarisation.** `AI_ENABLED` stays false. Summarising an article Stockly does not hold
  the text of would be generating content and attributing it to a publication.
- **No summary generated from a headline.** When a provider supplies none, the headline stands alone.
- **No article bodies, and no scraping.** "Read the full article at the source" is the whole answer.
- **No sentiment on a price.** Tone describes prose. Nothing here says where anything is going.
- **No news in a public shared page**, by construction rather than by a switch left off.
