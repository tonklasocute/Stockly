-- Fix: `portfolio_snapshots_quality_agrees` rejected every legitimate STALE snapshot.
--
-- The phase 16 constraint was written as a biconditional across all three qualities:
--
--     check ((quality = 'COMPLETE') = (missing_holdings = 0))
--
-- which says *every* non-COMPLETE row must be missing at least one holding. That is true of
-- PARTIAL, and false of STALE. The two qualities answer different questions:
--
--   * PARTIAL — a holding is absent from the total, because its value could not be translated.
--     The count is the evidence, and a PARTIAL row without one is a total that quietly excluded
--     something. `missing_holdings > 0` is the guarantee that keeps it honest.
--   * STALE   — every holding is in the total; some were priced from a reading that is too old.
--     Nothing is missing, so the count is genuinely 0.
--
-- So a portfolio with one stale price and nothing untranslated produced quality = 'STALE' with
-- missing_holdings = 0 and was refused by the database — the analytics page logged
-- `analytics.snapshot_failed` and lost the day, which is exactly the hole phase 16 set out to
-- stop leaving. The fix belongs here rather than in `recordSnapshot`: satisfying the old
-- constraint would have meant writing a missing count for a row that is missing nothing, and an
-- invented count in a financial record is worse than the constraint it placates.
--
-- Each direction is now stated for the quality it actually describes. STALE is unconstrained on
-- this column because a stale reading may also be missing a holding, and both facts are real.
--
-- Forward-only: the constraint is replaced, no column or row changes.

alter table public.portfolio_snapshots
  drop constraint portfolio_snapshots_quality_agrees;

alter table public.portfolio_snapshots
  add constraint portfolio_snapshots_quality_agrees
    check (
      case quality
        when 'COMPLETE' then missing_holdings = 0
        when 'PARTIAL'  then missing_holdings > 0
        else true
      end
    );

comment on column public.portfolio_snapshots.quality is
  'COMPLETE, PARTIAL or STALE. A PARTIAL row carries a value AND the count of what is missing from '
  'it, because a total that quietly excluded two holdings looks exactly like one that included '
  'them. A STALE row is missing nothing — every holding is in the total and some were priced from '
  'a reading that is too old — so its missing_holdings is 0.';
