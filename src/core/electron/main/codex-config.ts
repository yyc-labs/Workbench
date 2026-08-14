import { readFile, mkdir, rename, rm, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import { loadConfig, updateConfig } from './config'
import { wslBridge } from './wsl-bridge'
import { readWindowsUserEnvVar, writeWindowsUserEnvVar } from './windows-env'
import { getCodexScopeCacheKey, resolveCodexScopeDescriptor } from '../../shared/codexScope'
import type {
  AiExecutionMode,
  Capability,
  CodexApprovalPolicy,
  CodexConfig,
  CodexEnvironmentScope,
  CodexModelProviderConfig,
  CodexSandboxMode,
  CodexSettingsInput,
  CodexSettingsSnapshot,
} from '../../shared/types'

const DEFAULT_CODEX_CONFIG: CodexConfig = {
  modelProvider: 'openai',
  model: 'gpt-5.4',
  modelReasoningEffort: 'xhigh',
  preferredAuthMethod: 'apikey',
  approvalPolicy: 'on-request',
  sandboxMode: 'workspace-write',
  approvalsReviewer: 'auto_review',
  modelProviders: {
    openai: {
      name: 'OpenAI',
      model: 'gpt-5.4',
      baseUrl: 'https://api.openai.com/v1',
      wireApi: 'responses',
      requiresOpenaiAuth: true,
      envKey: 'OPENAI_API_KEY',
    },
    aisz: {
      name: 'aisz',
      model: 'gpt-5.4',
      baseUrl: 'https://api.aisz.mom/v1',
      wireApi: 'responses',
      requiresOpenaiAuth: true,
      envKey: 'OPENAI_API_KEY',
    },
  },
}

const APPROVAL_POLICY_VALUES: CodexApprovalPolicy[] = ['untrusted', 'on-request', 'on-failure', 'never']
const SANDBOX_MODE_VALUES: CodexSandboxMode[] = ['read-only', 'workspace-write', 'danger-full-access']

const ALL_SUPPORTED_ROOT_KEYS = new Set([
  'model_provider',
  'model',
  'model_reasoning_effort',
  'preferred_auth_method',
  'approval_policy',
  'sandbox_mode',
  'approvals_reviewer',
])

const wslHomePathCache = new Map<string, string>()

function shellSingleQuote(input: string): string {
  return input.replace(/'/g, `'\\''`)
}

function tomlBasicString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function shellDoubleQuotedValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function normalizeString(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed || fallback
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
  }
  return fallback
}

function normalizeApprovalPolicy(value: unknown, fallback: CodexApprovalPolicy): CodexApprovalPolicy {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim()
  return APPROVAL_POLICY_VALUES.includes(normalized as CodexApprovalPolicy) ? (normalized as CodexApprovalPolicy) : fallback
}

function normalizeSandboxMode(value: unknown, fallback: CodexSandboxMode): CodexSandboxMode {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim()
  return SANDBOX_MODE_VALUES.includes(normalized as CodexSandboxMode) ? (normalized as CodexSandboxMode) : fallback
}

function normalizeProviderKey(value: string): string {
  return value.trim().replace(/\s+/g, '-')
}

function decodeShellExportValue(rawValue: string): string {
  const trimmed = rawValue.trim()
  if (!trimmed) return ''

  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }

  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1)
  }

  return trimmed.replace(/\s+#.*$/, '').trim()
}

function matchShellExportValue(content: string, envName: string): string | null {
  const pattern = new RegExp(`^\\s*export\\s+${envName}=(.*)$`, 'm')
  const match = content.match(pattern)
  return match ? decodeShellExportValue(match[1]) : null
}

function replaceOrAppendShellExport(content: string, envName: string, value: string): string {
  const line = `export ${envName}=${shellDoubleQuotedValue(value)}`
  const pattern = new RegExp(`^\\s*export\\s+${envName}=.*$`, 'm')
  if (pattern.test(content)) {
    return content.replace(pattern, line)
  }
  const suffix = content.endsWith('\n') || content.length === 0 ? '' : '\n'
  return `${content}${suffix}${line}\n`
}

function areStringRecordsEqual(a: Record<string, string> | undefined, b: Record<string, string> | undefined): boolean {
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])
  for (const key of keys) {
    if ((a?.[key] ?? '') !== (b?.[key] ?? '')) return false
  }
  return true
}

function areModelProvidersEqual(a: CodexConfig['modelProviders'], b: CodexConfig['modelProviders']): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    const left = a[key]
    const right = b[key]
    if (!left || !right) return false
    if (left.name !== right.name) return false
    if (left.model !== right.model) return false
    if (left.baseUrl !== right.baseUrl) return false
    if (left.wireApi !== right.wireApi) return false
    if (left.requiresOpenaiAuth !== right.requiresOpenaiAuth) return false
    if (left.envKey !== right.envKey) return false
  }
  return true
}

function areCodexConfigsEqual(a: CodexConfig, b: CodexConfig): boolean {
  return (
    a.modelProvider === b.modelProvider &&
    a.model === b.model &&
    a.modelReasoningEffort === b.modelReasoningEffort &&
    a.preferredAuthMethod === b.preferredAuthMethod &&
    a.approvalPolicy === b.approvalPolicy &&
    a.sandboxMode === b.sandboxMode &&
    a.approvalsReviewer === b.approvalsReviewer &&
    areModelProvidersEqual(a.modelProviders, b.modelProviders)
  )
}

function areScopesEqual(a: CodexEnvironmentScope, b: CodexEnvironmentScope): boolean {
  return a.target === b.target && a.hostPlatform === b.hostPlatform && a.runtimeMode === b.runtimeMode && a.homePath === b.homePath && a.configPath === b.configPath && a.envStorage === b.envStorage && a.envStoragePath === b.envStoragePath
}

function areCodexSettingsSnapshotsEqual(a: CodexSettingsSnapshot | undefined, b: CodexSettingsSnapshot): boolean {
  if (!a) return false
  return a.configExists === b.configExists && areScopesEqual(a.scope, b.scope) && areCodexConfigsEqual(a.config, b.config) && areStringRecordsEqual(a.providerApiKeys, b.providerApiKeys)
}

function normalizeProviderConfig(providerKey: string, value: Partial<CodexModelProviderConfig> | undefined, modelFallback: string): CodexModelProviderConfig {
  const defaults = DEFAULT_CODEX_CONFIG.modelProviders[providerKey]
  const fallback = defaults ?? {
    name: providerKey,
    model: modelFallback,
    baseUrl: '',
    wireApi: 'responses',
    requiresOpenaiAuth: true,
    envKey: 'OPENAI_API_KEY',
  }

  return {
    name: normalizeString(value?.name, fallback.name),
    model: normalizeString(value?.model, fallback.model || modelFallback),
    baseUrl: normalizeString(value?.baseUrl, fallback.baseUrl),
    wireApi: normalizeString(value?.wireApi, fallback.wireApi),
    requiresOpenaiAuth: normalizeBoolean(value?.requiresOpenaiAuth, fallback.requiresOpenaiAuth),
    envKey: normalizeString(value?.envKey, fallback.envKey),
  }
}

export function defaultCodexConfig(): CodexConfig {
  return {
    ...DEFAULT_CODEX_CONFIG,
    modelProviders: Object.fromEntries(Object.entries(DEFAULT_CODEX_CONFIG.modelProviders).map(([key, value]) => [key, { ...value }])),
  }
}

export function normalizeCodexConfig(input: Partial<CodexConfig> | Record<string, unknown>): CodexConfig {
  const defaults = defaultCodexConfig()
  const modelFallback = normalizeString(input.model, defaults.model)
  const rawProviders = input.modelProviders && typeof input.modelProviders === 'object' ? (input.modelProviders as Record<string, Partial<CodexModelProviderConfig>>) : {}

  const normalizedProviders = Object.fromEntries(
    Object.entries(rawProviders)
      .map(([rawKey, rawProvider]) => {
        const key = normalizeProviderKey(rawKey)
        if (!key) return null
        return [key, normalizeProviderConfig(key, rawProvider, modelFallback)] as const
      })
      .filter((entry): entry is readonly [string, CodexModelProviderConfig] => Boolean(entry)),
  )

  const modelProviders = Object.keys(normalizedProviders).length > 0 ? normalizedProviders : defaults.modelProviders

  const modelProvider = normalizeString(input.modelProvider, defaults.modelProvider)
  const resolvedModelProvider = modelProviders[modelProvider] ? modelProvider : Object.keys(modelProviders)[0]!
  const approvalPolicy = normalizeApprovalPolicy(input.approvalPolicy, defaults.approvalPolicy)
  const sandboxMode = normalizeSandboxMode(input.sandboxMode, defaults.sandboxMode)

  return {
    modelProvider: resolvedModelProvider,
    model: normalizeString(normalizedProviders[resolvedModelProvider]?.model, modelFallback),
    modelReasoningEffort: normalizeString(input.modelReasoningEffort, defaults.modelReasoningEffort),
    preferredAuthMethod: normalizeString(input.preferredAuthMethod, defaults.preferredAuthMethod),
    approvalPolicy,
    sandboxMode: approvalPolicy === 'never' ? 'danger-full-access' : sandboxMode,
    approvalsReviewer: normalizeString(input.approvalsReviewer, defaults.approvalsReviewer),
    modelProviders,
  }
}

function getRuntimeMode(): AiExecutionMode {
  return loadConfig().aiEnvironment?.mode ?? 'disabled'
}

async function resolveWslHomePath(): Promise<string> {
  const distro = wslBridge.getDistro()
  const cached = wslHomePathCache.get(distro)
  if (cached) return cached
  try {
    const homePath = await wslBridge.exec('printf %s "$HOME"', 15000)
    const resolved = homePath.trim() || '/home/ubuntu'
    wslHomePathCache.set(distro, resolved)
    return resolved
  } catch {
    const fallback = '/home/ubuntu'
    wslHomePathCache.set(distro, fallback)
    return fallback
  }
}

export async function resolveCodexEnvironmentScope(capability: Capability | null): Promise<CodexEnvironmentScope> {
  const runtimeMode = getRuntimeMode()
  const descriptor = resolveCodexScopeDescriptor(capability, loadConfig().aiEnvironment)

  if (descriptor.target === 'wsl' && capability?.hostPlatform === 'windows') {
    const homePath = await resolveWslHomePath()
    return {
      target: 'wsl',
      hostPlatform: descriptor.hostPlatform,
      runtimeMode,
      homePath,
      configPath: `${homePath}/.codex/config.toml`,
      envStorage: 'bashrc',
      envStoragePath: `${homePath}/.bashrc`,
    }
  }

  const homePath = homedir()
  return {
    target: 'native',
    hostPlatform: descriptor.hostPlatform,
    runtimeMode,
    homePath,
    configPath: join(homePath, '.codex', 'config.toml'),
    envStorage: process.platform === 'win32' ? 'windows-user-env' : 'bashrc',
    envStoragePath: process.platform === 'win32' ? 'HKCU\\Environment' : join(homePath, '.bashrc'),
  }
}

async function readTextFile(scope: CodexEnvironmentScope, targetPath: string): Promise<string> {
  if (scope.target === 'wsl') {
    const escaped = shellSingleQuote(targetPath)
    return wslBridge.exec(`[ -f '${escaped}' ] && cat '${escaped}' || true`, 15000)
  }
  return readFile(targetPath, 'utf-8')
}

function buildTempFilePath(targetPath: string): string {
  return `${targetPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

async function ensureBackupFile(scope: CodexEnvironmentScope, targetPath: string): Promise<void> {
  const backupPath = `${targetPath}.bak`

  if (scope.target === 'wsl') {
    const escapedTarget = shellSingleQuote(targetPath)
    const escapedBackup = shellSingleQuote(backupPath)
    await wslBridge.exec(`[ -f '${escapedTarget}' ] && [ ! -f '${escapedBackup}' ] && cp '${escapedTarget}' '${escapedBackup}' || true`, 15000)
    return
  }

  if (!existsSync(targetPath) || existsSync(backupPath)) {
    return
  }

  const current = await readFile(targetPath, 'utf-8')
  await writeFile(backupPath, current, 'utf-8')
}

async function writeTextFile(scope: CodexEnvironmentScope, targetPath: string, content: string): Promise<void> {
  if (scope.target === 'wsl') {
    const dirPath = targetPath.slice(0, targetPath.lastIndexOf('/'))
    const escapedDir = shellSingleQuote(dirPath)
    const escapedFile = shellSingleQuote(targetPath)
    const tempPath = buildTempFilePath(targetPath)
    const escapedTempFile = shellSingleQuote(tempPath)
    const payloadBase64 = Buffer.from(content, 'utf-8').toString('base64')
    await ensureBackupFile(scope, targetPath)
    await wslBridge.exec(`mkdir -p '${escapedDir}' && printf '%s' '${payloadBase64}' | base64 -d > '${escapedTempFile}' && mv '${escapedTempFile}' '${escapedFile}'`, 15000)
    return
  }

  await mkdir(dirname(targetPath), { recursive: true })
  await ensureBackupFile(scope, targetPath)
  const tempPath = buildTempFilePath(targetPath)
  try {
    await writeFile(tempPath, content, 'utf-8')
    await rename(tempPath, targetPath)
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }
}

async function pathExists(scope: CodexEnvironmentScope, targetPath: string): Promise<boolean> {
  if (scope.target === 'wsl') {
    try {
      const output = await wslBridge.exec(`[ -f '${shellSingleQuote(targetPath)}' ] && echo 1 || echo 0`, 15000)
      return output.trim() === '1'
    } catch {
      return false
    }
  }
  return existsSync(targetPath)
}

function parseTomlValue(rawValue: string): string | boolean {
  const trimmed = rawValue.trim()
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
  return trimmed
}

function parseCodexToml(content: string): CodexConfig {
  const defaults = defaultCodexConfig()
  const rootValues: Record<string, string | boolean> = {}
  const providers: Record<string, Partial<CodexModelProviderConfig>> = {}
  let currentProviderKey: string | null = null

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const tableMatch = trimmed.match(/^\[model_providers\.([^\]]+)\]$/)
    if (tableMatch) {
      currentProviderKey = normalizeProviderKey(tableMatch[1] ?? '')
      if (currentProviderKey && !providers[currentProviderKey]) {
        providers[currentProviderKey] = {}
      }
      continue
    }

    if (trimmed.startsWith('[')) {
      currentProviderKey = null
      continue
    }

    const entryMatch = trimmed.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/)
    if (!entryMatch) continue

    const rawKey = entryMatch[1] ?? ''
    const rawValue = parseTomlValue(entryMatch[2] ?? '')

    if (currentProviderKey) {
      const target = providers[currentProviderKey] ?? {}
      if (rawKey === 'name') target.name = String(rawValue)
      if (rawKey === 'model') target.model = String(rawValue)
      if (rawKey === 'base_url') target.baseUrl = String(rawValue)
      if (rawKey === 'wire_api') target.wireApi = String(rawValue)
      if (rawKey === 'requires_openai_auth') target.requiresOpenaiAuth = Boolean(rawValue)
      if (rawKey === 'env_key') target.envKey = String(rawValue)
      providers[currentProviderKey] = target
      continue
    }

    if (ALL_SUPPORTED_ROOT_KEYS.has(rawKey)) {
      rootValues[rawKey] = rawValue
    }
  }

  return normalizeCodexConfig({
    modelProvider: typeof rootValues.model_provider === 'string' ? rootValues.model_provider : defaults.modelProvider,
    model: typeof rootValues.model === 'string' ? rootValues.model : defaults.model,
    modelReasoningEffort: typeof rootValues.model_reasoning_effort === 'string' ? rootValues.model_reasoning_effort : defaults.modelReasoningEffort,
    preferredAuthMethod: typeof rootValues.preferred_auth_method === 'string' ? rootValues.preferred_auth_method : defaults.preferredAuthMethod,
    approvalPolicy: typeof rootValues.approval_policy === 'string' ? rootValues.approval_policy : defaults.approvalPolicy,
    sandboxMode: typeof rootValues.sandbox_mode === 'string' ? rootValues.sandbox_mode : defaults.sandboxMode,
    approvalsReviewer: typeof rootValues.approvals_reviewer === 'string' ? rootValues.approvals_reviewer : defaults.approvalsReviewer,
    modelProviders: providers,
  })
}

function buildCodexManagedToml(config: CodexConfig): string {
  const lines: string[] = [
    `model_provider = ${tomlBasicString(config.modelProvider)}`,
    `model = ${tomlBasicString(config.model)}`,
    `model_reasoning_effort = ${tomlBasicString(config.modelReasoningEffort)}`,
    `preferred_auth_method = ${tomlBasicString(config.preferredAuthMethod)}`,
    `approval_policy = ${tomlBasicString(config.approvalPolicy)}`,
    `sandbox_mode = ${tomlBasicString(config.sandboxMode)}`,
    `approvals_reviewer = ${tomlBasicString(config.approvalsReviewer)}`,
    '',
  ]

  for (const [providerKey, provider] of Object.entries(config.modelProviders)) {
    lines.push(`[model_providers.${providerKey}]`)
    lines.push(`name = ${tomlBasicString(provider.name)}`)
    lines.push(`model = ${tomlBasicString(provider.model)}`)
    lines.push(`base_url = ${tomlBasicString(provider.baseUrl)}`)
    lines.push(`wire_api = ${tomlBasicString(provider.wireApi)}`)
    lines.push(`requires_openai_auth = ${provider.requiresOpenaiAuth ? 'true' : 'false'}`)
    lines.push(`env_key = ${tomlBasicString(provider.envKey)}`)
    lines.push('')
  }

  return lines.join('\n').trimEnd() + '\n'
}

function mergeCodexToml(existingContent: string, config: CodexConfig): string {
  const managedContent = buildCodexManagedToml(config)
  const lines = existingContent.split(/\r?\n/)
  const preservedLines: string[] = []
  let currentTableName: string | null = null
  let skipProviderBlock = false

  for (const line of lines) {
    const trimmed = line.trim()

    const tableMatch = trimmed.match(/^\[([^\]]+)\]$/)
    if (tableMatch) {
      currentTableName = tableMatch[1] ?? null
      skipProviderBlock = currentTableName?.startsWith('model_providers.') ?? false
      if (!skipProviderBlock) {
        preservedLines.push(line)
      }
      continue
    }

    if (skipProviderBlock) continue

    const rootKeyMatch = currentTableName === null ? trimmed.match(/^([A-Za-z0-9_]+)\s*=/) : null
    if (rootKeyMatch && ALL_SUPPORTED_ROOT_KEYS.has(rootKeyMatch[1] ?? '')) {
      continue
    }

    preservedLines.push(line)
  }

  const extra = preservedLines.join('\n').trim()
  if (!extra) return managedContent
  return `${managedContent}\n${extra}\n`
}

