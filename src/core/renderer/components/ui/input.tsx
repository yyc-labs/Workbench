import * as React from "react"
import { Eye, EyeOff } from "lucide-react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, disabled, onWheel, ...props }, ref) => {
    const isPasswordField = type === "password"
    const isNumberField = type === "number"
    const [passwordVisible, setPasswordVisible] = React.useState(false)
    const resolvedType = isPasswordField ? (passwordVisible ? "text" : "password") : type
    const handleNumberWheel = (event: React.WheelEvent<HTMLInputElement>) => {
      if (isNumberField && !event.ctrlKey) {
        event.preventDefault()
        event.stopPropagation()
        event.currentTarget.blur()
      }
      onWheel?.(event)
    }

    if (!isPasswordField) {
      return (
        <input
          type={type}
          className={cn(
            "quiet-control flex h-10 w-full rounded-full border-0 px-4 py-2 text-base ring-offset-transparent file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
            className
          )}
          ref={ref}
          disabled={disabled}
          onWheelCapture={isNumberField ? handleNumberWheel : undefined}
          onWheel={isNumberField ? undefined : onWheel}
          {...props}
        />
      )
    }

    return (
      <div className="relative w-full">
        <input
          type={resolvedType}
          className={cn(
            "quiet-control flex h-10 w-full rounded-full border-0 px-4 py-2 pr-11 text-base ring-offset-transparent file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
            className
          )}
          ref={ref}
          disabled={disabled}
          {...props}
        />
        <button
          type="button"
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-full text-[color:var(--color-muted-foreground)] transition-colors hover:text-[color:var(--color-foreground)] disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => setPasswordVisible((current) => !current)}
          disabled={disabled}
          aria-label={passwordVisible ? "Hide value" : "Show value"}
          title={passwordVisible ? "Hide value" : "Show value"}
        >
          {passwordVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    )
  }
)
Input.displayName = "Input"

export { Input }
