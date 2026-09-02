import type { Metadata } from "next"
import { LegalPage } from "../_prose"

export const metadata: Metadata = { title: "Privacy" }

/**
 * Written from the code, not from a template. Every claim here corresponds to something that is
 * actually true of this application — if a claim stops being true, the code changed and so must
 * this page.
 */
export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy">
      <section>
        <p>
          Stockly is a personal portfolio tracker. It stores the records you enter so it can compute
          your holdings and profit and loss, and nothing beyond that. It does not sell data, does not
          run advertising, and contains no third-party analytics or tracking scripts.
        </p>
      </section>

      <section>
        <h2>What is stored</h2>
        <ul>
          <li>Your email address and password, held by Supabase Auth. Stockly never sees the password.</li>
          <li>Portfolios, transactions, dividends and cash movements — the records you enter.</li>
          <li>Your watchlist, price alerts and saved screens.</li>
          <li>Notifications Stockly has generated for you, and any push subscription you enable.</li>
          <li>
            If you use the research assistant: your questions, its answers, and a usage row per
            request recording the model, token counts and latency. The usage row contains no
            question text.
          </li>
        </ul>
      </section>

      <section>
        <h2>What is not stored</h2>
        <ul>
          <li>No payment details. Stockly takes no payments.</li>
          <li>No brokerage credentials. Stockly does not connect to a broker and cannot trade.</li>
          <li>No market prices. Those are fetched on demand and cached briefly, never in your account.</li>
          <li>No portfolio data in your browser&apos;s cache. See the section on offline use below.</li>
        </ul>
      </section>

      <section>
        <h2>Who can read it</h2>
        <p>
          Every table holding your records is protected by row-level security in the database: a
          query runs as you, and rows belonging to another account are not returned. This is enforced
          by the database itself rather than by application code, so a bug in a page or an API route
          cannot expose someone else&apos;s portfolio.
        </p>
      </section>

      <section>
        <h2>Third parties</h2>
        <ul>
          <li>
            <strong>Supabase</strong> hosts the database and handles authentication.
          </li>
          <li>
            <strong>Vercel</strong> hosts the application and produces request logs.
          </li>
          <li>
            <strong>A market data provider</strong> receives the stock symbols being priced. It
            receives no account information and cannot associate a symbol with you.
          </li>
          <li>
            <strong>An AI provider</strong>, only if the research assistant is enabled and only when
            you ask it something. It receives your question and the specific figures needed to answer
            it. It receives no email address, no account identifier and no credentials, and it is
            given no ability to query the database.
          </li>
          <li>
            <strong>A push service</strong> (Apple, Google or Mozilla, depending on your browser), only
            if you enable push notifications. Push messages contain a stock symbol and a price, never
            a portfolio value.
          </li>
        </ul>
      </section>

      <section>
        <h2>Logs</h2>
        <p>
          Server logs record what happened, not what was said: a request identifier, the route, a
          status code and a duration. They never contain passwords, session tokens, API keys, the
          text of an AI question or answer, or any portfolio figure.
        </p>
      </section>

      <section>
        <h2>Offline use</h2>
        <p>
          Stockly installs as an app and works offline for navigation, but its service worker caches
          nothing that belongs to an account — no API response, no rendered page. Only the offline
          notice and the application&apos;s own static files are stored on your device. Signing out
          clears those caches. This is deliberate: a shared device must never replay one person&apos;s
          portfolio to the next.
        </p>
      </section>

      <section>
        <h2>Retention and deletion</h2>
        <ul>
          <li>Your records are kept for as long as your account exists.</li>
          <li>AI conversations are deleted after 180 days, and you can delete any of them at any time.</li>
          <li>AI usage rows, which contain no question text, are deleted after 365 days.</li>
          <li>
            Deleting a portfolio deletes its transactions, dividends, cash movements and snapshots.
            Deleting your account removes everything associated with it.
          </li>
        </ul>
      </section>

      <section>
        <h2>Contact</h2>
        <p>
          Stockly is a personal project. If you are running your own instance, you are the operator
          and the contact for anything on this page.
        </p>
      </section>
    </LegalPage>
  )
}
