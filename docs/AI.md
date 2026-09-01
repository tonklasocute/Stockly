# Stockly AI — what it does and what it refuses to do

Phase 7 adds a research assistant on top of the data Stockly already computes. It reads your
portfolio, your watchlist, prices and the technical engine, and it explains them in sentences.

> Stockly AI describes data. It is not a financial adviser, it does not issue ratings or price
> targets, and it does not predict prices. Nothing it produces is investment advice.

Companion documents: [AI-ARCHITECTURE.md](AI-ARCHITECTURE.md) for how it is built,
[AI-SECURITY.md](AI-SECURITY.md) for the threat model and the limits,
[AI-PROMPTS.md](AI-PROMPTS.md) for every prompt it sends.

---

## 1. The one idea

**The model writes prose. It never produces a number.**

Everything numeric on screen — price, RSI, ADX, the technical score and each of its components,
portfolio value, weights, returns — is retrieved from Stockly's own engines, rendered from a
structured payload, and shown *beside* the generated text rather than inside it. The response
schema the model fills in has exactly five fields:

```
summary  interpretation  positives  risks  notes
```

There is no `price` field for it to get wrong. A hallucinated figure is not unlikely here; it is
unrepresentable.

That is also why the UI splits every answer in two:

```
Data — from Stockly          AI interpretation
RSI (14)   58.4              Momentum is positive while trend strength
ADX (14)   27.1              remains moderate…
Score      78/100
```

---

## 2. What you can ask

| Intent | Example | What is retrieved |
|---|---|---|
| `STOCK_ANALYSIS` | "Analyse NVDA" | quote, indicators, score components, history summary, your position |
| `STOCK_COMPARISON` | "Compare NVDA and AMD" | the same, for each symbol |
| `TECHNICAL_EXPLANATION` | "Why is NVDA's technical score 78?" | the stored score components and their reasons |
| `PORTFOLIO_ANALYSIS` | "Analyse my portfolio" | the analytics bundle: value, return, concentration, movers, sectors |
| `WATCHLIST_ANALYSIS` | "Explain my watchlist" | every watched symbol's cached snapshot |
| `SCREENER_EXPLANATION` | "Why did NVDA pass my screen?" | your saved screen, evaluated by the screener engine |
| `MARKET_SUMMARY` | "How does the market look?" | breadth across the tracked universe |
| `INDICATOR_EXPLANATION` | "What does RSI measure?" | nothing — this one is general knowledge |
| `GENERAL_RESEARCH` | anything else | whatever matched, or an admission that nothing did |

Intent is detected by rule, not by a model call. Routing decides *what to retrieve*, and paying a
round trip to learn that "analyse my portfolio" is about the portfolio would be absurd — it would
also make retrieval non-deterministic, which grounding cannot afford.

## 3. Symbols

Every ticker in a question is validated against the symbols this deployment actually tracks
(anything with a cached snapshot, plus what you hold or watch). A symbol that is not there comes
back as **not found**:

> I couldn't find ABCXYZ in the supported market universe.

Common English words that are also tickers (`IT`, `ALL`, `ON`) are ignored unless written as
`$IT`. Without that, "is IT all worth it?" analyses two companies nobody asked about.

## 4. Freshness

Two timestamps, never conflated — the same rule as [TECHNICAL-ANALYSIS.md](TECHNICAL-ANALYSIS.md):
the price may be live while the indicators come from a snapshot computed on a schedule. When any
reading is past the freshness window the answer is labelled **Some data may be delayed**, and the
prompt tells the model in as many words not to call a delayed figure the current market price.

## 5. Data coverage, not confidence

Every answer carries `Data coverage 84%`. It counts how many of the expected data points were
retrieved. It is **not** a probability that a price will move, and the UI says so. Stockly produces
no such number, in this phase or any other.

Missing points are named: *unavailable: market cap, price history*.

## 6. Natural-language screener

