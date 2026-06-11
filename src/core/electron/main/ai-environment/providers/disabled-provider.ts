import type { RuntimeDiagnostics } from '../../../../shared/types'
import type { AiExecutionProvider } from '../provider-types'

export const disabledProvider: AiExecutionProvider = {
  mode: 'disabled',
  label: 'Disabled',

  isSupported() {
    return true
  },

  async diagnose(context): Promise<RuntimeDiagnostics> {
    return {
      checkedAt: Date.now(),
      mode: 'disabled',
      providerLabel: this.label,
      runtimeEntrypoint: context.config.runtimeEntrypoint,
      supported: true,
      hasWsl: context.capability.hasWsl,
      hasTmux: context.capability.hasTmux,
      shell: context.config.shell,
      issues: ['Managed Runtime is disabled for the current mode'],
    }
  },

  async resolveRuntimeLaunch() {
    throw new Error('Managed Runtime is disabled')
  },

  async resolveAiCommitLaunch() {
    throw new Error('AI Commit launch is disabled for the current mode')
  },
}
