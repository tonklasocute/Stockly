# Stockly AI — security

What the AI feature is defended against, how, and where the defence actually lives. Most of these
properties are structural: a key that is never read on the client cannot leak, and a string that is
never rendered as HTML cannot carry a script. `features/ai/security.test.ts` asserts each one so a
later change that quietly removes it fails there rather than in production.

---

## 1. Secrets

| Rule | Where it holds |
|---|---|
| `AI_API_KEY` is read in exactly one module | `lib/env.server.ts`, which imports `server-only` |
| A client import of the AI provider is a build error | `services/ai/index.ts` imports `server-only` |
| No `NEXT_PUBLIC_AI_*` exists | asserted against `.env.example` and `lib/env.ts` |
| The key never reaches the browser bundle | asserted after a production build: no key and no vendor name in `.next/static` |
| Provider error text is never returned | `AIError` carries a user-facing sentence; the cause is logged |

The page reads `isAIEnabled()` on the server and passes a boolean to the client, so the browser
learns "off" and nothing else about the configuration.

## 2. Authentication and authorization

Every AI route goes through `guarded()`: Supabase configured → session resolved → handler. There is
no unauthenticated AI surface.

- **No route accepts a `user_id`.** It comes from the session, always. Asserted by a test.
- **`portfolioId` is resolved, not trusted.** `resolveActivePortfolio(id)` looks the id up in the
  caller's own portfolios; one belonging to somebody else falls back to the caller's default rather
  than loading it.
- **`conversationId` is loaded through RLS.** Another user's id returns nothing, so the turn starts
  a new conversation instead of appending to theirs — and a 404 rather than a 403, because a 403
  confirms the id exists.
- **Deletes rely on RLS**, not on an application-code `user_id` filter: the delete matches no rows.

RLS is the authorization boundary, exactly as it is for every other user table. A bug in a route
handler cannot cross a user boundary.

### User A cannot reach user B's portfolio

The model is the wrong thing to worry about here. It has no tools, no database handle and no
network access — it receives a block of text. That text was assembled from queries that ran under
the caller's own session before the model existed in the request. There is no instruction a question
can contain that reaches another user's data, because there is no mechanism to reach it with.

## 3. Prompt injection

Layered, because no single layer is sufficient:

1. **Separation by type.** `AIMessage` is `"user" | "assistant"` — there is no `system` role a
   client can reach. Operator instructions live in `AIRequest.system`, which the orchestrator builds.
   A question cannot be promoted to operator authority; the type system forbids it.
2. **Separation by position.** Retrieved data goes in a labelled `## STOCKLY DATA` section of the
   system prompt. The question is a separate turn.
3. **Instruction.** The system prompt says the user's message is a question to answer and not a
   source of instructions, and names the specific attempts to ignore: changing the rules, revealing
   the prompt, adopting another persona, using data from elsewhere.
4. **Output checking.** A jailbreak that works is still caught on the way out — see below.
5. **No capability to abuse.** Even a fully successful injection reaches a model that can only
   return five text fields.

The realistic worst case is a model that writes something silly. It is not a model that reads a
database, because it cannot.

## 4. The safety vocabulary

Stockly describes; it does not advise and it does not predict. That is stated to the model *and*
enforced afterwards, because a prompt is a request and a check is a guarantee.

`domain/ai.ts` holds `FORBIDDEN_PATTERNS` — trade instructions, ratings, price targets, guarantees,
quantified forecasts. Every generated field is checked against them:

```
clean            → published
violation        → one rewrite with a stricter reminder
still violating  → the text is withheld; the grounded data is published unchanged,
                   and the UI says why
```

A withheld answer is visible, not silent. The user is told the text was withheld and that the data
beside it is unaffected.

## 5. XSS

**Model output is untrusted content and is never rendered as HTML.**

There is no markdown parser, no sanitiser and no `dangerouslySetInnerHTML` anywhere in
`features/ai` — a test asserts all three. Every generated string goes through a React text node,
which escapes by construction. A reply containing `<script>` renders as the visible characters
`<script>`.

