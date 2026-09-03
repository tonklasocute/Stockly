/**
 * The th message barrel.
 *
 * Static imports, not a dynamic template: the bundler must be able to see exactly which JSON
 * belongs to which language, so a request for Thai never pulls the English messages into the
 * payload. `lib/i18n/completeness.test.ts` checks this file against `NAMESPACES` and against the
 * directory, so a namespace added to one and not the others is a failing test.
 */
import common from "./common.json"
import navigation from "./navigation.json"
import enums from "./enums.json"
import errors from "./errors.json"
import validation from "./validation.json"
import metadata from "./metadata.json"
import ai from "./ai.json"
import alerts from "./alerts.json"
import analytics from "./analytics.json"
import auth from "./auth.json"
import cash from "./cash.json"
import dashboard from "./dashboard.json"
import dataQuality from "./dataQuality.json"
import dividends from "./dividends.json"
import fundamentals from "./fundamentals.json"
import goals from "./goals.json"
import history from "./history.json"
import imports from "./imports.json"
import intelligence from "./intelligence.json"
import journal from "./journal.json"
import legal from "./legal.json"
import news from "./news.json"
import notifications from "./notifications.json"
import operations from "./operations.json"
import personalization from "./personalization.json"
import portfolios from "./portfolios.json"
import pwa from "./pwa.json"
import screener from "./screener.json"
import settings from "./settings.json"
import sharing from "./sharing.json"
import simulations from "./simulations.json"
import stocks from "./stocks.json"
import technical from "./technical.json"
import theses from "./theses.json"
import transactions from "./transactions.json"
import watchlist from "./watchlist.json"

const messages = {
  common,
  navigation,
  enums,
  errors,
  validation,
  metadata,
  ai,
  alerts,
  analytics,
  auth,
  cash,
  dashboard,
  dataQuality,
  dividends,
  fundamentals,
  goals,
  history,
  imports,
  intelligence,
  journal,
  legal,
  news,
  notifications,
  operations,
  personalization,
  portfolios,
  pwa,
  screener,
  settings,
  sharing,
  simulations,
  stocks,
  technical,
  theses,
  transactions,
  watchlist,
}

export default messages
