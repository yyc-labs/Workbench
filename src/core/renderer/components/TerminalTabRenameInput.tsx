import { type ComponentProps, forwardRef, useEffect, useRef } from 'react'

type TerminalTabRenameInputProps = Omit<ComponentProps<'input'>, 'size'>

/**
 * 终端 tab 行内重命名输入框（终端坞 / 浮动面板共用）。
 *
 * 专用组件而非复用 `ui/Input`：行内编辑要求与相邻 tab 文字严格同字号
 * （`text-[11px] font-medium`）。`Input` 的默认类同时含 `text-base` 与
 * `md:text-sm`，而 twMerge 中无前缀的 `text-*` 无法覆盖带 `md:` 前缀的类——
 * 桌面端（≥768px）会放大到 14px，出现「双击改名后字体突然变大」。
 * 这里样式完全自包含、不做 class 合并，从结构上消除覆盖顺序依赖。
 */
export const TerminalTabRenameInput = forwardRef<HTMLInputElement, TerminalTabRenameInputProps>(function TerminalTabRenameInput({ className, ...props }, forwardedRef) {
  const innerRef = useRef<HTMLInputElement | null>(null)

  // 挂载即聚焦并全选：重命名默认覆盖输入。
  useEffect(() => {
    const input = innerRef.current
    if (input) {
      input.focus()
      input.select()
    }
  }, [])

  return (
    <input
      ref={(node) => {
        innerRef.current = node
        if (typeof forwardedRef === 'function') forwardedRef(node)
        else if (forwardedRef) forwardedRef.current = node
      }}
      className={`w-32 shrink-0 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)] px-2 py-0.5 text-[11px] font-medium leading-tight text-[color:var(--color-foreground)] outline-none${className ? ` ${className}` : ''}`}
      spellCheck={false}
      autoFocus
      {...props}
    />
  )
})
