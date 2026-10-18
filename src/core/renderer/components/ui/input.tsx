import { Eye, EyeOff } from 'lucide-react'
import * as React from 'react'
import { cn } from '@/lib/utils'
import { type ControlTextSize, resolveControlFontSize } from './controlTextSize'

type InputProps = React.ComponentProps<'input'> & {
  /**
   * 字号（硬契约）：仅此 prop 与 style.fontSize 可控制字号，默认 className 不
   * 含任何字号类、外部 className 的 text-* 一律无效。预设 'xs'(12px) /
   * 'sm'(14px，默认) / 'base'(16px)，数字按 px。
   */
  textSize?: ControlTextSize | number
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, disabled, onWheel, textSize, style, ...props }, ref) => {
  const isPasswordField = type === 'password'
  const isNumberField = type === 'number'
  const [passwordVisible, setPasswordVisible] = React.useState(false)
  const resolvedType = isPasswordField ? (passwordVisible ? 'text' : 'password') : type
  const handleNumberWheel = (event: React.WheelEvent<HTMLInputElement>) => {
    if (isNumberField && !event.ctrlKey) {
      event.preventDefault()
      event.stopPropagation()
      event.currentTarget.blur()
    }
    onWheel?.(event)
  }
  const resolvedStyle: React.CSSProperties = { fontSize: resolveControlFontSize(textSize), ...style }

  if (!isPasswordField) {
    return (
      <input
        type={type}
        className={cn(
          'quiet-control flex h-10 w-full rounded-full border-0 px-4 py-2 ring-offset-transparent file:border-0 file:bg-transparent file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        style={resolvedStyle}
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
          'quiet-control flex h-10 w-full rounded-full border-0 px-4 py-2 pr-11 ring-offset-transparent file:border-0 file:bg-transparent file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        style={resolvedStyle}
        ref={ref}
        disabled={disabled}
        {...props}
      />
      <button
        type="button"
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-full text-[color:var(--color-muted-foreground)] transition-colors hover:text-[color:var(--color-foreground)] disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() => setPasswordVisible((current) => !current)}
        disabled={disabled}
        aria-label={passwordVisible ? 'Hide value' : 'Show value'}
        title={passwordVisible ? 'Hide value' : 'Show value'}
      >
        {passwordVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  )
})
Input.displayName = 'Input'

export { Input }
