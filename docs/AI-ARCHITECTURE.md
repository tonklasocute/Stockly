# Stockly AI — architecture

How the research assistant is built, and why each boundary is where it is. Product behaviour is in
[AI.md](AI.md); the threat model is in [AI-SECURITY.md](AI-SECURITY.md).

---

## 1. The path a question takes

```
Browser (client component)
   ↓  POST /api/ai/chat
Route handler                    auth · Zod · per-minute rate limit
   ↓
AIResearchService                the orchestrator
   ├─ assertWithinDailyQuota     database-counted spending cap
   ├─ resolveKnownSymbols        the supported universe
   ├─ detectIntent               pure, rule-based, no model call
   ├─ extractSymbols             validated against the universe
   ├─ buildContext ─────────────→ market data · technical snapshots · portfolio · watchlist · screener
   ├─ render                     facts → a compact text block
   ├─ getAIProvider()            the only place a vendor is named
   │     ↓
   │  AIProvider.generateStructured   JSON in the reply, Zod on the way out, one repair round
   ├─ findAdviceLanguage         the safety vocabulary, checked not trusted
   ├─ recordUsage                tokens, cost, latency, status
   ↓
{ narrative, grounded, completeness, dataAsOf, delayed }
   ↓
Browser renders data and interpretation as two separate sections
```

**The model has no tools.** It cannot query, fetch or execute anything. Retrieval happens before it
is involved and is finished by the time it sees a token, so a question cannot talk it into reaching
data it was not given — there is nothing to reach with.

## 2. Layers

| Layer | File | Rule |
|---|---|---|
| pure | `domain/ai.ts` | intent, symbols, safety vocabulary, coverage, history summary. No imports beyond its own types. |
| provider | `services/ai/*` | `AIProvider` and its adapters. Knows nothing about portfolios. |
| retrieval | `features/ai/context.ts` | reads the existing services. Never recomputes anything. |
| rendering | `features/ai/render.ts` | facts → prompt text. Pure, so the null rule is testable. |
| shapes | `features/ai/facts.ts` | the grounded payload, shared by the server and the UI. |
| orchestration | `features/ai/research-service.ts` | the sequence above. |
| storage | `features/ai/queries.ts`, `usage.ts` | conversations, messages, the usage ledger. |
| transport | `app/api/ai/**` | auth, validation, rate limit, the shared envelope. |

`domain/ai.ts` staying pure is what makes the parts that must not drift — what the assistant may
say, which symbols exist — testable without spending a token. That matters more here than anywhere
else in the app, because the alternative is checking them by hand against a non-deterministic system.

## 3. The provider abstraction

```ts
interface AIProvider {
  readonly name: string
  readonly model: string
  generate(request: AIRequest): Promise<AIResult>
  generateStructured<T>(request: AIStructuredRequest, schema: ZodType<T>): Promise<AIStructuredResult<T>>
}
```

Three implementations, chosen by `AI_PROVIDER` in `services/ai/index.ts` — the only place a vendor
name appears:

| provider | transport | notes |
|---|---|---|
| `anthropic` | the official `@anthropic-ai/sdk` | the SDK owns timeout, bounded retry and typed errors; re-implementing those over `fetch` would be three more things to get subtly wrong |
| `openai` | one `fetch` to `/chat/completions` | the shape OpenAI, Groq, Together, OpenRouter, Ollama and llama.cpp all speak, so `AI_BASE_URL` is what makes a local model work. A second SDK for one request body four vendors agree on would be a dependency bought for nothing |
| `mock` | none | deterministic, no account, clearly labelled. The same role `mockMarketDataProvider` plays |

Adapters implement `generate` only. `withStructuredOutput` adds the JSON instruction, the parse, the
Zod validation and the repair round once, so two adapters cannot drift apart in how strictly they
validate.

### Structured output is validated, not delegated

Providers differ in how — and whether — they constrain output to a schema. Stockly does not depend
on any of them doing it: the model is asked for JSON, the reply is parsed, and the object is
validated with the same Zod schema the rest of the app uses. One repair round follows a failure, and
after that the request is rejected.

`ponytail:` ceiling — a provider's native constrained decoding (`output_config.format`,
`response_format`) would lower the repair rate. It would not remove the validation, which has to
exist anyway, so it buys latency and not safety. Add it per-adapter when the repair rate is measured
to matter.

### Retries

`withRetry` retries a rate limit, a timeout and a transient outage; it never retries a bad key or an
unusable reply. Three attempts, exponential backoff with jitter. Bounded on purpose: an AI request
costs money and holds a serverless function open, so an unbounded retry turns one slow provider into
an outage of your own making.

