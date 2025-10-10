# FreeGIF 安装和使用指南

## 问题解决

之前的依赖问题已经修复。新版本不再使用需要编译的 native 模块（如 canvas），改用纯 JavaScript 的 GIF 编码库。

## 安装步骤

### 1. 清理之前的安装（如果有）

```bash
# 删除 node_modules 文件夹
rm -rf node_modules

# 删除 package-lock.json
rm package-lock.json
```

### 2. 安装依赖

```bash
npm install
```

这次应该能顺利安装，不会再出现 canvas 模块的编译错误。

### 3. 启动应用

```bash
npm start
```

## 依赖说明

新版本使用以下依赖：

- `electron`: ^28.0.0 - Electron 框架
- `@electron/remote`: ^2.1.2 - Remote 模块支持（用于 dialog）
- `gif.js`: ^0.2.0 - 纯 JavaScript GIF 编码器

这些都是纯 JavaScript 包，不需要编译，在 Windows 上也能正常安装。

## 功能说明

### 1. 录制 GIF
- 点击"开始录制"按钮
- 鼠标拖动选择录制区域
- 点击"停止"按钮结束录制

### 2. 编辑 GIF
- 播放/暂停预览
- 逐帧浏览
- 裁剪（设置开始和结束帧）
- 调整播放速度（25-200ms/帧）
- 调整质量（1-100%）

### 3. 导出 GIF
- 点击"导出 GIF"按钮
- 选择保存位置
- 等待导出完成

## 注意事项

1. **首次运行权限**：Windows 可能需要授予屏幕录制权限
2. **录制性能**：
   - 建议录制时长 5-10 秒
   - 录制区域不要太大（建议 800x600 以内）
   - 帧数限制在 100 帧以内
3. **导出质量**：质量越高文件越大，建议 70-80% 之间

## 快捷键

- **ESC**: 取消区域选择

## 故障排除

### 如果安装失败

1. 确保 Node.js 版本 >= 14
2. 检查网络连接
3. 尝试清理 npm 缓存：`npm cache clean --force`
4. 删除 node_modules 重新安装

### 如果录制失败

1. 检查是否授予了屏幕录制权限
2. 尝试选择较小的录制区域
3. 关闭其他占用 GPU 的应用

### 如果导出失败

1. 检查磁盘空间是否足够
2. 确保有写入权限
3. 尝试选择其他保存位置

## 技术架构

- **主进程**: src/main.js
- **主窗口**: src/renderer/index.html + index.js
- **区域选择**: src/renderer/selector.html + selector.js
- **录制功能**: src/renderer/recorder.js
- **编辑器**: src/renderer/editor.html + editor.js

## 开发

```bash
# 开发模式
npm run dev
```

## 构建打包

如需打包为可执行文件，可以安装 electron-builder：

```bash
npm install --save-dev electron-builder
```

然后在 package.json 添加：

```json
"scripts": {
  "build": "electron-builder"
},
"build": {
  "appId": "com.freegif.app",
  "win": {
    "target": "nsis"
  }
}
```

执行打包：

```bash
npm run build
```
