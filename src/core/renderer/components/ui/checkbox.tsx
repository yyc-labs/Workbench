import * as React from "react"

import { cn } from "@/lib/utils"

type CheckboxProps = Omit<React.ComponentProps<"input">, "type">

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      type="checkbox"
      className={cn(
        "shrink-0 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
)
Checkbox.displayName = "Checkbox"

export { Checkbox }