function hasAllManagedCodexRootKeys(content: string): boolean {
  const presentKeys = new Set<string>()
  let currentTableName: string | null = null

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const tableMatch = trimmed.match(/^\[([^\]]+)\]$/)
    if (tableMatch) {
      currentTableName = tableMatch[1] ?? null
      continue
    }

    if (currentTableName !== null) continue

    const rootKeyMatch = trimmed.match(/^([A-Za-z0-9_]+)\s*=/)
    if (rootKeyMatch && ALL_SUPPORTED_ROOT_KEYS.has(rootKeyMatch[1] ?? '')) {
      presentKeys.add(rootKeyMatch[1] ?? '')
    }
  }

  return Array.from(ALL_SUPPORTED_ROOT_KEYS).every((key) => presentKeys.has(key))
}

async function readOpenAiApiKey(scope: CodexEnvironmentScope): Promise<string> {
  if (scope.target === 'wsl') {
    const output = await wslBridge.execBashInteractiveLogin('printf %s "${OPENAI_API_KEY:-}"', 15000)
    return output.trim()
  }

  if (scope.hostPlatform === 'windows') {
    return (await readWindowsUserEnvVar('OPENAI_API_KEY')).trim()
  }

  try {
    const bashrc = await readTextFile(scope, scope.envStoragePath)
    const value = matchShellExportValue(bashrc, 'OPENAI_API_KEY')
    if (value === null) return (process.env.OPENAI_API_KEY ?? '').trim()
    return value.trim()
  } catch {
    return (process.env.OPENAI_API_KEY ?? '').trim()
  }
}