## 4. Grounding

Three mechanisms, in increasing order of how much they actually guarantee:

1. **The system prompt says so.** Useful, and not a guarantee.
2. **The response schema has no numeric fields.** The model is never asked for a figure, so it
   cannot return one that disagrees with Stockly.
3. **Every figure is rendered from the structured payload**, which came from the engines that own
   it: `services/market-data` for prices, `technical_snapshots` for indicators,
   `domain/technical.scoreTechnicals` for the score breakdown, `loadAnalytics` for portfolio
   figures, `domain/screener.matchesFilter` for pass/fail.

The one place grounding can still go wrong is the text handed to the model, so `render.ts` is pure
and unit-tested on a single rule: **a null reading renders as "unavailable", never as 0.** A model
handed `RSI: 0` will faithfully describe a stock as maximally oversold, and it will be right to —
the context lied to it.

## 5. Token discipline

| Bound | Value | Why |
|---|---|---|
| question | 1,000 chars | rejected by Zod before any provider call |
| history | 6 turns | the rest stays in the database, where the user can read it |
| context | 24,000 chars (~6k tokens) | truncated with an explicit marker, so a cut-off list is not read as complete |
| output | `AI_MAX_TOKENS`, default 2,000 | |
| symbols | 5 | each one is data to retrieve and render |
| on-demand indicator computes | 2 per request | each is an OHLCV call, and the free tier allows eight a minute |

Five years of OHLCV is tens of thousands of numbers and no model needs them. `summarizeHistory`
reduces a series to the dozen facts a written summary actually cites — 52-week range, distance from
the high, 1- and 3-month return, annualised volatility — all computed in `domain/`, none by the
model.

Retrieval is also **per intent**: an RSI question does not load a portfolio. That is a privacy rule
as much as a cost one.

## 6. Data model

```
ai_conversations   id, user_id, title, created_at, updated_at
ai_messages        id, conversation_id, user_id, role, content, data jsonb, intent, symbols[]
ai_usage           id, user_id, provider, model, intent, symbols[], input_tokens, output_tokens,
                   estimated_cost, latency_ms, status, error_code, created_at
```

Three tables, not four. Cost control, rate limiting and the audit trail all want the same row — who
asked, what about, which model, how many tokens, how long, did it work — so splitting `ai_usage` and
`ai_requests` would mean writing twice and reconciling later.

`ai_messages.data` holds the grounded payload as well as the prose, so a reopened conversation shows
what the user saw. `ai_usage` holds **no prompt text**: `intent` and `symbols` are what an audit
needs, and the words live in `ai_messages`, which the user can delete.

RLS on all three, default-deny, `user_id` denormalised so a policy is a single-column check. Usage
rows are insert-and-read only for their owner: a ledger a user can edit is not a ledger.

## 7. Caching

There is none, deliberately.

An answer depends on a question, a portfolio, a set of live prices and a snapshot timestamp. A cache
key covering all of that would miss nearly every time, and a key that missed one of them would serve
yesterday's prices as today's — the failure mode this whole feature is designed to avoid.

What *is* cached is everything underneath: quotes for 60s in the Next Data Cache, indicators in
`technical_snapshots` on a schedule. Those are the expensive parts, and they were already cached
before phase 7.

`ponytail:` ceiling — if identical questions ever become common, cache on
`(question, portfolio version, snapshot calculated_at)` and never on the question alone.

## 8. Streaming

Not implemented. The grounded data cards cannot render until retrieval finishes, and that is the
part users read first, so a token trickle for the prose would add a second transport, a second error
path and a partially-rendered answer for very little. The loading UI names the actual stages
instead.

`ponytail:` ceiling — add SSE when answer length, not retrieval, becomes the complaint.

## 9. Runtime

Node, not edge: the orchestrator reaches the market-data and portfolio services. `maxDuration = 60`
on every AI route, with `AI_TIMEOUT_MS` (default 25s) well inside it — twice, in the worst case
where a reply needs a repair round. **Never assume an AI request has no timeout**; a hung provider
call that outlives its function is an outage you paid for.

## 10. Failure

Every failure resolves to an `AIError` with a stable code, mapped by `lib/api.ts` into the shared
envelope. The user sees a sentence; the provider's own words are logged and never returned, because
a provider's error text can echo the prompt back.

A provider outage costs the assistant and nothing else. Portfolio, market data, watchlist, screener
and alerts do not import `services/ai` at all.
