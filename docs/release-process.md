# 发布流程

本文记录 IDE Electron 的发布检查项和 Windows 安装包发布流程，避免以后忘记构建、校验和签名相关设置。

## 当前发布配置

- 构建配置文件：`electron-builder.yml`
- Windows 目标：NSIS 安装包，x64
- 发布产物目录：`release/`
- Electron 下载校验：已开启，`electronDownload.isVerifyChecksum: true`
- 包协议：MIT
- 包作者：`yyc <yyc200501317710@gmail.com>`
- npm 发布保护：`private: true`

## 发布前检查

1. 确认版本号
   - 更新 `package.json` 的 `version`
   - 同步更新 `package-lock.json`

2. 确认元数据
   - `description` 不为空
   - `author` 正确
   - `license` 为 `MIT`
   - `LICENSE` 文件存在并与许可证一致

3. 确认构建安全配置
   - `electron-builder.yml` 中 `electronDownload.isVerifyChecksum` 必须保持 `true`
   - 不要把证书、密码、token、私钥写入仓库

4. 运行检查
   - `npm run typecheck`
   - `npm run build`

## 构建 Windows 安装包

在 WSL2 Ubuntu 环境中执行：

```bash
npm run dist:win
```

构建完成后检查 `release/` 目录。安装包文件名由 `electron-builder.yml` 中的 `artifactName` 控制：

```text
${productName}-${version}-${arch}-setup.${ext}
```

## 发布产物校验

发布到 GitHub Releases 或其他下载页面时，建议同时提供安装包的 SHA-256 值。

在 WSL2 中生成校验值：

```bash
sha256sum release/*.exe
```

把输出内容复制到 release note 中，方便下载者核对文件是否被篡改。

## 未签名发布说明

当前没有配置 Windows 代码签名证书。未签名安装包可以正常构建和发布，但用户安装时可能看到：

- 未知发布者
- Windows SmartScreen 拦截
- Windows 已保护你的电脑

这是 Windows 对未签名应用的正常提示，不代表安装包一定有问题。早期开源项目可以先不购买证书，等下载量和用户规模上来后再处理签名。

## 代码签名计划

正式面向更多用户分发时，再购买或申请受信任的代码签名证书。

可选方案：

- 普通代码签名证书：成本较低，可以显示已验证发布者，但 SmartScreen 信誉可能需要时间积累。
- EV 代码签名证书：成本更高，审核更严格，通常对 SmartScreen 更友好。
- Microsoft Artifact Signing：微软云签名服务，但有地区、账号和身份验证限制。

证书准备好后，再配置环境变量，不要把证书密码提交进 git：

```bash
export WIN_CSC_LINK="/path/to/certificate.p12"
export WIN_CSC_KEY_PASSWORD="certificate-password"
```

如果证书发布者名称固定，可以在 `electron-builder.yml` 中补充：

```yaml
win:
  publisherName: "证书里的发布者名称"
```

必要时再补 `certificateSubjectName`，用于从证书库中选择正确证书。

签名后在 Windows 上验证：

```powershell
signtool verify /pa /v path\to\installer.exe
```

也可以右键安装包，查看“属性 -> 数字签名”。

## GitHub Release 建议内容

每次发布时建议包含：

- 版本号
- 主要更新
- 安装包下载链接
- SHA-256 校验值
- 是否已签名
- 已知问题

未签名版本可以在 release note 中明确写：

```text
Windows installer is currently unsigned. SmartScreen may show a warning.
Verify the SHA-256 checksum before installing.
```

## 发布后检查

1. 下载 release 页面上的安装包。
2. 对下载文件重新运行 `sha256sum`，确认和 release note 一致。
3. 在 Windows 测试机安装。
4. 启动应用，确认主要功能可用。
5. 如已签名，确认数字签名显示正常。