function normalizeProviderApiKeys(providerApiKeys: Record<string, string> | undefined, modelProviders: CodexConfig['modelProviders']): Record<string, string> {
  const keys = Object.keys(modelProviders)
  const normalized: Record<string, string> = {}

  for (const key of keys) {
    normalized[key] = providerApiKeys?.[key]?.trim() ?? ''
  }

  return normalized
}

async function persistCodexSettingsSnapshot(snapshot: CodexSettingsSnapshot): Promise<void> {
  try {
    const currentConfig = loadConfig()
    const scopeKey = getCodexScopeCacheKey(snapshot.scope)
    const currentProviderApiKeys = normalizeProviderApiKeys(currentConfig.codexProviderApiKeys?.[scopeKey], snapshot.config.modelProviders)
    const currentSnapshot = currentConfig.codexSettingsSnapshots?.[scopeKey]

    if (areStringRecordsEqual(currentProviderApiKeys, snapshot.providerApiKeys) && areCodexSettingsSnapshotsEqual(currentSnapshot, snapshot)) {
      return
    }

    const nextProviderApiKeys = {
      ...(currentConfig.codexProviderApiKeys ?? {}),
      [scopeKey]: snapshot.providerApiKeys,
    }
    const nextSnapshots = {
      ...(currentConfig.codexSettingsSnapshots ?? {}),
      [scopeKey]: snapshot,
    }

    await updateConfig({
      codexProviderApiKeys: nextProviderApiKeys,
      codexSettingsSnapshots: nextSnapshots,
    })
  } catch {
    // In tests or early boot, app userData may be unavailable; persistence is best-effort.
  }
}

