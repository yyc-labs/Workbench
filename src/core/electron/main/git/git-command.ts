import { spawn } from 'child_process'
import { StringDecoder } from 'string_decoder'
import { resolveWslVsCodeTarget } from '../shell/openers'
import { wslBridge } from '../wsl-bridge'
import type { GitOutputLimitInfo } from '../../../shared/types'

export const DEFAULT_GIT_OUTPUT_LIMIT_BYTES = 512 * 1024
export const DEFAULT_GIT_COMMAND_TIMEOUT_MS = 30_000
export const DEFAULT_GIT_OPERATION_TIMEOUT_MS = 120_000

type LimitedGitText = {
  text: string
  limitInfo?: GitOutputLimitInfo
}

export type GitCommandExecutionResult = {
  code: number | null
  stdout: string
  stderr: string
  stdoutLimit?: GitOutputLimitInfo
  stderrLimit?: GitOutputLimitInfo
}

type GitCommandLimits = {
  stdoutLimitBytes?: number
  stderrLimitBytes?: number
  timeoutMs?: number
}

type GitCommandSequenceResult = {
  ok: boolean
  command: string
  output: string
  exitCode: number | null
  error?: string
}

type GitCommandRunnerDependencies = {
  getDefaultWslDistro: () => string
}

function createLimitedUtf8Accumulator(limitBytes: number) {
  const decoder = new StringDecoder('utf8')
  let text = ''
  let totalBytes = 0
  let keptBytes = 0

  const pushChunk = (buf: Buffer) => {
    totalBytes += buf.length
    if (limitBytes <= 0 || keptBytes >= limitBytes) return
    const remainingBytes = limitBytes - keptBytes
    if (remainingBytes <= 0) return
    const chunk = buf.length <= remainingBytes ? buf : buf.subarray(0, remainingBytes)
    if (chunk.length <= 0) return
    text += decoder.write(chunk)
    keptBytes += chunk.length
  }

  const finish = (): LimitedGitText => {
    if (keptBytes < limitBytes) {
      text += decoder.end()
    } else {
      decoder.end()
    }
    if (totalBytes <= limitBytes) {
      return { text }
    }
    return {
      text,
      limitInfo: {
        limitBytes,
        totalBytes,
        keptBytes,
      },
    }
  }

  return { pushChunk, finish }
}

export function formatGitOutputLimitNotice(limit: GitOutputLimitInfo, label = 'output'): string {
  const omittedBytes = Math.max(0, limit.totalBytes - limit.keptBytes)
  return `[truncated ${label}: kept ${limit.keptBytes}/${limit.totalBytes} bytes, omitted ${omittedBytes} bytes]`
}

export function appendGitOutputLimitNotice(
  text: string,
  limit: GitOutputLimitInfo | undefined,
  label = 'output'
): string {
  if (!limit) return text
  const notice = formatGitOutputLimitNotice(limit, label)
  const base = text.replace(/\s+$/, '')
  return base ? `${base}\n${notice}` : notice
}

export function formatGitCommand(args: string[]): string {
  const escaped = args.map((arg) => (
    /\s/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg
  ))
  return `git ${escaped.join(' ')}`
}

export function normalizeGitOperationOutput(
  stdout: string,
  stderr: string,
  limits?: { stdoutLimit?: GitOutputLimitInfo; stderrLimit?: GitOutputLimitInfo }
): string {
  const segments: string[] = []
  const normalizedStdout = stdout.replace(/\r/g, '').trim()
  const normalizedStderr = stderr.replace(/\r/g, '').trim()
  if (normalizedStdout) {
    segments.push(appendGitOutputLimitNotice(normalizedStdout, limits?.stdoutLimit, 'stdout'))
  } else if (limits?.stdoutLimit) {
    segments.push(formatGitOutputLimitNotice(limits.stdoutLimit, 'stdout'))
  }
  if (normalizedStderr) {
    segments.push(appendGitOutputLimitNotice(normalizedStderr, limits?.stderrLimit, 'stderr'))
  } else if (limits?.stderrLimit) {
    segments.push(formatGitOutputLimitNotice(limits.stderrLimit, 'stderr'))
  }
  const normalized = segments.join('\n').trim()
  return normalized || '(no output)'
}

export function normalizeGitDiffOutput(output: string): string {
  return output.replace(/\r/g, '').trim()
}

