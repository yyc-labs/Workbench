import type { QuickActionErrorCode, QuickActionResult } from '../../shared/types'

/**
 * Quick action execution feedback mapping.
 *
 * Pure function: the caller injects the translate function so the mapping stays
 * testable without the i18n runtime. Success messages branch on `kind`; failures
 * branch on the error code, with the raw error text as description.
 */

export type TranslateFn = (key: string, values?: Record<string, string | number>) => string

export type QuickActionFeedback = {
  kind: 'success' | 'error'
  message: string
  description?: string
}

const ERROR_MESSAGE_KEYS: Record<QuickActionErrorCode, string> = {
  'not-found': 'quickActions.error.not-found',
  disabled: 'quickActions.error.disabled',
  'invalid-project': 'quickActions.error.invalid-project',
  'invalid-task': 'quickActions.error.invalid-task',
  'invalid-spec': 'quickActions.error.invalid-spec',
  'exec-failed': 'quickActions.error.exec-failed',
}

export function describeQuickActionResult(t: TranslateFn, result: QuickActionResult): QuickActionFeedback {
  if (result.ok) {
    switch (result.kind) {
      case 'navigated':
        return { kind: 'success', message: t('quickActions.result.navigated') }
      case 'task-started':
        return { kind: 'success', message: t('quickActions.result.taskStarted') }
      case 'opened':
        return { kind: 'success', message: t('quickActions.result.opened') }
    }
  }
  return {
    kind: 'error',
    message: t(ERROR_MESSAGE_KEYS[result.code]),
    ...(result.error ? { description: result.error } : {}),
  }
}
