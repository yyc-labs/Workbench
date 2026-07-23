import type { App } from 'electron'

export type AppCleanupStep = {
  name: string
  run: () => void | Promise<void>
}

export type AppCleanupErrorHandler = (name: string, error: unknown) => void

export type AppStartupStep = {
  name: string
  run: () => void | Promise<void>
  rollback?: () => void | Promise<void>
}

export type AppLifecycleEventTarget = Pick<App, 'on'>

export type AppLifecycleHandlers = {
  onSecondInstance?: (...args: never[]) => unknown
  onBeforeQuit: (...args: never[]) => unknown
  onWillQuit?: (...args: never[]) => unknown
  onActivate?: (...args: never[]) => unknown
  onWindowAllClosed?: (...args: never[]) => unknown
}

/** Register process-level Electron events in one auditable place. */
export function registerAppLifecycle(target: AppLifecycleEventTarget, handlers: AppLifecycleHandlers): void {
  const on = target.on.bind(target) as unknown as (event: string, listener: (...args: never[]) => unknown) => unknown
  if (handlers.onSecondInstance) on('second-instance', handlers.onSecondInstance)
  on('before-quit', handlers.onBeforeQuit)
  if (handlers.onWillQuit) on('will-quit', handlers.onWillQuit)
  if (handlers.onActivate) on('activate', handlers.onActivate)
  if (handlers.onWindowAllClosed) on('window-all-closed', handlers.onWindowAllClosed)
}

/** Run shutdown work in order while allowing independent services to clean up. */
export async function runAppCleanupSteps(
  steps: readonly AppCleanupStep[],
  onError: AppCleanupErrorHandler = (name, error) => {
    console.warn(`[app-lifecycle] Cleanup step failed: ${name}`, error)
  },
): Promise<void> {
  for (const step of steps) {
    try {
      await step.run()
    } catch (error) {
      onError(step.name, error)
    }
  }
}

/** Run startup work transactionally and roll back successfully completed steps on failure. */
export async function runAppStartupSteps(
  steps: readonly AppStartupStep[],
  onError: (name: string, error: unknown) => void = (name, error) => {
    console.warn(`[app-lifecycle] Startup step failed: ${name}`, error)
  },
): Promise<void> {
  const completed: AppStartupStep[] = []
  for (const step of steps) {
    try {
      await step.run()
      completed.push(step)
    } catch (error) {
      onError(step.name, error)
      await runAppCleanupSteps(
        completed
          .slice()
          .reverse()
          .map((completedStep) => ({
            name: `rollback:${completedStep.name}`,
            run: completedStep.rollback ?? (() => undefined),
          })),
        onError,
      )
      throw error
    }
  }
}
