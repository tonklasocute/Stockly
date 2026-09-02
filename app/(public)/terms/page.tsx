import type { Metadata } from "next"
import Link from "next/link"
import { LegalPage } from "../_prose"

export const metadata: Metadata = { title: "Terms" }

export default function TermsPage() {
  return (
    <LegalPage title="Terms of use">
      <section>
        <p>
          Stockly is a personal stock portfolio tracker and research tool. By using it you agree to
          what follows. If you do not, do not use it.
        </p>
      </section>

      <section>
        <h2>What Stockly is</h2>
        <p>
          A tool for recording your own transactions and seeing what they add up to, together with
          market data, technical analysis and an optional research assistant. It is informational
          software. It is not a broker, not an adviser, and not a regulated financial service.{" "}
          <Link href="/disclaimer" className="underline underline-offset-4">
            Read the disclaimer
          </Link>
          .
        </p>
      </section>

      <section>
        <h2>Your account</h2>
        <ul>
          <li>You are responsible for keeping your credentials secure.</li>
          <li>One person per account. Do not share an account with someone whose portfolio differs from yours.</li>
          <li>You are responsible for the accuracy of everything you enter. Stockly computes from your records; it cannot verify them.</li>
        </ul>
      </section>

      <section>
        <h2>Acceptable use</h2>
        <ul>
          <li>Do not attempt to access another account&apos;s data.</li>
          <li>Do not automate requests beyond ordinary use, or work around the rate limits.</li>
          <li>Do not resell or redistribute the market data Stockly displays; it is licensed from a provider under their terms, not yours.</li>
          <li>Do not use the research assistant to generate content presented to others as professional financial advice.</li>
        </ul>
      </section>

      <section>
        <h2>Availability</h2>
        <p>
          Stockly depends on third parties — a database host, a market data provider and, optionally,
          an AI provider. Any of them can be slow or unavailable, and Stockly is built to degrade
          rather than fail: prices fall back to your cost basis and say so, the assistant can be off
          without affecting anything else. No uptime is promised.
        </p>
      </section>

      <section>
        <h2>Market data</h2>
        <p>
          Prices and indicators come from a third-party provider and may be delayed, incomplete or
          wrong. Where a figure is delayed, Stockly says so on screen. Never treat a number here as a
          confirmation of an execution or a settlement — your broker&apos;s records are the ones that
          count.
        </p>
      </section>

      <section>
        <h2>No warranty, and the limit of liability</h2>
        <p>
          Stockly is provided as is, without warranty of any kind. To the fullest extent the law
          allows, its authors are not liable for any loss arising from its use — including trading
          losses, missed opportunities, incorrect calculations, delayed data, or a missed or late
          alert. Alerts are a convenience, not a guarantee: they are evaluated on a schedule and can
          be delayed or missed entirely.
        </p>
      </section>

      <section>
        <h2>Changes</h2>
        <p>
          These terms may change as the software does. The date at the top is when they last did.
        </p>
      </section>
    </LegalPage>
  )
}
