-- Phase 18: news and market context.
--
-- Two rules this migration is built around:
--
--   1. **News is context, never financial truth.** No user_id, no reference to transactions, and
--      no figure that a portfolio calculation reads. Ingesting a million articles cannot move a
--      holding — domain/news-invariants.test.ts asserts it.
--
--   2. **Metadata only.** Stockly stores a headline, a provider summary where one was supplied, a
--      link and the classification it derived. It does **not** store article bodies: they are
--      somebody else's copyrighted work, they would dominate the database, and the product need is
--      served by sending the reader to the source.
--
-- Shared reference data, like technical_snapshots, benchmarks, fx_rates_daily and
-- financial_statements: readable by any signed-in user, writable only by the scheduled job.
--
-- Forward-only and additive.

-- ---------------------------------------------------------------- articles

create table public.news_articles (
  /*
   * **The de-duplication key is the primary key**, which is what makes ingestion idempotent.
   *
   * Derived by `domain/news.ts:dedupeKeyFor` — the canonical URL where there is one, and the
   * source, normalized title and publication *day* where there is not. Never the title alone: the
   * same outlet's "Market wrap" every morning would collapse into a single row.
   */
  dedupe_key text primary key,

  title        text not null,
  -- The provider's own summary. Null when they supplied none — Stockly never generates one, which
  -- would be fabricating content and attributing it to a publication.
  summary      text,
  -- Verified https at the boundary; the constraint below is the second line of defence.
  url          text not null,
  source       text not null,

  -- Two different facts, and neither substitutes for the other.
  published_at timestamptz not null,
  fetched_at   timestamptz not null default now(),

  language     text,
  market       text,
  category     text not null default 'OTHER',
  /*
   * Tone, and the method that produced it.
   *
   * Stored together deliberately: a sentiment without its method is a claim with no provenance, and
   * `UNKNOWN`/`NONE` is the common and honest answer rather than a failure.
   */
  sentiment        text not null default 'UNKNOWN',
  sentiment_method text not null default 'NONE',

  provider   text not null,
  created_at timestamptz not null default now(),

  constraint news_articles_title_length check (length(title) between 3 and 400),
  constraint news_articles_summary_length check (summary is null or length(summary) <= 2000),
  -- Only https reaches a user's browser. A javascript: or data: URL in an href executes on click,
  -- and `isSafeArticleUrl` refuses it at the boundary — this refuses it at the table.
  constraint news_articles_url_https check (url like 'https://%'),
  constraint news_articles_url_length check (length(url) between 12 and 2000),
  constraint news_articles_source_length check (length(source) between 1 and 120),
  constraint news_articles_market_known check (market is null or market in ('US', 'SET')),
  constraint news_articles_category_known check (category in (
    'EARNINGS', 'DIVIDEND', 'CORPORATE', 'M_AND_A', 'MANAGEMENT', 'PRODUCT', 'REGULATION',
    'LEGAL', 'MACRO', 'MARKET', 'SECTOR', 'ANALYST', 'OTHER'
  )),
  constraint news_articles_sentiment_known check (
    sentiment in ('POSITIVE', 'NEUTRAL', 'NEGATIVE', 'MIXED', 'UNKNOWN')
  ),
  constraint news_articles_sentiment_method_known check (
    sentiment_method in ('RULE_BASED', 'PROVIDER', 'NONE')
  ),
  -- A sentiment must carry a method and vice versa: a tone with no provenance is a claim nobody
  -- can check, and a method with no tone is meaningless.
  constraint news_articles_sentiment_agrees check (
    (sentiment = 'UNKNOWN') = (sentiment_method = 'NONE')
  ),
  -- An article dated in the future is a provider bug or a timezone error, and it would sort above
  -- everything real forever. Six hours of tolerance for clock skew, then refused.
  constraint news_articles_not_future check (published_at <= now() + interval '6 hours')
);

-- The feed: newest first, optionally narrowed by market or category.
create index news_articles_recent_idx on public.news_articles (published_at desc);
create index news_articles_market_idx on public.news_articles (market, published_at desc);
create index news_articles_category_idx on public.news_articles (category, published_at desc);

-- ---------------------------------------------------------------- article ↔ instrument
--
-- A join table rather than an array column, because the query that matters is "every article about
-- any of these forty symbols, newest first" — a portfolio feed — and that is an index range scan
-- here and a sequential scan over an array.

create table public.news_article_symbols (
  dedupe_key text not null references public.news_articles (dedupe_key) on delete cascade,
  symbol     text not null,
  market     text not null,

  primary key (dedupe_key, market, symbol),

  constraint news_article_symbols_symbol_length check (length(symbol) between 1 and 20),
  constraint news_article_symbols_market_known check (market in ('US', 'SET'))
);

-- The portfolio and watchlist feeds: given a set of instruments, the most recent articles.
create index news_article_symbols_lookup_idx on public.news_article_symbols (market, symbol);

-- ---------------------------------------------------------------- row level security
--
-- Readable by any signed-in user; written only by the scheduled job, which holds the service-role
-- key. No insert, update or delete policy exists, and RLS denies what it does not permit.
--
-- Note what is NOT granted: **nothing to `anon`**. A public portfolio page shows no news, because
-- which articles a page displays is derived from what its owner holds — and that would leak the
-- holdings the sharing settings exist to control.

alter table public.news_articles        enable row level security;
alter table public.news_article_symbols enable row level security;

create policy "news is readable by signed-in users" on public.news_articles
  for select using ((select auth.uid()) is not null);

create policy "news symbols are readable by signed-in users" on public.news_article_symbols
  for select using ((select auth.uid()) is not null);

comment on table public.news_articles is
  'Article metadata only — headline, provider summary, link and derived classification. Article '
  'bodies are never stored: they are somebody else''s copyrighted work and the reader is sent to '
  'the source.';
comment on column public.news_articles.dedupe_key is
  'Primary key and idempotency guarantee. Canonical URL where there is one; source, normalized '
  'title and publication day where there is not. Never the title alone.';

-- ---------------------------------------------------------------- notification category
--
-- Extends the existing notification system rather than paralleling it: one preferences table, one
-- badge, one notification centre. A user who wants no news notifications turns off one switch in
-- the place every other switch already lives.
--
-- Default **false**, unlike the other categories. Price and portfolio notifications are things a
-- user asked for by creating an alert; news is a firehose by comparison, and opting in is the
-- correct direction for something nobody requested.

alter type public.notification_category add value if not exists 'news';

alter table public.notification_preferences
  add column news boolean not null default false;

comment on column public.notification_preferences.news is
  'Off by default. Price and portfolio alerts are things a user created; news is not, so it is '
  'opt-in rather than opt-out.';
