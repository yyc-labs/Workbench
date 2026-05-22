import type { ComponentType } from 'react'

function InfoCard({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: string
  icon: ComponentType<{ className?: string; strokeWidth?: string | number }>
}) {
  return (
    <div className="rounded-[16px] px-4 py-3 quiet-control">
      <div className="mb-2 flex items-center gap-1.5 text-[color:var(--color-muted-foreground)]">
        <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
        <span className="section-label">{label}</span>
      </div>
      <p className="truncate text-[13px] font-medium text-[color:var(--color-foreground)]" title={value}>
        {value}
      </p>
    </div>
  )
}

export { InfoCard }
