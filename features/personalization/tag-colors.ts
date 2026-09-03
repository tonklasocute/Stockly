/**
 * Tag colours, as token classes rather than hex values.
 *
 * A colour picked from a free text field is a contrast bug waiting to happen and would not adapt
 * between light and dark mode. A fixed palette of eight is enough to tell groups apart, and every
 * entry is legible in both themes.
 *
 * Colour never carries meaning on its own here: a tag always shows its name beside its colour.
 */
export const TAG_CLASSES: Record<string, string> = {
  slate: "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300",
  blue: "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300",
  green: "border-green-300 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300",
  amber: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300",
  red: "border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300",
  violet: "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300",
  teal: "border-teal-300 bg-teal-50 text-teal-700 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-300",
  pink: "border-pink-300 bg-pink-50 text-pink-700 dark:border-pink-800 dark:bg-pink-950 dark:text-pink-300",
}