export function createGitCommandRunner(deps: GitCommandRunnerDependencies) {
  const getDefaultWslDistro = () => deps.getDefaultWslDistro() || 'Ubuntu'

  function runGitCommand(cwd: string, args: string[], limits?: GitCommandLimits): Promise<GitCommandExecutionResult> {
    return new Promise((resolve) => {
      const stdoutAccumulator = createLimitedUtf8Accumulator(limits?.stdoutLimitBytes ?? Number.POSITIVE_INFINITY)
      const stderrAccumulator = createLimitedUtf8Accumulator(limits?.stderrLimitBytes ?? Number.POSITIVE_INFINITY)
      const timeoutMs = limits?.timeoutMs ?? DEFAULT_GIT_COMMAND_TIMEOUT_MS
      const wslTarget = process.platform === 'win32'
        ? resolveWslVsCodeTarget(cwd, getDefaultWslDistro())
        : null
      const useWslGit = Boolean(wslTarget && wslBridge.isAvailable())
      let settled = false
      let timedOut = false
      let timeout: NodeJS.Timeout | null = null
      let forceKillTimeout: NodeJS.Timeout | null = null

      const finish = (result: GitCommandExecutionResult) => {
        if (settled) return
        settled = true
        if (timeout) clearTimeout(timeout)
        if (forceKillTimeout) clearTimeout(forceKillTimeout)
        resolve(result)
      }

      const finishBuffers = (stderrFallback = ''): Omit<GitCommandExecutionResult, 'code'> => {
        const stdoutResult = stdoutAccumulator.finish()
        const stderrResult = stderrAccumulator.finish()
        const stderrParts = [stderrResult.text || stderrFallback]
        if (timedOut) {
          stderrParts.push(`Git command timed out after ${timeoutMs}ms.`)
        }
        return {
          stdout: stdoutResult.text,
          stderr: stderrParts.filter(Boolean).join('\n'),
          stdoutLimit: stdoutResult.limitInfo,
          stderrLimit: stderrResult.limitInfo,
        }
      }

      let child: ReturnType<typeof spawn>
      try {
        child = useWslGit
          ? spawn('wsl.exe', ['-d', wslTarget!.distro, '--cd', wslTarget!.linuxPath, 'git', ...args], {
            shell: false,
            stdio: ['ignore', 'pipe', 'pipe'],
          })
          : spawn('git', args, {
            cwd,
            shell: false,
            stdio: ['ignore', 'pipe', 'pipe'],
          })
      } catch (error) {
        const buffers = finishBuffers(error instanceof Error ? error.message : String(error))
        finish({
          code: null,
          ...buffers,
        })
        return
      }

      if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
        timeout = setTimeout(() => {
          timedOut = true
          child.kill('SIGTERM')
          forceKillTimeout = setTimeout(() => {
            child.kill('SIGKILL')
          }, 2_000)
        }, timeoutMs)
      }

      child.stdout?.on('data', (buf: Buffer) => {
        stdoutAccumulator.pushChunk(buf)
      })
      child.stderr?.on('data', (buf: Buffer) => {
        stderrAccumulator.pushChunk(buf)
      })

      child.on('error', (err) => {
        if (settled) return
        const buffers = finishBuffers(err.message)
        finish({
          code: null,
          ...buffers,
        })
      })
      child.on('close', (code) => {
        if (settled) return
        const buffers = finishBuffers()
        finish({
          code,
          ...buffers,
        })
      })
    })
  }

  function listGitLines(cwd: string, args: string[]): Promise<string[]> {
    return runGitCommand(cwd, args).then((result) => {
      if (result.code !== 0) return []
      return result.stdout
        .replace(/\r/g, '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    })
  }

  async function runGitCommandSequence(cwd: string, commandArgsList: string[][]): Promise<GitCommandSequenceResult> {
    const command = commandArgsList.map((args) => formatGitCommand(args)).join(' && ')
    const outputChunks: string[] = []

    for (const args of commandArgsList) {
      const execution = await runGitCommand(cwd, args, {
        stdoutLimitBytes: DEFAULT_GIT_OUTPUT_LIMIT_BYTES,
        stderrLimitBytes: DEFAULT_GIT_OUTPUT_LIMIT_BYTES,
        timeoutMs: DEFAULT_GIT_OPERATION_TIMEOUT_MS,
      })
      const stepOutput = normalizeGitOperationOutput(execution.stdout, execution.stderr, {
        stdoutLimit: execution.stdoutLimit,
        stderrLimit: execution.stderrLimit,
      })
      outputChunks.push(`$ ${formatGitCommand(args)}`)
      if (stepOutput !== '(no output)') {
        outputChunks.push(stepOutput)
      }
      if (execution.code !== 0) {
        return {
          ok: false,
          command,
          output: outputChunks.join('\n'),
          exitCode: execution.code,
          error: stepOutput,
        }
      }
    }

    return {
      ok: true,
      command,
      output: outputChunks.length > 0 ? outputChunks.join('\n') : '(no output)',
      exitCode: 0,
    }
  }

  return {
    runGitCommand,
    listGitLines,
    runGitCommandSequence,
  }
}

export type GitCommandRunner = ReturnType<typeof createGitCommandRunner>