On the screener page you can describe a screen in a sentence. The model returns
`{ metric, operator, value }` triples — validated by the same closed enums a hand-built screen uses
— and **you see them before anything runs**:

```
Find stocks with strong momentum and high volume
  →  RSI is at or above 50
     ADX is at or above 25
     Relative volume is at or above 1.5×
  [Use these filters]   [Discard]
```

Pressing *Use these filters* fills in the ordinary editor. Running the screen is still a press of
*Run screener*, against the same endpoint as always. The model never causes a query to execute.

## 7. Alerts

Stockly AI does not create alerts. It can translate "alert me when NVDA looks bullish" into the
supported conditions and describe them, but creating one is the existing dialog, filled in by you.
There is no path from a sentence to a row in `alerts`.

## 8. Conversations

Questions and answers are stored per user in `ai_conversations` / `ai_messages`, with RLS. The
assistant row stores both the prose and the grounded payload, so reopening a conversation shows what
you actually saw rather than re-running a retrieval whose figures have moved.

You can delete any conversation. Conversations are swept after **180 days**, usage rows after
**365**; the sweep runs inside the existing scheduled job.

Only the last **6 turns** travel with a new question. The rest stay in the database.

## 9. Configuration

```bash
AI_ENABLED=false          # the kill switch; everything else works unchanged when off
AI_PROVIDER=mock          # mock | anthropic | openai
AI_API_KEY=               # server-only, never NEXT_PUBLIC_
AI_MODEL=                 # defaults to claude-opus-5 for anthropic
AI_BASE_URL=              # openai-compatible endpoints, including a local model
AI_MAX_TOKENS=2000
AI_TEMPERATURE=0.2        # openai-compatible only — see below
AI_TIMEOUT_MS=25000
AI_DAILY_LIMIT=25         # AI requests per user per rolling 24 hours
```

**`AI_TEMPERATURE` is ignored by the Anthropic adapter.** Current Claude models reject sampling
parameters outright; the equivalent control is effort, and this workload runs at `low` — it is
grounded summarisation over figures Stockly has already computed, not a reasoning problem, and low
effort is both the faster and the cheaper setting.

`AI_PROVIDER=mock` needs no account. It returns a fixed, clearly-labelled narrative beside entirely
real data, which is how the feature and its tests run without spending anything.

### Shipping with it off

`AI_ENABLED=false` is a sensible production default until the budget and the provider account are
in place. With it off:

- `/ai` renders and explains that the assistant is switched off;
- the stock page's *Analyse with Stockly AI* section says the same;
- the natural-language screener box is not rendered at all;
- **every other feature is untouched** — portfolio, prices, watchlist, screener, alerts, PWA.

Both configurations are built in CI terms: `npm run build` succeeds either way.

## 10. What it costs

One question is one provider call — two if a reply fails validation or the safety check. Context is
capped at 24,000 characters (~6k tokens), history at 6 turns, output at `AI_MAX_TOKENS`.

Every call writes a row to `ai_usage`: provider, model, intent, symbols, input and output tokens,
an estimated cost, latency, and a status. The daily limit counts those rows, so it holds across
serverless instances and deploys — unlike the in-memory per-minute limiter, which only stops a
runaway loop.

## 11. Limits worth knowing

- **No index data.** The market summary measures breadth across the symbols Stockly tracks, not the
  S&P 500 — index series are not on the provider's free tier, and the answer says so rather than
  quoting a number it does not have.
- **No streaming.** An answer arrives whole. The data cards cannot render before retrieval finishes
  anyway, so a token trickle would buy a second transport and a second error path for very little.
- **Indicators may be on-demand.** A stock with no fresh snapshot costs one OHLCV request, capped at
  two per question.
- **Not a source of truth.** If the assistant and the dashboard ever disagreed about a number, the
  dashboard is right — the assistant reads the same engines and is not permitted to compute.