async function writeOpenAiApiKey(scope: CodexEnvironmentScope, value: string): Promise<void> {
  if (scope.envStorage === 'windows-user-env') {
    await writeWindowsUserEnvVar('OPENAI_API_KEY', value)
    return
  }

  let shellConfig = ''
  try {
    shellConfig = await readTextFile(scope, scope.envStoragePath)
  } catch {
    shellConfig = ''
  }

  if (matchShellExportValue(shellConfig, 'OPENAI_API_KEY') === value) {
    process.env.OPENAI_API_KEY = value
    return
  }

  const updated = replaceOrAppendShellExport(shellConfig, 'OPENAI_API_KEY', value)
  if (updated === shellConfig) {
    process.env.OPENAI_API_KEY = value
    return
  }
  await writeTextFile(scope, scope.envStoragePath, updated)
  process.env.OPENAI_API_KEY = value
}

export async function readCodexSettings(capability: Capability | null): Promise<CodexSettingsSnapshot> {
  const scope = await resolveCodexEnvironmentScope(capability)
  const configExists = await pathExists(scope, scope.configPath)
  const rawConfig = configExists ? await readTextFile(scope, scope.configPath).catch(() => '') : ''
  const config = rawConfig.trim() ? parseCodexToml(rawConfig) : defaultCodexConfig()
  let nextConfigExists = configExists

  if (!configExists || !hasAllManagedCodexRootKeys(rawConfig)) {
    const nextToml = configExists ? mergeCodexToml(rawConfig, config) : buildCodexManagedToml(config)
    if (nextToml !== rawConfig) {
      try {
        await writeTextFile(scope, scope.configPath, nextToml)
        nextConfigExists = true
      } catch {
        // Best-effort persistence; the settings UI can still function if the write fails.
      }
    }
  }

  const scopeKey = getCodexScopeCacheKey(scope)
  const storedProviderApiKeysByScope = loadConfig().codexProviderApiKeys ?? {}
  const storedProviderApiKeys = normalizeProviderApiKeys(storedProviderApiKeysByScope[scopeKey], config.modelProviders)
  const activeProviderKey = config.modelProvider
  const activeProviderApiKey = await readOpenAiApiKey(scope)
  const providerApiKeys = {
    ...storedProviderApiKeys,
    [activeProviderKey]: activeProviderApiKey,
  }
  const snapshot = {
    scope,
    providerApiKeys,
    configExists: nextConfigExists,
    config,
  }

  return snapshot
}

