/**
 * 19 号计划 §2.2 方式 A：编辑器顶部统一运行入口。
 * package.json → 「运行脚本 ▾」可搜索菜单（第一版不直接执行默认脚本）；
 * 其他可运行文件（run-file 动作）→ 直接执行按钮。动作只传 action.id，执行统一走 Action Executor。
 * 弹层关闭只用 Escape + 外部点击，不监听滚动。
 */

import { ChevronDown, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../../i18n'
import { serializeRunActionCommand } from '../../lib/runActions/commandSerialization'
import type { RunAction } from '../../lib/runActions/types'

const MENU_MAX_VISIBLE_ITEMS = 12
const ITEM_HEIGHT_PX = 44

type EditorRunToolbarProps = {
  actions: RunAction[]
  onRunAction: (action: RunAction) => void
}

export function EditorRunToolbar({ actions, onRunAction }: EditorRunToolbarProps) {
  const { t } = useI18n()
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  // package-script 动作主导时（package.json 场景）使用菜单；否则视为单动作直接执行。
  const isScriptMenu = actions.length > 0 && actions.every((action) => action.execution.type === 'package-script')
  const singleAction = actions.length === 1 ? actions[0] : null

  const filteredActions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) return actions
    return actions.filter((action) => action.label.toLowerCase().includes(normalizedQuery))
  }, [actions, query])

  useEffect(() => {
    if (!isMenuOpen) return
    setActiveIndex(0)
    setQuery('')
    // 打开菜单后聚焦搜索框。
    window.setTimeout(() => inputRef.current?.focus(), 0)
  }, [isMenuOpen])

  // 外部点击关闭（不监听滚动）。
  useEffect(() => {
    if (!isMenuOpen) return
    const handlePointerDown = (event: MouseEvent) => {
      if (wrapperRef.current && event.target instanceof Node && !wrapperRef.current.contains(event.target)) {
        setIsMenuOpen(false)
      }
    }
    window.addEventListener('mousedown', handlePointerDown, true)
    return () => window.removeEventListener('mousedown', handlePointerDown, true)
  }, [isMenuOpen])

  useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(0, filteredActions.length - 1)))
  }, [filteredActions.length])

  // 键盘选中项滚入可视区。
  useEffect(() => {
    const list = listRef.current
    if (!list || !isMenuOpen) return
    const item = list.children[activeIndex] as HTMLElement | undefined
    item?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, isMenuOpen])

  if (actions.length === 0) return null

  const runFilteredAction = (action: RunAction) => {
    setIsMenuOpen(false)
    onRunAction(action)
  }

  const handleInputKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      setIsMenuOpen(false)
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (filteredActions.length > 0) setActiveIndex((index) => (index + 1) % filteredActions.length)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (filteredActions.length > 0) setActiveIndex((index) => (index - 1 + filteredActions.length) % filteredActions.length)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const action = filteredActions[activeIndex]
      if (action) runFilteredAction(action)
    }
  }

  return (
    <div ref={wrapperRef} className="pointer-events-auto relative inline-flex">
      {isScriptMenu ? (
        <button type="button" className="code-editor-preview-mode-btn" onClick={() => setIsMenuOpen((open) => !open)} title={t('codeWorkspace.runScriptMenu')}>
          {t('codeWorkspace.runScriptMenu')}
          <ChevronDown className="h-3 w-3 opacity-70" />
        </button>
      ) : singleAction ? (
        <button type="button" className="code-editor-preview-mode-btn" onClick={() => onRunAction(singleAction)} title={singleAction.label}>
          {t('codeWorkspace.runFileMenu')}
        </button>
      ) : null}
      {isScriptMenu && isMenuOpen && (
        <div
          className="app-no-drag absolute right-0 top-[calc(100%+8px)] z-50 flex flex-col overflow-hidden rounded-[14px] border border-[color:var(--color-border)] bg-[color:var(--color-popover)]/96 text-[color:var(--color-popover-foreground)] shadow-[var(--shadow-popover)] backdrop-blur-[22px]"
          style={{ width: 300 }}
        >
          <div className="flex items-center gap-2 border-b border-[color:var(--color-border)] px-3 py-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-muted-foreground)]" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder={t('codeWorkspace.searchScripts')}
              className="w-full bg-transparent text-[12.5px] text-[color:var(--color-foreground)] outline-none placeholder:text-[color:var(--color-muted-foreground)]"
            />
          </div>
          <div ref={listRef} className="max-h-[var(--editor-run-menu-max-h)] overflow-y-auto p-1" style={{ '--editor-run-menu-max-h': `${MENU_MAX_VISIBLE_ITEMS * ITEM_HEIGHT_PX}px` } as React.CSSProperties}>
            {filteredActions.length === 0 ? (
              <div className="px-3 py-3 text-center text-[12px] text-[color:var(--color-muted-foreground)]">{t('codeWorkspace.noMatchingScripts')}</div>
            ) : (
              filteredActions.map((action, index) => {
                const execution = action.execution
                const commandHint = execution.type === 'package-script' ? serializeRunActionCommand(action) : ''
                return (
                  <button
                    key={action.id}
                    type="button"
                    className={`flex w-full flex-col items-start gap-0.5 rounded-[9px] px-2.5 py-1.5 text-left transition-colors ${index === activeIndex ? 'bg-[color:var(--color-accent)]' : 'hover:bg-[color:var(--color-accent)]/60'}`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => runFilteredAction(action)}
                  >
                    <span className="w-full truncate text-[12.5px] text-[color:var(--color-foreground)]">{action.label}</span>
                    {commandHint && <span className="w-full truncate font-mono text-[11px] text-[color:var(--color-muted-foreground)]">{commandHint}</span>}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
