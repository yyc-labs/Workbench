# Transcript Import API 接入说明

这份文档用于给同机脚本、CLI 工具或其他本地应用接入 `Transcript Viewer`。

目标很简单：

- 外部程序把一段文本发给 Electron
- Electron 在主进程完成 transcript 导入和解析
- renderer 收到事件后写入 transcript store
- 按需自动打开 `/project/:projectId/transcript`

## 适用场景

- 把外部 AI 工具输出归档到项目 Transcript Viewer
- 把本地脚本生成的 markdown / log / 对话记录导入到项目里
- 把已有终端输出、诊断结果、review 结果沉淀为可浏览 transcript

## 前提条件

接入前需要满足下面几项：

- `ide-electron` 已启动
- 目标项目已经在应用内注册
- 设置页 `Agent Hooks` 中的 `Transcript Import API` 已启用

如果你不确定服务地址，直接打开设置页 `Agent Hooks`，以界面里显示的 `Import Endpoint` 为准。

## 服务地址

默认网关端口是 `17373`。

本机脚本通常直接调用：

```text
http://127.0.0.1:17373
```

注意：

- `0.0.0.0` 是服务端监听地址，不是客户端请求地址，不要用 `curl http://0.0.0.0:17373/...` 作为接入方式
- 如果 Electron 跑在 Windows 侧，而调用脚本跑在 WSL2 内，`127.0.0.1` 不一定总能通
- 这种情况下应改用 Windows 主机在 WSL 里的地址

在 WSL2 里可以这样取 Windows 主机地址：

```bash
WIN_HOST=$(awk '/nameserver/ {print $2; exit}' /etc/resolv.conf)
echo "$WIN_HOST"
```

然后测试：

```bash
curl -x '' "http://$WIN_HOST:17373/health"
```

如果你的 WSL / shell 环境配置了 `HTTP_PROXY`、`HTTPS_PROXY` 或 `ALL_PROXY`，本地请求可能会被错误转发到代理，表现为 `502 Bad Gateway`。

这种情况下请显式绕过代理，例如：

```bash
curl --noproxy '*' http://127.0.0.1:17373/health
```

或：

```bash
curl -x '' http://127.0.0.1:17373/health
```

可用接口：

- `GET /health`
- `GET /transcripts/projects`
- `POST /transcripts/import`

## 推荐接入流程

推荐按下面顺序接入：

1. 先调用 `GET /transcripts/projects` 获取当前可导入的项目列表
2. 选定目标项目，拿到 `projectId` 或 `projectPath`
3. 调用 `POST /transcripts/import` 发送 transcript 文本
4. 如果请求体里传了 `openViewer: true`，应用会自动切到 Transcript 页面

## 1. 获取项目列表

请求：

```bash
curl http://127.0.0.1:17373/transcripts/projects
```

响应示例：

```json
{
  "ok": true,
  "projects": [
    {
      "projectId": "p_abc123",
      "projectPath": "/mnt/d/tools/ide-electron",
      "name": "ide-electron",
      "customName": "IDE Electron",
      "displayName": "IDE Electron"
    }
  ]
}
```

字段说明：

- `projectId`: 导入接口可直接使用的项目 id
- `projectPath`: 已注册项目的绝对路径
- `name`: 默认项目名，通常取目录名
- `customName`: 如果用户在应用里设置了自定义名称，则这里会返回
- `displayName`: 优先返回 `customName`，否则返回 `name`

## 2. 导入 transcript

### 请求地址

```text
POST /transcripts/import
```

注意：`/transcripts/import` 只支持 `POST`。如果你用 `GET /transcripts/import` 测试，正确行为应该是 `404`，不是导入成功。

### 最小请求体

```json
{
  "projectId": "p_abc123",
  "rawText": "src/core/renderer/App.tsx:138\nhello transcript"
}
```

### 完整请求体

```json
{
  "projectId": "p_abc123",
  "projectPath": "/mnt/d/tools/ide-electron",
  "sourceType": "imported-file",
  "rawText": "src/core/renderer/App.tsx:138\nhello transcript",
  "title": "External Import Demo",
  "sourceLabel": "my-script",
  "processId": "script-42",
  "capturedAt": 1780977600000,
  "openViewer": true
}
```

### 字段说明

| 字段 | 必填 | 说明 |
|------|------|------|
| `projectId` | 否 | 目标项目 id。和 `projectPath` 至少传一个 |
| `projectPath` | 否 | 目标项目绝对路径。必须和应用内已注册项目完全匹配 |
| `sourceType` | 否 | 来源类型。默认会回落到 `imported-file` |
| `rawText` | 是 | 原始 transcript 文本 |
| `title` | 否 | transcript 标题 |
| `sourceLabel` | 否 | 来源标签 |
| `processId` | 否 | 可选的外部进程标识 |
| `capturedAt` | 否 | 时间戳，毫秒 |
| `openViewer` | 否 | 导入后是否自动打开 Transcript Viewer |