export async function writeCodexSettings(capability: Capability | null, input: CodexSettingsInput): Promise<CodexSettingsSnapshot> {
  const scope = await resolveCodexEnvironmentScope(capability)
  const normalizedConfig = normalizeCodexConfig(input.config)
  const normalizedProviderApiKeys = normalizeProviderApiKeys(input.providerApiKeys, normalizedConfig.modelProviders)
  const existingContent = await readTextFile(scope, scope.configPath).catch(() => '')
  const existingConfig = existingContent.trim() ? parseCodexToml(existingContent) : null
  const shouldWriteConfig = !existingConfig || !areCodexConfigsEqual(existingConfig, normalizedConfig)

  if (shouldWriteConfig) {
    const nextToml = existingContent.trim() ? mergeCodexToml(existingContent, normalizedConfig) : buildCodexManagedToml(normalizedConfig)
    if (nextToml !== existingContent) {
      await writeTextFile(scope, scope.configPath, nextToml)
    }
  }

  await writeOpenAiApiKey(scope, normalizedProviderApiKeys[normalizedConfig.modelProvider] ?? '')
  const snapshot = {
    scope,
    providerApiKeys: normalizedProviderApiKeys,
    configExists: true,
    config: normalizedConfig,
  }
  await persistCodexSettingsSnapshot(snapshot)
  return snapshot
}
