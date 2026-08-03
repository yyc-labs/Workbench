# IDE Electron

一个面向本地开发工作流的 Windows 桌面 IDE。它将项目管理、代码浏览、Git 操作、AI CLI Runtime、会话记录和 Markdown 文档工作区集中在一个 Electron 应用中。

## 功能

- 项目管理：添加、移除和切换本地项目，保存最近打开记录。
- 代码工作区：项目文件树、代码编辑与 Markdown 预览。
- Git 工作流：查看项目状态，执行常用 Git 操作。
- AI Runtime：管理 Codex、Claude 等本地 AI CLI，支持项目级 Runtime 配置和会话状态。
- AI Gateway：统一管理 AI Provider、模型路由和 Codex 连接配置。
- Transcript：导入、查看和管理 AI CLI 会话记录。
- 学习中心：管理学习内容、技能和浏览器辅助能力。
- Markdown 工作区：直接打开 Markdown 文件，支持 GFM、代码高亮、Mermaid 和表格预览。
- 浏览器截图：捕获网页内容，处理固定元素，并在独立窗口中预览或保存截图。
- Windows 集成：支持 `.md` 和 `.markdown` 文件关联，以及 NSIS 安装包生成。

## 技术栈

- Electron 42
- React 18
- TypeScript
- Vite / electron-vite
- Zustand
- Tailwind CSS
- Monaco Editor
- node-pty

## 环境要求

- Windows 10 或更高版本，推荐 Windows 11
- Node.js 22 LTS 或更高版本
- npm
- Git
- 如果需要使用 AI Runtime：安装对应的 AI CLI，并确保命令可以在终端中直接执行

当前内置的默认 AI CLI 包括：

- [Claude Code](https://www.npmjs.com/package/@anthropic-ai/claude-code)
- [OpenAI Codex CLI](https://www.npmjs.com/package/@openai/codex)

## 安装依赖

```powershell
npm install
```

`postinstall` 会为 Electron 重建 `node-pty`。如果依赖安装后终端能力异常，可以手动执行：

```powershell
npm run rebuild:pty
```

安装 AI CLI：

```powershell
npm install -g @anthropic-ai/claude-code
npm install -g @openai/codex
```

安装完成后，根据 CLI 官方文档完成登录或 API 配置。

## 本地开发

启动 Electron 开发环境：

```powershell
npm run dev
```

常用命令：

```powershell
# 监听模式
npm run dev:watch

# 类型检查
npm run typecheck

# 样式检查
npm run check:style

# 运行测试
npm test

# 完整验证
npm run verify
```

## 构建与发布

构建应用资源：

```powershell
npm run build
```

生成 Windows x64 NSIS 安装包：

```powershell
npm run dist:win
```

构建产物位于 `release/`。发布流程、版本号规则、SHA-256 校验和以及 Windows 未签名安装包说明，详见 [`docs/release-process.md`](docs/release-process.md)。

目前安装包未配置 Windows 代码签名证书，首次安装时可能会出现 SmartScreen 或“未知发布者”提示。

## 项目结构

```text
src/core/
├── electron/       # 主进程与 preload：系统能力、IPC、Runtime、文件和窗口管理
├── renderer/       # React 渲染进程：页面、组件、状态和主题
└── shared/         # main、preload、renderer 共享的类型与规则

docs/               # 设计说明、开发计划和发布文档
script/             # 构建、发布和自动提交脚本
test/               # Node test 测试与测试夹具
electron-builder.yml
```

## 开发说明

应用主要针对 Windows 本地开发环境设计。涉及 AI Runtime、终端和项目执行时，应用会根据项目环境选择 Windows Native 或 WSL；使用 WSL 项目时，请提前准备可用的 WSL 发行版及对应工具链。

项目中的 AI 自动提交脚本提供以下命令：

```powershell
# 预览 AI 提交结果，不实际提交
npm run ai:commit:dry

# 使用 AI 生成并执行提交
npm run ai:commit
```

使用这些命令前，请确认当前 Git 工作区和 AI CLI 配置符合预期。

## 许可证

本项目使用 [MIT License](LICENSE)。

