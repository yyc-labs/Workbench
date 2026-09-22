import type * as Monaco from 'monaco-editor'

// Monaco 内置 TS 语言服务默认未开启 JSX（compilerOptions.jsx = None），.tsx/.jsx
// 文件会报 "Cannot use JSX unless the '--jsx' flag is provided."。同时 worker 不加载
// 项目 node_modules，语义校验只会产生 "Cannot find module" 一类假报错，这里统一关闭，
// 仅保留语法校验。
let monacoTypeScriptDefaultsConfigured = false

export function configureMonacoTypeScriptDefaults(monaco: typeof Monaco): void {
  if (monacoTypeScriptDefaultsConfigured) return
  monacoTypeScriptDefaultsConfigured = true

  // Monaco 0.55 起 languages.typescript 在类型层废弃，TS 语言服务改由顶层 typescript 命名空间导出。
  const ts = monaco.typescript
  const compilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    jsx: ts.JsxEmit.ReactJSX,
    allowJs: true,
    checkJs: false,
    allowNonTsExtensions: true,
    allowSyntheticDefaultImports: true,
    esModuleInterop: true,
    skipLibCheck: true,
  }

  ts.typescriptDefaults.setCompilerOptions(compilerOptions)
  ts.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: false,
  })

  ts.javascriptDefaults.setCompilerOptions(compilerOptions)
  ts.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: false,
  })
}
