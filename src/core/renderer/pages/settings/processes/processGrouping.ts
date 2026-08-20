import type { ProcessPortInfo } from '../../../../shared/types'

/**
 * Process groups drive how the panel buckets listening-port processes.
 *
 * Extending to a new process type only requires appending an entry to
 * PROCESS_GROUPS (plus the matching i18n label). Processes that match no
 * known group automatically fall into the "other" fallback group.
 */
export type ProcessGroup = {
  key: string
  /** i18n key, resolved with t(group.labelKey) when rendering. */
  labelKey: string
  match: (process: ProcessPortInfo) => boolean
  order: number
}

export const PROCESS_GROUPS: ProcessGroup[] = [
  {
    key: 'node',
    labelKey: 'settingsProcesses.groupNode',
    match: (process) => /^(node|nodejs|node\.exe)$/i.test(process.name),
    order: 0,
  },
  // Future groups, e.g.:
  // {
  //   key: 'python',
  //   labelKey: 'settingsProcesses.groupPython',
  //   match: (process) => /^python([0-9.]*|w)?(\.exe)?$/i.test(process.name),
  //   order: 1,
  // },
]

export const FALLBACK_GROUP: ProcessGroup = {
  key: 'other',
  labelKey: 'settingsProcesses.groupOther',
  match: () => true,
  order: Number.MAX_SAFE_INTEGER,
}

export type ProcessGroupResult = {
  group: ProcessGroup
  items: ProcessPortInfo[]
}

export function groupProcessesByType(processes: ProcessPortInfo[]): ProcessGroupResult[] {
  const results = PROCESS_GROUPS.map((group) => ({ group, items: [] as ProcessPortInfo[] }))
  const fallback: ProcessGroupResult = { group: FALLBACK_GROUP, items: [] }

  for (const process of processes) {
    const matched = results.find((result) => result.group.match(process))
    ;(matched ?? fallback).items.push(process)
  }

  return [...results, fallback].filter((result) => result.items.length > 0)
}
