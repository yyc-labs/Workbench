# node-pty 在 VS2026 下编译的完整解决过程

## 问题背景

在 Electron 项目中用 `npx electron-rebuild -f -w node-pty` 编译原生模块，因为安装的是 **Visual Studio 2026**（版本号 `18.x`），而 node-gyp 只支持到 VS2022（`17.x`），导致一系列兼容性问题。

---

## 排查过程

### 第一步：发现 VS 被识别为 `undefined`

开启 DEBUG 模式后看到：
```
gyp verb find VS unknown version "undefined" found at "D:\c++_buildTools"
```
node-gyp 找到了安装目录，但读不出版本号。

### 第二步：用 vswhere 确认根本原因

```powershell
& "C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe" -all -format json
```
输出显示 `installationVersion: 18.6.11806.211`，确认是 VS2026（`18.x`），超出 node-gyp 支持范围。

### 第三步：找到 node-gyp 版本检测代码

定位到两个关键文件：
- `D:\tools\ide-electron\node_modules\@electron\node-gyp\lib\find-visualstudio.js`
- `C:\Users\yyc20\AppData\Local\npm-cache\_npx\...\node_modules\node-gyp\lib\find-visualstudio.js`

注意：**两个文件都要改**，`electron-rebuild` 实际用的是 npx 缓存里那个。

---

## 修改内容（共两处）

### 修改一：添加 `18.x` 版本识别

在 `find-visualstudio.js` 的 `processVersion` 函数里，`versionMajor === 17` 之后加：

```javascript
// 原有代码
if (ret.versionMajor === 17) {
  ret.versionYear = 2022
}
// 新增
if (ret.versionMajor === 18) {
  ret.versionYear = 2022
}
```

### 修改二：修正平台工具集标识符

在 `getToolset` 函数里，VS2026 的工具集是 `v145`（不是 `v143`），修改：

```javascript
// 改前
} else if (versionYear === 2022) {
  return 'v143'
// 改后
} else if (versionYear === 2022) {
  return 'v145'
```

### 修改三：写入注册表让 node-gyp 识别安装路径

```powershell
reg add "HKLM\SOFTWARE\Microsoft\VisualStudio\SxS\VS7" /v "17.0" /t REG_SZ /d "D:\c++_buildTools\" /f
reg add "HKLM\SOFTWARE\WOW6432Node\Microsoft\VisualStudio\SxS\VS7" /v "17.0" /t REG_SZ /d "D:\c++_buildTools\" /f
```

---

## 版本对应关系（备忘）

| Visual Studio 版本 | `installationVersion` | 工具集标识符 |
|---|---|---|
| VS 2017 | `15.x` | `v141` |
| VS 2019 | `16.x` | `v142` |
| VS 2022 | `17.x` | `v143` |
| **VS 2026** | **`18.x`** | **`v145`** |

---
## 修复脚本
```powershell
$file = "D:\tools\ide-electron\node_modules\@electron\node-gyp\lib\find-visualstudio.js"
$content = Get-Content $file -Raw

# 添加 v18 识别
$content = $content -replace "(if \(ret\.versionMajor === 17\) \{\s*\r?\n\s*ret\.versionYear = 2022\s*\r?\n\s*\})", '$1
    if (ret.versionMajor === 18) {
      ret.versionYear = 2022
    }'

# 修正工具集
$content = $content -replace "'v143'", "'v145'"

Set-Content $file -Value $content -NoNewline
Write-Host "patch 完成"
```
## 根本原因总结

node-gyp 和 electron-rebuild 发布时 VS2026 尚未存在，硬编码了版本号上限，遇到 `18.x` 直接跳过，需要手动 patch 源码绕过限制。日后官方更新 node-gyp 支持 VS2026 后就不再需要这些修改。

已经配置了
set GYP_MSVS_VERSION=2022
下载了适配的2022版本
MSVC v143 - VS 2022 C++ x64/x86 Spectre 缓解库（最新）
下载了这个组件