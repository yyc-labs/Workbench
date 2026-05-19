---
name: auto-git-commit
description: 在对话结束时自动执行 Git 提交。适用于需要高频、小步、可追踪提交的开发流程。触发方式：用户提到“自动提交”“提交当前改动”“结束后提交”等意图时使用。
---

# Auto Git Commit

用于在当前仓库快速完成一次标准化提交，默认行为是：
- 仅在有变更时提交
- 自动生成中文提交信息（`fix|feat|style|chore`）
- 可追加小点说明（`-m` 多段消息）

## 使用步骤

1. 在仓库根目录执行脚本：
   `bash skills/auto-git-commit/scripts/auto_commit.sh`
2. 如需指定类型与标题：
   `bash skills/auto-git-commit/scripts/auto_commit.sh --type fix --subject 修复启动白闪`
3. 如需追加 bullet 说明：
   `bash skills/auto-git-commit/scripts/auto_commit.sh --type feat --subject 完善多链接展示 --bullet "appStore: processUrls 从单值改为数组" --bullet "新增 UrlPopover 组件"`

## 参数说明

- `--type`：`fix|feat|style|chore|refactor|docs|debug`，默认自动推断
- `--subject`：提交标题（不含前缀），默认优先使用 AI/小点总结生成，最后才回退到文件数兜底
- `--bullet`：可重复，用于追加多段小点说明
- `--all`：执行 `git add -A`（默认仅添加已跟踪文件 `git add -u`）
- `--include-untracked`：添加未跟踪文件（`git add .`）
- `--dry-run`：仅输出将要执行的提交信息，不真正提交

## 提交格式约定

脚本输出提交标题遵循：
`<type>:<中文简述>`

当传入 `--bullet` 时，会用多段 `-m` 追加：
- `- xxx`
- `- yyy`

## 注意事项

- 该 skill 负责“自动执行提交命令”，不负责强制平台“每次对话必定自动触发”。
- 若要达到“每轮结束自动提交”，可在你的外层工作流/包装脚本里固定调用本脚本。
- 提交前请确认不会误提交敏感文件。
