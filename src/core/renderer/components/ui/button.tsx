import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"

const MIN_LOADING_VISIBLE_MS = 50

const buttonVariants = cva(
  "button-interactive inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium ring-offset-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-sm hover:bg-primary-hover",
        destructive:
          "bg-destructive text-destructive-foreground hover:opacity-90",
        outline:
          "quiet-control border-0 bg-transparent hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-full px-3.5",
        lg: "h-11 rounded-full px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  loading?: boolean
  loadingIcon?: React.ReactNode
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, loadingIcon, children, disabled, ...props }, ref) => {
    const [visibleLoading, setVisibleLoading] = React.useState(loading)
    const loadingStartRef = React.useRef<number | null>(loading ? Date.now() : null)

    React.useEffect(() => {
      if (loading) {
        loadingStartRef.current = Date.now()
        setVisibleLoading(true)
        return
      }

      if (!visibleLoading) return

      const startedAt = loadingStartRef.current
      const elapsed = startedAt ? Date.now() - startedAt : MIN_LOADING_VISIBLE_MS
      const remaining = Math.max(0, MIN_LOADING_VISIBLE_MS - elapsed)
      const timer = window.setTimeout(() => {
        setVisibleLoading(false)
        loadingStartRef.current = null
      }, remaining)

      return () => {
        window.clearTimeout(timer)
      }
    }, [loading, visibleLoading])

    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        aria-busy={visibleLoading || undefined}
        data-loading={visibleLoading ? 'true' : undefined}
        disabled={disabled || visibleLoading}
        {...props}
      >
        {visibleLoading ? (loadingIcon ?? <Loader2 className="animate-spin" />) : null}
        <span className={cn("inline-flex items-center gap-2", visibleLoading && "[&_svg]:hidden")}>
          {children}
        </span>
      </Comp>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
