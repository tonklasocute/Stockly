import type { Metadata } from "next"
import { LegalPage } from "../_prose"

export const metadata: Metadata = { title: "Disclaimer" }

export default function DisclaimerPage() {
  return (
    <LegalPage title="Disclaimer">
      <section>
        <p className="font-medium">
          Stockly provides informational and analytical tools. Market data may be delayed or
          incomplete. Nothing on Stockly is personalised financial advice.
        </p>
      </section>

      <section>
        <h2>Not advice</h2>
        <p>
          Stockly does not know your circumstances, your objectives or your tax position, and it
          never tells anyone what to buy, sell or hold. Nothing it displays is a recommendation, a
          rating or a solicitation. Decisions about your money are yours, and a licensed adviser is
          the right person to discuss them with.
        </p>
      </section>

      <section>
        <h2>Technical analysis describes; it does not predict</h2>
        <p>
          Indicators such as RSI, MACD and ADX are arithmetic on past price and volume. The technical
          score is a weighted summary of those readings, shown with the exact rule that produced each
          component so you can judge it yourself. It is not a forecast, a probability, or an opinion
          about where a price is going. Past behaviour does not determine future performance.
        </p>
      </section>

      <section>
        <h2>The research assistant</h2>
        <p>
          When enabled, Stockly AI writes prose about figures Stockly has already computed. It is
          given no ability to produce a number of its own: every price, indicator and portfolio
          figure on screen is retrieved from Stockly&apos;s own engines and shown beside the text.
          Even so, a language model can misread or misdescribe what it is given. Check the figures,
          which are the authoritative part of any answer.
        </p>
        <p>
          The assistant does not give investment advice, issue price targets, or predict prices. Where
          it would otherwise recommend, it describes.
        </p>
      </section>

      <section>
        <h2>Your numbers are only as good as your records</h2>
        <p>
          Holdings, average cost and profit and loss are derived from the transactions you enter, using
          weighted average cost. They are not reconciled against a broker. If a transaction is missing
          or wrong, every figure downstream of it is wrong too. For tax purposes, use your
          broker&apos;s statements — Stockly&apos;s cost basis method may not match the one your
          jurisdiction requires.
        </p>
      </section>

      <section>
        <h2>Alerts</h2>
        <p>
          Alerts are evaluated on a schedule against third-party data. They can be delayed, and a
          provider outage means none fire at all. Never rely on an alert as the only thing standing
          between you and a decision that matters.
        </p>
      </section>
    </LegalPage>
  )
}
