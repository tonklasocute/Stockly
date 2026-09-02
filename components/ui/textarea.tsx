import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Matches Input's styling, including the `pointer-coarse:` touch sizing every control in this app
 * uses — a coarse pointer is what decides the target size, not a width breakpoint.
 */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 dark:bg-input/30 field-sizing-content min-h-16 w-full rounded-lg border bg-transparent px-2.5 py-2 text-base transition-colors outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm pointer-coarse:px-3",
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
