import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n'
import { normalizeStructuredPreviewTableWidth, readStructuredPreviewTableWidth, saveStructuredPreviewTableWidth, STRUCTURED_PREVIEW_TABLE_WIDTH_MAX, STRUCTURED_PREVIEW_TABLE_WIDTH_MIN, STRUCTURED_PREVIEW_TABLE_WIDTH_STEP } from '../lib/structuredPreviewTableWidth'

/**
 * 表格弹窗宽度偏好：0 表示不限制（自动）。
 * 写入即持久化到 localStorage，所有结构化预览弹窗共用同一设置。
 */
export function useStructuredPreviewTableWidth(): [number, (width: number) => void] {
  const [width, setWidth] = useState<number>(() => readStructuredPreviewTableWidth())
  const commit = useCallback((next: number) => {
    const normalized = normalizeStructuredPreviewTableWidth(next)
    setWidth(normalized)
    saveStructuredPreviewTableWidth(normalized)
  }, [])
  return [width, commit]
}

type StructuredPreviewTableWidthControlProps = {
  value: number
  onChange: (width: number) => void
}

export function StructuredPreviewTableWidthControl({ value, onChange }: StructuredPreviewTableWidthControlProps) {
  const { t } = useI18n()
  const inputRef = useRef<HTMLInputElement | null>(null)

  // React 对 wheel 合成事件使用 passive listener，无法 preventDefault，
  // 因此用原生 listener 实现滚轮步进并阻止弹窗内容滚动。
  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const parsed = Number.parseInt(input.value, 10)
      const current = Number.isFinite(parsed) && parsed > 0 ? parsed : 0
      let next: number
      if (event.deltaY < 0) {
        // 向上：自动(0) → 最小值，之后按步进递增
        next = current <= 0 ? STRUCTURED_PREVIEW_TABLE_WIDTH_MIN : current + STRUCTURED_PREVIEW_TABLE_WIDTH_STEP
      } else {
        // 向下：低于最小值时归零回到"自动"
        next = current - STRUCTURED_PREVIEW_TABLE_WIDTH_STEP < STRUCTURED_PREVIEW_TABLE_WIDTH_MIN ? 0 : current - STRUCTURED_PREVIEW_TABLE_WIDTH_STEP
      }
      onChange(next)
    }
    input.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      input.removeEventListener('wheel', onWheel)
    }
  }, [onChange])

  return (
    <label className="quiet-control inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border-0 px-2.5 text-xs text-[color:var(--color-muted-foreground)]" title={t('codeWorkspace.tablePreviewWidthHint')}>
      <span className="whitespace-nowrap">{t('codeWorkspace.tablePreviewWidthLabel')}</span>
      <input
        ref={inputRef}
        type="number"
        min={0}
        max={STRUCTURED_PREVIEW_TABLE_WIDTH_MAX}
        step={STRUCTURED_PREVIEW_TABLE_WIDTH_STEP}
        value={value > 0 ? value : ''}
        placeholder={t('codeWorkspace.tablePreviewWidthAuto')}
        spellCheck={false}
        onChange={(event) => {
          const parsed = Number.parseInt(event.target.value, 10)
          onChange(Number.isFinite(parsed) ? parsed : 0)
        }}
        onBlur={(event) => {
          const parsed = Number.parseInt(event.target.value, 10)
          onChange(Number.isFinite(parsed) ? parsed : 0)
        }}
        className="w-14 bg-transparent text-right text-xs tabular-nums text-[color:var(--color-foreground)] outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <span className="whitespace-nowrap">px</span>
    </label>
  )
}
