# AI 分批提交实施计划（2026-05-19）

## 1. 目标与边界
111112
### 1.1 目标
- 让 AI 能稳定管理 Git 分批提交，提升提交历史可读性和可追溯性。
- 避免“全量一次提交”导致的语义混杂（功能、重构、文档、格式化混在一起）。
- 在可控成本下实现自动化，优先保证稳定性，再逐步提升智能程度。

### 1.2 非目标
- 不在第一阶段实现任意复杂冲突自动修复。
- 不在第一阶段做全量 hunk 级精细拆分（先文件级，后 hunk 级）。
- 不替代开发者最终审阅权限（保留 dry-run 和人工确认入口）。

## 2. 设计原则

- AI 只负责“决策与命名”，脚本负责“执行与校验”。
- 先规划、后执行：先产出 `plan.json`，再按计划 staged + commit。
- 失败可回退：任一步失败都能中止并恢复到安全状态。
- 成本可控：限制 AI 调用次数、输入体积、模型档位。

## 3. 总体流程

1. 收集变更：`git diff --cached`（无 staged 时可选 `git add -A` 后读取）。
2. AI 规划：生成分批计划 `plan.json`（仅规划，不提交）。
3. 本地校验：检查计划完整性、重复分配、规则冲突。
4. 分批执行：逐批 staged → 轻量校验 → commit。
5. 最终对账：确认无遗漏、无重复，输出提交摘要。

## 4. 分阶段落地

## Phase 1（文件级分批，低风险）

### 4.1 产出
- 新增 `skills/auto-git-commit/scripts/ai_split_plan.ps1`
- 新增 `skills/auto-git-commit/scripts/apply_split_plan.ps1`
- 在 `auto_commit.ps1` 增加参数：
  - `--split`
  - `--split-dry-run`
  - `--split-max-batches <n>`

### 4.2 能力
- AI 输出按“文件集合”分批，不做 hunk 切片。
- 每批生成：`type`、`subject`、`bullets`、`files[]`。
- 执行脚本按 `files[]` 暂存并提交。

### 4.3 规则
- 一个文件只能出现在一个批次里（Phase 1）。
- `package.json` 与 `package-lock.json` 必须同批。
- 文档/日志文件优先单独成批（`docs/chore`）。
- 无法分类的剩余文件归入 `fallback` 批次，禁止遗漏。

## Phase 2（hunk 级分批，中风险）

### 4.4 产出
- `plan.json` 支持 `hunks[]`（按文件内片段定位）。
- 执行脚本支持 `git apply --cached` 精确暂存。

### 4.5 能力
- 同文件内可拆多个 commit（例如“功能+样式”拆分）。
- 提升提交语义纯度，减少“同文件多类改动”混杂。

### 4.6 约束
- hunk 唯一性校验（同一片段不可重复分配）。
- 应用失败自动降级为文件级策略并提示人工处理。

## Phase 3（质量门禁与策略优化）

### 4.7 产出
- 批次级质量门禁（可配置）：
  - `typecheck`（可选）
  - `lint --files`（可选）
  - 关键测试子集（可选）
- 成本治理与 telemetry 指标。

### 4.8 能力
- 批次失败可重试/跳过/终止。
- 自动生成提交报告（每批影响范围、命名依据、校验结果）。

## 5. `plan.json` 草案

```json
{
  "version": 1,
  "mode": "file",
  "summary": "本次改动包含自动提交脚本优化与文档更新",
  "batches": [
    {
      "id": "batch-1",
      "type": "fix",
      "subject": "优化 AI 提交类型优先级",
      "bullets": [
        "未显式传入 type 时优先采用 AI 返回值",
        "增加非法 type 校验与文件推断回退"
      ],
      "files": [
        "skills/auto-git-commit/scripts/auto_commit.ps1"
      ],
      "checks": ["typecheck:none", "lint:none"]
    },
    {
      "id": "batch-2",
      "type": "chore",
      "subject": "统一文本文件行尾为 LF",
      "bullets": [
        "新增 .gitattributes 行尾规范",
        "批量重标准化仓库文本文件"
      ],
      "files": [
        ".gitattributes",
        "docs/...",
        "src/..."
      ],
      "checks": ["typecheck:none", "lint:none"]
    }
  ]
}
```

## 6. 执行脚本行为（Phase 1）

### 6.1 `ai_split_plan.ps1`
- 输入：当前 diff（文件、stat、必要 patch 摘要）。
- 输出：`plan.json`（落地到临时目录，可选复制到仓库 `.ai-commit/`）。
- 失败策略：AI 失败时返回本地规则计划（按目录/后缀自动分组）。

### 6.2 `apply_split_plan.ps1`
- 读取 `plan.json` 后逐批执行：
  1. `git restore --staged :/`
  2. `git add -- <batch.files>`
  3. 校验 staged 文件集合与计划一致
  4. `git commit -m "<type>:<subject>" -m "- ..."`
- 全部完成后：
  - `git diff --cached --quiet` 必须为真
  - 输出每批 commit hash 与 subject

## 7. 成本控制策略

- 单次任务最多 AI 调用 2 次（规划 1 次 + 失败重试 1 次）。
- 小改动直通：文件数 <= 3 时默认单提交，不启用 split。
- 限制输入大小：patch 截断 + 优先 `--stat` 与路径语义。
- 模型分层：
  - 规划：中档模型
  - 标题润色：低档模型或本地规则
- 超预算回退：超过 token/调用阈值，自动走本地分组提交。

## 8. 风险与缓解

- 风险：AI 规划语义正确但文件归类错误。
  - 缓解：执行前做“计划 vs staged”一致性校验。
- 风险：hunk 级应用失败导致流程中断。
  - 缓解：Phase 2 增加自动降级到文件级。
- 风险：分批过细造成提交噪音。
  - 缓解：设置最小批次大小和最大批次数。

## 9. 验收标准

- 功能正确性：
  - 100% 覆盖全部改动（无遗漏、无重复）。
  - 生成的每个 commit 均可独立解释其目的。
- 稳定性：
  - 典型项目（5-20 文件改动）成功率 >= 95%。
- 成本：
  - 平均调用次数 <= 2 次/任务。
  - 平均 token 成本较“每批都调 AI”方案下降 40% 以上。
- 可维护性：
  - 脚本参数、日志、失败原因可读。
  - 支持 dry-run 与人工确认。

## 10. 里程碑建议

1. M1（1-2 天）：
   - 完成 Phase 1 脚本与 dry-run。
   - 在当前仓库完成 3 次真实验证。
2. M2（2-3 天）：
   - 引入 hunk 级计划与降级策略。
   - 增加冲突/失败处理路径。
3. M3（1-2 天）：
   - 接入成本阈值与质量门禁。
   - 输出最终操作文档与示例。

## 11. 下一步实施清单

- 确认 Phase 1 是否允许“自动执行 commit”还是“默认 dry-run + 人工确认”。
- 确认首版批次上限（建议 `max-batches=4`）。
- 确认默认模型与预算阈值（调用数/token 上限）。
- 按本计划创建两个脚本并接入现有 `ai:commit` 流程。
