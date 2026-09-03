/*
 * Phase 21 — language.
 *
 * One column on the row that already holds theme and density, for the same reason phase 15 put
 * five documents there rather than in five tables: this is a per-user display preference that is
 * read with the others, written with the others, and never queried by its value.
 *
 * `locale` is what makes a language choice survive a new device. The cookie the switcher writes is
 * the fast path and the authority for the device in front of the user; this is the value a device
 * they have not signed into yet will pick up. See `lib/i18n/resolve.ts`.
 *
 * The default is `th`, matching `DEFAULT_LOCALE` in `domain/locale.ts`. The check constraint is the
 * same closed-enum discipline as `theme` and `density`: a locale the application has no messages
 * for must not be storable, because the row is read back and rendered later.
 */
alter table public.user_preferences
  add column if not exists locale text not null default 'th';

alter table public.user_preferences
  drop constraint if exists user_preferences_locale_known;

alter table public.user_preferences
  add constraint user_preferences_locale_known check (locale in ('th', 'en'));

comment on column public.user_preferences.locale is
  'UI language. Presentation only — it can never change a financial figure. Currency and timezone are separate preferences and are deliberately not derived from this.';
