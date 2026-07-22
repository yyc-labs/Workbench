import * as React from 'react'
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'

import { cn } from '@/lib/utils'

type ScrollAreaProps = React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root> & {
  viewportClassName?: string
  viewportRef?: React.Ref<HTMLDivElement>
  horizontalScrollbar?: boolean
  horizontalScrollbarClassName?: string
  verticalScrollbarClassName?: string
}

const ScrollArea = React.forwardRef<React.ElementRef<typeof ScrollAreaPrimitive.Root>, ScrollAreaProps>(({ className, children, viewportClassName, viewportRef, horizontalScrollbar = false, horizontalScrollbarClassName, verticalScrollbarClassName, ...props }, ref) => (
  <ScrollAreaPrimitive.Root ref={ref} className={cn('relative overflow-hidden', className)} {...props}>
    <ScrollAreaPrimitive.Viewport ref={viewportRef} className={cn('h-full w-full rounded-[inherit]', viewportClassName)}>
      {children}
    </ScrollAreaPrimitive.Viewport>
    <ScrollBar className={verticalScrollbarClassName} />
    {horizontalScrollbar ? <ScrollBar orientation="horizontal" className={horizontalScrollbarClassName} /> : null}
    {horizontalScrollbar ? <ScrollAreaPrimitive.Corner /> : null}
  </ScrollAreaPrimitive.Root>
))
ScrollArea.displayName = ScrollAreaPrimitive.Root.displayName

const ScrollBar = React.forwardRef<React.ElementRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>, React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>>(({ className, orientation = 'vertical', ...props }, ref) => (
  <ScrollAreaPrimitive.ScrollAreaScrollbar
    ref={ref}
    orientation={orientation}
    className={cn('flex touch-none select-none bg-[var(--scrollbar-track)] transition-colors', orientation === 'vertical' && 'h-full w-[var(--scrollbar-size)] border-l border-l-transparent p-[1px]', orientation === 'horizontal' && 'h-[var(--scrollbar-size)] flex-col border-t border-t-transparent p-[1px]', className)}
    {...props}
  >
    <ScrollAreaPrimitive.ScrollAreaThumb className="relative flex-1 rounded-full bg-[var(--scrollbar-thumb)] hover:bg-[var(--scrollbar-thumb-hover)] active:bg-[var(--scrollbar-thumb-active)]" />
  </ScrollAreaPrimitive.ScrollAreaScrollbar>
))
ScrollBar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName

export { ScrollArea, ScrollBar }
