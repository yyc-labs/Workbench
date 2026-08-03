# 项目文档索引

Workbench 的文档按“公开使用文档”和“本地开发过程资料”分开管理。

## 目录分级

```text
docs/
├── README.md                 # 文档总索引
├── guides/                   # 面向贡献者和维护者的长期指南，可提交
│   └── git-commit-format-cn.md
├── reference/                # 稳定的技术接口和集成说明，可提交
│   └── hooks/
│       ├── agent-hook-gateway.md
│       └── transcript-import-api.md
├── release/                  # 对外发布、构建和安装包说明，可提交
│   └── release-process.md
├── images/                   # README、文档和产品截图，可提交
└── development/              # 开发过程资料，已加入 .gitignore
    ├── plans/                # 需求、设计、优化和执行计划
    ├── decisions/            # 待确认或阶段性的技术决策
    ├── logs/                 # 安装、问题排查和历史记录
    └── superpowers/          # 过程型方案与临时规格
```

## 公开文档

### 指南

- [Git 提交信息格式](./guides/git-commit-format-cn.md)：提交标题和类型约定。

### 技术参考

- [Agent Hook Gateway](./reference/hooks/agent-hook-gateway.md)：Agent 生命周期 Hook Gateway 说明。
- [Transcript Import API](./reference/hooks/transcript-import-api.md)：Transcript 导入接口说明。

### 发布

- [发布流程](./release/release-process.md)：Windows 构建、校验、版本和安装包发布检查项。

### 图片

产品截图统一放在 `docs/images/`，README 使用的文件名包括：

- `overview.png`
- `code-workspace.png`
- `markdown-workspace.png`

## 开发过程资料

`docs/development/` 已加入 `.gitignore`，用于保存不应进入公开仓库的过程性资料。它们仍保留在本地，便于继续追踪历史上下文，但不会作为正式项目文档发布。

新增文档时建议遵循以下规则：

- 面向用户、贡献者或发布流程的稳定说明，放入 `guides/`、`reference/` 或 `release/`。
- 只服务于当前需求、优化轮次、设计评审或问题排查的文档，放入 `development/`。
- 产品截图和演示素材放入 `images/`，不要混入开发计划目录。
