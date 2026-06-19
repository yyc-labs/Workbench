# UrlPopover 分类过滤设计

## 背景

`UrlPopover` 当前以扁平列表展示所有 `docLinks`，URL 链接和 SSH 连接混列，用户难以快速区分资源类型。项目已有 `kind`（`url` | `ssh`）和自定义 `tag` 两套分类字段，但均未用于 popover 内的分组或过滤。

## 目标

在不增加 popover 高度的前提下，让用户可以按分类快速筛选 link 列表。

## 设计方案

### UI 结构

搜索行改为双列布局，右侧增加一个紧凑的分类下拉选择器：

```
┌─────────────────────────────────────────┐
│ 🔍 搜索链接...          [ 全部 ▾ ]      │
├─────────────────────────────────────────┤
│  🔗 生产服务器                    Copy  │
│  ↗ 设计文档                      Copy  │
│  🔗 备用 SSH                      Copy  │
└─────────────────────────────────────────┘
```

### 下拉选项结构

```
全部
──────────
SSH 连接       ← 固定，对应 kind === 'ssh'
──────────
未分类          ← tag 为空的条目
文档            ← 用户自定义 tag
服务器
...
```

- `全部` 为默认值，行为与现在完全一致
- `SSH 连接` 固定出现（只要有 ssh 类型条目）；URL 类型不单独列出，归入各 tag 或未分类
- tag 选项来自传入的 `docLinkTagOptions`，按 `sortOrder` 排序
- 若所有条目均无 tag，则不显示 tag 部分，只保留 `全部` 和 `SSH 连接`

### 过滤逻辑

分类过滤与搜索框叠加生效：

```
显示条目 = entries
  .filter(分类过滤)
  .filter(搜索过滤)
```

| 选中分类 | 过滤条件 |
|---|---|
| 全部 | 无过滤 |
| SSH 连接 | `entry.kind === 'ssh'` |
| 某个 tag | `entry.tag === selectedTag` |
| 未分类 | `!entry.tag` |

### 状态

`UrlPopover` 新增内部状态：

```ts
const [selectedCategory, setSelectedCategory] = useState<string>('all')
// 'all' | 'ssh' | tag值 | 'uncategorized'
```

切换分类时不清空搜索词，两个过滤器独立。

### 新增 Props

`UrlPopover` 新增一个可选 prop：

```ts
tagOptions?: ReadonlyArray<{ value: string; label: string }>
```

- 当 `tagOptions` 为空或未传时，不渲染分类选择器，保持现有行为（向后兼容）
- `ProjectCard` 传入 `docLinkTagOptions`

## 改动范围

| 文件 | 改动 |
|---|---|
| `src/core/renderer/components/UrlPopover.tsx` | 新增 `tagOptions` prop、分类状态、过滤逻辑、下拉选择器 UI |
| `src/core/renderer/components/ProjectCard.tsx` | 向 `UrlPopover` 传入 `docLinkTagOptions` |

## 不在范围内

- Detail 页的 `DetailDocumentationCard` 不改动
- `docLinkTagOptions` 的管理逻辑（已有）不改动
- 不新增 kind 类型

## 兼容性

`tagOptions` 为可选 prop，默认不传时 `UrlPopover` 行为与现在完全一致，不影响其他使用方。
