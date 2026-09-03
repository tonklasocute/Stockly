import { readFileSync } from "node:fs"
import { execSync } from "node:child_process"
import { describe, expect, it } from "vitest"

/**
 * `DropdownMenuLabel` is Base UI's `Menu.GroupLabel`, and it calls `useMenuGroupRootContext()`
 * unconditionally — outside a `Menu.Group` or `Menu.RadioGroup` it **throws**, taking the whole
 * React tree down to `global-error`.
 *
 * That is a crash, not a degradation, and it is invisible until the menu that contains it happens
 * to render. Phase 21 found two of them: one in a new language switcher, which rendered first and
 * so was caught immediately, and one that had been sitting in the account menu since phase 15
 * waiting for somebody to open it.
 *
 * A source-reading test rather than a render test: there is no DOM harness in this suite, the rule
 * is purely structural, and reading the files is enough to state it.
 */
const FILES = execSync(
  "grep -rl DropdownMenuLabel --include=*.tsx app components features",
  { encoding: "utf8" },
)
  .trim()
  .split("\n")
  .filter((file) => file && !file.endsWith("components/ui/dropdown-menu.tsx"))

describe("every DropdownMenuLabel sits inside a group", () => {
  it.each(FILES)("%s", (file) => {
    const source = readFileSync(file, "utf8")

    for (const [index, line] of source.split("\n").entries()) {
      if (!line.includes("<DropdownMenuLabel")) continue

      // The nearest group tag above it must be an opening one.
      const before = source.split("\n").slice(0, index)
      const lastOpen = before.findLastIndex((l) => l.includes("<DropdownMenuGroup") || l.includes("<DropdownMenuRadioGroup"))
      const lastClose = before.findLastIndex((l) => l.includes("</DropdownMenuGroup>") || l.includes("</DropdownMenuRadioGroup>"))

      expect(lastOpen, `${file}:${index + 1} — <DropdownMenuLabel> outside a group throws at render`)
        .toBeGreaterThan(lastClose)
    }
  })
})
