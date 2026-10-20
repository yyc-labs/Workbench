import { Plus, X } from 'lucide-react'
import { useMemo } from 'react'
import { Button } from '../../../components/ui/button'
import { Select, type SelectOption } from '../../../components/ui/select'
import { useI18n } from '../../../i18n'

/**
 * 定时时间点编辑器（项目风格封装）：替代原生 input[type=time]。
 * 每个时间点一对时/分 Select（quiet-control 视觉体系）+ 移除按钮；
 * 支持同一天多个时间点，值始终为非空、去重、升序的 'HH:mm' 列表。
 */

/** 单日时间点数量上限，与主进程 normalize 的 MAX_SCHEDULE_TIMES 对齐。 */
export const MAX_SCHEDULE_TIMES = 8

type QuickActionTimesFieldProps = {
  /** 已规范化的 'HH:mm' 列表（升序）。 */
  value: string[]
  onChange: (times: string[]) => void
  /** 下拉层级；在 ModalShell 内需高于面板 z-index。 */
  contentZIndex?: number
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function compareTimes(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** 在现有时间点之后找一个空闲的整点作为新时间点默认值。 */
function nextFreeTime(value: readonly string[]): string {
  const existing = new Set(value)
  const last = value[value.length - 1] ?? '09:00'
  const hour = Number(last.split(':')[0])
  for (let step = 1; step <= 24; step++) {
    const candidate = `${pad2((hour + step) % 24)}:00`
    if (!existing.has(candidate)) return candidate
  }
  return '12:00'
}

export function QuickActionTimesField({ value, onChange, contentZIndex }: QuickActionTimesFieldProps) {
  const { t } = useI18n()

  const hourOptions = useMemo<SelectOption[]>(() => Array.from({ length: 24 }, (_, index) => ({ value: pad2(index), label: pad2(index) })), [])
  const minuteOptions = useMemo<SelectOption[]>(() => Array.from({ length: 60 }, (_, index) => ({ value: pad2(index), label: pad2(index) })), [])

  const replace = (index: number, next: string) => {
    const times = value.slice()
    times[index] = next
    onChange(Array.from(new Set(times)).sort(compareTimes))
  }

  const remove = (index: number) => {
    onChange(value.filter((_, item) => item !== index))
  }

  const add = () => {
    onChange([...value, nextFreeTime(value)].sort(compareTimes))
  }

  return (
    <div className="space-y-2">
      {value.map((time, index) => {
        const [hour, minute] = time.split(':')
        return (
          <div key={`${time}-${index}`} className="flex items-center gap-2">
            <Select ariaLabel={t('quickActions.schedule.timesLabel')} value={hour} options={hourOptions} onChange={(next) => replace(index, `${next}:${minute}`)} className="w-[92px]" contentZIndex={contentZIndex} />
            <span className="text-sm font-medium text-[color:var(--color-muted-foreground)]">:</span>
            <Select ariaLabel={t('quickActions.schedule.timesLabel')} value={minute} options={minuteOptions} onChange={(next) => replace(index, `${hour}:${next}`)} className="w-[92px]" contentZIndex={contentZIndex} />
            <button
              type="button"
              onClick={() => remove(index)}
              // 至少保留一个时间点：清空定时请改用上方的启用开关。
              disabled={value.length <= 1}
              title={t('quickActions.schedule.removeTime')}
              aria-label={t('quickActions.schedule.removeTime')}
              className="button-interactive flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] hover:bg-destructive/10 hover:text-destructive disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[color:var(--color-muted-foreground)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )
      })}
      <Button type="button" variant="outline" size="sm" onClick={add} disabled={value.length >= MAX_SCHEDULE_TIMES} className="gap-1.5">
        <Plus className="h-4 w-4" />
        {t('quickActions.schedule.addTime')}
      </Button>
    </div>
  )
}
