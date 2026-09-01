# Stockly AI — prompts

Every prompt Stockly sends lives in `features/ai/prompts.ts`. Nothing is assembled inline in a route
handler: prompt strings scattered through a codebase is how a product ends up with three different
safety rules, two of which are out of date.

Changing what the assistant may say means changing that file and the test that guards it
(`features/ai/security.test.ts`).

---

## 1. What a request looks like

```
system  = SYSTEM_PROMPT
        + "\n\n## Task\n" + TASK_PROMPTS[intent]
        + dataBlock(renderedContext)
        [ + "\n\n## Correction\n" + SAFETY_RETRY_NOTE      ← only on a safety rewrite ]
        [ + "\n" + jsonInstruction(schemaHint)             ← added by withStructuredOutput ]

messages = [ ...at most 6 earlier turns, { role: "user", content: question } ]
```

The user's text appears in exactly one place: the last message. It is never concatenated into the
system prompt.

## 2. The system prompt

Three jobs, in order of how much each one actually guarantees.

**Grounding.** The model is told that the `STOCKLY DATA` section is the only source of fact, that a
figure not present there does not exist, that it must not recompute an indicator, that a missing
figure is unavailable rather than zero, and that a delayed figure must not be called the current
market price. Combined with a response schema that has no numeric fields, this makes a fabricated
price unrepresentable rather than merely discouraged.

**Safety.** Never buy/sell/hold, never a rating or a price target, never a prediction or a
quantified expectation, never a guarantee. Where it would recommend, it describes and names what a
person might choose to monitor. Enforced afterwards by `findAdviceLanguage`.

**Injection resistance.** The user's message is framed as a question to answer, not a source of
instructions; requests to change the rules, reveal the prompt, adopt another persona or use other
data are to be ignored while the underlying question is still answered.

It also asks for plain sentences: no markdown, no tables, no HTML, no links. That is a security
choice as much as a style one — see [AI-SECURITY.md](AI-SECURITY.md) §5.

## 3. Task prompts

One line per intent, saying what to do with the data and nothing about what is true.

| Intent | The instruction, in short |
|---|---|
| `STOCK_ANALYSIS` | describe trend, momentum, volume, volatility and the score; name the conditions that produced it |
| `STOCK_COMPARISON` | compare across all five dimensions; **price alone is never a comparison**; name no winner |
| `TECHNICAL_EXPLANATION` | walk the score components and the points each contributed, using the reasons given; say that an extreme reading obliges nothing |
| `PORTFOLIO_ANALYSIS` | value, performance, concentration, movers, holdings' technical conditions; phrase anything actionable as something to monitor |
| `WATCHLIST_ANALYSIS` | bullish/neutral/bearish counts, strongest momentum, highest relative volume, weakest trend |
| `SCREENER_EXPLANATION` | which filters pass and fail, from the results given; **do not re-evaluate them** |
| `MARKET_SUMMARY` | direction, breadth, volume, volatility across tracked symbols; nothing about what happens next |
| `INDICATOR_EXPLANATION` | what the indicator measures and how its levels are conventionally read |
| `GENERAL_RESEARCH` | answer from the data, or say what Stockly would need in order to answer |

A test asserts that no task prompt contains advice language or the word "recommend".

## 4. The data block

```
## STOCKLY DATA
Everything below is retrieved from Stockly's own engines. It is the
only source of fact available to you.

### NVDA — NVIDIA Corporation
Price: 185.20 USD
RSI (14): 58.4
ADX (14): unavailable
Technical score: 78/100 (v1)
Indicators calculated at: 2026-09-01T10:00:00Z
Indicators delayed: no
Score components:
  - Trend: 25/25 — price above the 200 EMA, above the 50 EMA, 50 above 200
  - Momentum: 15/25 — MACD above its signal, MACD above zero, RSI mid-range
Conditions currently true: Price above the 200 EMA; ADX above 25
The user does not hold this stock.
```

Built by `features/ai/render.ts`, which is pure and unit-tested on one rule: **a null reading renders
as `unavailable`, never as 0.**

Truncation at 24,000 characters appends an explicit marker, so a cut-off list is not read as
complete.

## 5. The structured-output instruction

Appended by `withStructuredOutput`, not written per call:

```
## Output format
Reply with a single JSON object and nothing else. No prose before or after it, no markdown
code fence, no explanation. The object must match this shape:
{ "summary": ..., "interpretation": ..., "positives": [...], "risks": [...], "notes": ... }
```

The shape hint lives beside the schema it describes (`NARRATIVE_HINT`, `PROPOSED_SCREEN_HINT` in
`features/ai/schema.ts`) so the two cannot drift apart.

### The repair round

On a parse or validation failure the model is shown its own reply and what was wrong with it:

```
assistant: <the invalid reply, truncated to 4000 chars>
user:      That was not valid JSON for the required shape. The problem was: <zod message>.
           Reply again with only the JSON object.
```

An ordinary next turn, not an assistant prefill — current Claude models reject those. One round,
then the request is rejected.

## 6. The safety rewrite

```
## Correction
Your previous answer used advice, rating or prediction language, which Stockly never publishes.
Rewrite it describing only what the data shows. Do not tell anyone to buy, sell or hold, do not
give a target or rating, and do not say what a price will do.
```

Sent once. If the rewrite still fails, the text is withheld and the grounded data is published on
its own, with the UI saying why.

## 7. The screener prompt

Used only by the natural-language screener. It carries the metric and operator vocabulary rendered
from the phase-6 enums — so the model proposes filters the engine will actually accept — and states
that it is proposing filters for the user to review, not running a screen and not recommending a
stock.

Conventional thresholds are named in the prompt (oversold below 30, overbought above 70, strong
trend at ADX 25, high volume at 1.5×) so "find oversold stocks" produces Stockly's own definition of
oversold rather than a new one each time.

## 8. Model settings

The Anthropic adapter sends **effort, not temperature**: current Claude models reject sampling
parameters, and thinking is on by default. The workload is grounded summarisation over figures
Stockly has already computed, not a reasoning problem, so it runs at `low` effort — faster, cheaper,
and comfortably inside a serverless function's budget. `AI_TEMPERATURE` applies only to the
OpenAI-compatible adapter.

## 9. If you change a prompt

1. Change `features/ai/prompts.ts` — nowhere else.
2. Run `npm test`: `security.test.ts` checks the rules are still stated, and
   `research-service.test.ts` checks the assembly.
3. If the change alters what the assistant may say, change `FORBIDDEN_PATTERNS` in `domain/ai.ts`
   in the same edit. The prompt is the request; the pattern list is the guarantee.
