# GitHub Actions CI/CD 说明

## 工作流程

本项目使用 GitHub Actions 实现自动化构建和发布。

### 触发条件

CI 会在以下情况下自动触发：

1. **推送到主分支**：当代码推送到 `main` 或 `master` 分支时
2. **Pull Request**：当创建或更新针对 `main` 或 `master` 分支的 PR 时
3. **标签推送**：当推送以 `v` 开头的标签时（如 `v1.0.0`）

### 构建平台

- **Windows**：生成 `.exe` 安装包（NSIS 格式）
- **macOS**：生成 `.dmg` 镜像文件（支持 x64 和 arm64 架构）

### 构建产物

构建完成后，产物会自动上传到 GitHub Actions Artifacts，可以在 Actions 页面下载。

## 如何创建发布版本

### 方法 1：通过 Git 标签（推荐）

```bash
# 创建版本标签
git tag v1.0.0

# 推送标签到 GitHub
git push origin v1.0.0
```

这会触发 CI 构建，并自动创建 GitHub Release，包含 Windows 和 macOS 的安装包。

### 方法 2：手动从 Artifacts 下载

1. 进入 GitHub 仓库的 Actions 页面
2. 选择最近的构建任务
3. 在页面底部找到 Artifacts 区域
4. 下载 `FreeGIF-Windows` 或 `FreeGIF-macOS`

## 本地构建

如果需要在本地构建应用：

```bash
# 安装依赖
npm install

# 构建 Windows 版本
npm run build:win

# 构建 macOS 版本
npm run build:mac

# 构建 Linux 版本
npm run build:linux

# 构建所有平台
npm run build
```

构建产物会输出到 `dist` 目录。

## 配置说明

构建配置位于 `package.json` 的 `build` 字段：

- `appId`: 应用唯一标识符
- `productName`: 应用显示名称
- `directories.output`: 构建输出目录
- `files`: 需要打包的文件
- `win/mac/linux`: 各平台特定配置

## 注意事项

1. **macOS 签名**：如果需要签名和公证，需要配置 Apple Developer 证书
2. **Windows 签名**：如果需要签名，需要配置代码签名证书
3. **构建时间**：首次构建可能需要 10-20 分钟，后续构建会利用缓存加速
4. **磁盘空间**：确保 GitHub Actions runner 有足够空间（通常不是问题）

## 故障排查

### 构建失败

1. 检查 `package.json` 中的依赖版本
2. 确保 `src/public/logo.ico` 图标文件存在
3. 查看 Actions 日志获取详细错误信息

### 发布失败

1. 确保标签格式正确（以 `v` 开头）
2. 检查 `GITHUB_TOKEN` 权限（通常自动配置）
3. 确保构建产物路径正确（`dist/*.exe` 和 `dist/*.dmg`）

## 扩展功能

可以根据需要添加以下功能：

- 代码签名
- 自动生成更新日志
- 上传到其他平台（如 Homebrew、Chocolatey）
- 添加 Linux 平台支持
- 多架构支持（如 ARM）