### 支持的 `sourceType`

- `process-output`
- `tmux-capture`
- `agent-hook`
- `manual-markdown`
- `imported-file`

### 字段别名

为了兼容一些更简单的调用方，接口还支持两个别名：

- `content` 可代替 `rawText`
- `reveal` 可代替 `openViewer`

例如：

```json
{
  "projectPath": "/mnt/d/tools/ide-electron",
  "content": "src/main/index.ts:10\nfrom alias field",
  "reveal": true
}
```

### 成功响应

```json
{
  "ok": true,
  "projectId": "p_abc123",
  "sessionId": "ts-mbf4dabc-4m2p3q9k",
  "title": "External Import Demo",
  "sourceType": "imported-file",
  "openViewer": true
}
```

字段说明：

- `projectId`: 实际导入到的项目 id
- `sessionId`: 新生成的 transcript session id
- `title`: 最终保存的标题
- `sourceType`: 最终保存的来源类型
- `openViewer`: 本次导入是否触发自动打开页面

## 导入后的效果

导入成功后：

- transcript 会立即持久化保存
- Transcript 页面列表里会出现新记录
- renderer 会收到 `transcript:imported` 事件
- 如果 `openViewer` 为 `true`，应用会自动导航到对应项目的 Transcript 页面

## 引用解析说明

导入文本会在主进程经过 transcript parser。

如果文本中出现类似下面的项目内文件引用：

```text
src/core/renderer/App.tsx:138
src/main/index.ts:45:9
```

系统会尝试把它们解析为 transcript 内部引用，并在 viewer 中保留为可点击链接。

建议外部工具尽量输出相对项目根目录的路径，这样引用识别最稳定。

## 常见错误

### 1. 项目不存在

如果传入的 `projectId` 无效，或者 `projectPath` 没有对应到应用里已注册项目，会返回类似错误：

```json
{
  "error": "Transcript import requires a valid projectId or registered projectPath."
}
```

或：

```json
{
  "error": "Unknown project id: p_xxx"
}
```

处理方式：

- 先调用 `GET /transcripts/projects`
- 不要猜测 `projectId`
- 如果使用 `projectPath`，确保路径和应用中注册的项目路径一致

### 2. 请求体为空

如果没有传 `rawText`，或者内容只有空白，会返回类似错误：

```json
{
  "error": "Transcript import requires non-empty raw text."
}
```

### 3. `projectPath` 不匹配

如果同时传了 `projectId` 和 `projectPath`，但两者不对应，会返回类似错误：

```json
{
  "error": "Provided projectPath does not match the registered project."
}
```

### 4. 请求体过大

默认请求体大小限制是 `256 KB`。超出时会返回：

```json
{
  "error": "request body too large"
}
```

## 调用示例

### curl

```bash
curl http://127.0.0.1:17373/transcripts/import \
  -H 'Content-Type: application/json' \
  -d '{
    "projectPath": "/mnt/d/tools/ide-electron",
    "rawText": "src/core/renderer/App.tsx:138\nhello transcript",
    "title": "External Import Demo",
    "sourceType": "imported-file",
    "openViewer": true
  }'
```

### Node.js

```js
const payload = {
  projectPath: "/mnt/d/tools/ide-electron",
  rawText: "src/core/renderer/App.tsx:138\nhello transcript",
  title: "External Import Demo",
  openViewer: true,
}

const response = await fetch("http://127.0.0.1:17373/transcripts/import", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify(payload),
})

const result = await response.json()
console.log(result)
```

### Python

```python
import requests

payload = {
    "projectPath": "/mnt/d/tools/ide-electron",
    "rawText": "src/core/renderer/App.tsx:138\nhello transcript",
    "title": "External Import Demo",
    "openViewer": True,
}

resp = requests.post(
    "http://127.0.0.1:17373/transcripts/import",
    json=payload,
    timeout=10,
)

print(resp.status_code)
print(resp.json())
```

## 可选认证

默认本机脚本可以不带认证直接调用。

只有在设置页里给 `Transcript Import API` 配置了专用 token 时，才需要额外带上下面任一请求头：

```text
Authorization: Bearer <token>
```

或：

```text
x-workbench-transcript-token: <token>
```

如果你的使用场景只是自己本机上的脚本，一般不需要启用这一层。
