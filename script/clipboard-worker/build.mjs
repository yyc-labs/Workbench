// 编译剪贴板 worker（ClipboardWorker.cs → bin/ClipboardWorker.exe）。
// 使用系统自带的 .NET Framework csc，无第三方依赖；失败时非零退出。
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const sourcePath = path.join(scriptDir, 'ClipboardWorker.cs')
const outDir = path.join(scriptDir, 'bin')
const outPath = path.join(outDir, 'ClipboardWorker.exe')

const CANDIDATE_CSC_PATHS = ['C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe', 'C:/Windows/Microsoft.NET/Framework/v4.0.30319/csc.exe']

function locateCsc() {
  for (const candidate of CANDIDATE_CSC_PATHS) {
    if (existsSync(candidate)) return candidate
  }
  throw new Error(`csc.exe not found in candidates: ${CANDIDATE_CSC_PATHS.join(', ')}`)
}

function main() {
  if (!existsSync(sourcePath)) {
    throw new Error(`Source not found: ${sourcePath}`)
  }

  const csc = locateCsc()
  mkdirSync(outDir, { recursive: true })
  execFileSync(csc, ['/nologo', '/target:exe', '/platform:anycpu', '/r:System.dll', '/r:System.Windows.Forms.dll', `/out:${outPath}`, sourcePath], { stdio: 'inherit' })

  if (!existsSync(outPath)) {
    throw new Error(`Compiler reported success but output is missing: ${outPath}`)
  }
  console.log(`[clipboard-worker] built: ${outPath}`)
}

try {
  main()
} catch (error) {
  console.error(`[clipboard-worker] build failed: ${error.message}`)
  process.exit(1)
}
