import * as React from 'react'
import { cn } from '@/lib/utils'
import { type ControlTextSize, resolveControlFontSize } from './controlTextSize'

type TextareaProps = React.ComponentProps<'textarea'> & {
  /**
   * 字号（硬契约）：仅此 prop 与 style.fontSize 可控制字号，默认 className 不
   * 含任何字号类、外部 className 的 text-* 一律无效。预设 'xs'(12px) /
   * 'sm'(14px，默认) / 'base'(16px)，数字按 px。
   */
  textSize?: ControlTextSize | number
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, textSize, style, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'quiet-control min-h-24 w-full resize-y rounded-[14px] border-0 p-3 leading-6 text-[color:var(--color-foreground)] ring-offset-transparent placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    style={{ fontSize: resolveControlFontSize(textSize), ...style }}
    {...props}
  />
))
Textarea.displayName = 'Textarea'

export { Textarea }
