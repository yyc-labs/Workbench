import type { BrowserAiErrorCode } from '../../../shared/types'

export class BrowserAiServiceError extends Error {
  readonly code: BrowserAiErrorCode

  constructor(code: BrowserAiErrorCode, message: string) {
    super(message)
    this.name = 'BrowserAiServiceError'
    this.code = code
  }
}

export function classifyBrowserAiError(error: unknown): BrowserAiServiceError {
  if (error instanceof BrowserAiServiceError) return error
  const message = error instanceof Error ? error.message : String(error)
  const normalized = message.toLowerCase()

  if (normalized.includes('cancel')) return new BrowserAiServiceError('TASK_CANCELLED', 'The browser AI task was cancelled.')
  if (normalized.includes('executable') || normalized.includes('edge')) {
    return new BrowserAiServiceError('BROWSER_NOT_FOUND', 'Microsoft Edge could not be started.')
  }
  if (normalized.includes('cdp') || normalized.includes('connect') || normalized.includes('debugging')) {
    return new BrowserAiServiceError('CDP_UNAVAILABLE', 'The Edge debugging connection is unavailable.')
  }
  if (normalized.includes('login')) {
    return new BrowserAiServiceError('LOGIN_REQUIRED', 'Please sign in to the configured web AI site in the managed Edge profile.')
  }
  if (normalized.includes('composer') || normalized.includes('message input')) {
    return new BrowserAiServiceError('COMPOSER_NOT_FOUND', 'The web AI message composer could not be found.')
  }
  if (normalized.includes('submit') || normalized.includes('send')) {
    return new BrowserAiServiceError('SUBMIT_FAILED', 'The prompt could not be sent to the configured web AI site.')
  }
  if (normalized.includes('timed out') || normalized.includes('timeout') || normalized.includes('stabilize')) {
    return new BrowserAiServiceError('RESPONSE_TIMEOUT', 'The web AI site did not finish before the timeout.')
  }
  if (normalized.includes('quota') || normalized.includes('rate limit') || normalized.includes('site error')) {
    return new BrowserAiServiceError('SITE_LIMIT_OR_ERROR', 'The configured web AI site reported a limit or site error.')
  }
  if (normalized.includes('closed') || normalized.includes('disconnect')) {
    return new BrowserAiServiceError('BROWSER_DISCONNECTED', 'The Edge browser connection was closed.')
  }
  return new BrowserAiServiceError('UNKNOWN', 'The browser AI task could not be completed.')
}