That is why the system prompt asks for plain sentences with no markdown, no tables and no links:
having asked for nothing to render, there is nothing to render, and no parser to keep patched.

## 6. SQL injection

There is no SQL to inject into. Every query is a parameterised Supabase call, and the one place a
model's output influences a query is the natural-language screener — where it produces
`{ metric, operator, value }` triples validated against **closed enums**, the same ones a hand-built
screen uses:

- `metric` and `operator` are `z.enum` over the phase-6 lists; an unknown value is rejected at the
  boundary and, if it somehow arrived, would read as `null` in the engine and match nothing.
- `value` is a number or one of three trend names. Nothing else is representable. `null` and
  booleans are turned into `NaN` before coercion so that "no value" cannot arrive as a threshold of
  zero.
- At most ten filters.

There is no field that is ever interpreted, so there is nothing for an expression to be smuggled
into. **The model never runs the screen** — it proposes, the user reviews, and the existing
`/api/screener` endpoint executes.

## 7. Cost and abuse

| Control | Value | Enforced |
|---|---|---|
| Feature flag | `AI_ENABLED` | before any work |
| Requests per minute | 6 per user per endpoint | `lib/rate-limit.ts` — in memory, a brake |
| Requests per rolling 24h | `AI_DAILY_LIMIT`, default 25 | counted in `ai_usage` — survives deploys and instances |
| Question length | 1,000 chars | Zod, before the provider |
| Context | 24,000 chars | truncated with a marker |
| History | 6 turns | |
| Output | `AI_MAX_TOKENS` | |
| Timeout | `AI_TIMEOUT_MS`, default 25s | per provider call |
| Retries | 3 attempts, retryable failures only | `withRetry` |
| Structured repair | 1 round, then reject | `withStructuredOutput` |
| Symbols | 5 per request | |
| Indicator computes | 2 per request | each is an upstream call |

The in-memory limiter is honest about being a brake: each serverless instance keeps its own counter
and a cold start forgets everything. That is fine for stopping a runaway loop and useless for a
spending cap, which is why the daily limit is a row count. It **fails closed** — if the count cannot
be read, the request is refused.

The quota is charged only once a provider call has actually been attempted: a request stopped by the
flag, the quota itself or validation costs nothing and consumes nothing.

## 8. Logging and privacy

`console.info("[ai]", …)` records intent, provider, model, symbol *count*, token counts, latency,
context size, coverage and status. It records **no prompt, no answer, no key and no portfolio
figure** — a log line that quotes a prompt is a second copy of the user's data. A test greps the AI
sources for a log call mentioning a key, a prompt or an answer.

`ai_usage` stores no question text either. The words live in `ai_messages`, under the user's control.

Nothing sensitive is ever placed in the context: no password, no token, no API key, no `user_id`,
no email. The context builder retrieves market and portfolio figures and nothing else, and it
retrieves only what the detected intent needs.

## 9. Retention

| Data | Kept | Deleted by |
|---|---|---|
| conversations and messages | 180 days | the scheduled sweep, or the user at any time |
| usage rows | 365 days | the scheduled sweep |

The sweep runs inside the existing `/api/cron/alerts` job — two indexed deletes riding a job that
already holds the only service-role credential in the app, rather than a second scheduler, a second
secret and a second endpoint to protect.

## 10. Checklist

- [x] API key server-only, absent from the client bundle
- [x] Authentication on every AI route
- [x] Authorization through RLS; no `user_id` from a request body
- [x] User data isolation (portfolio, conversations, usage)
- [x] Prompt-injection resistance: type separation, position separation, instruction, output check
- [x] XSS: no HTML rendering path at all
- [x] SQL injection: closed enums, no interpreted field, model never executes
- [x] Rate limit (per minute) and spending cap (per day, database-counted, fails closed)
- [x] Request size, context, history, output and symbol limits
- [x] Timeout and bounded retries
- [x] Secret redaction: provider text logged, never returned
- [x] No sensitive logging; no prompt storage in the ledger
- [x] Retention policy with user-initiated deletion
