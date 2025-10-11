# GIF 压缩技术详解

## 1. GIF 格式基础

### 1.1 GIF 文件结构

GIF (Graphics Interchange Format) 是一种位图图像格式,采用 LZW (Lempel-Ziv-Welch) 无损压缩算法。一个 GIF 文件包含以下主要部分:

```
┌─────────────────────────┐
│  GIF Header (GIF89a)    │  6 字节
├─────────────────────────┤
│  Logical Screen Desc.   │  7 字节 - 屏幕尺寸、颜色信息
├─────────────────────────┤
│  Global Color Table     │  可选 - 最多 256 色调色板
├─────────────────────────┤
│  Application Extension  │  可选 - 循环次数等
├─────────────────────────┤
│  ┌───────────────────┐  │
│  │ Frame 1           │  │
│  │ - GCE Extension   │  │  延迟时间、透明色
│  │ - Image Desc.     │  │  帧位置、尺寸
│  │ - Local Color Tbl │  │  可选局部调色板
│  │ - Image Data (LZW)│  │  压缩的像素数据
│  └───────────────────┘  │
│  ┌───────────────────┐  │
│  │ Frame 2 ...       │  │
│  └───────────────────┘  │
├─────────────────────────┤
│  GIF Trailer (0x3B)     │  1 字节
└─────────────────────────┘
```

### 1.2 颜色限制

GIF 格式的核心限制:
- **最多 256 色**: 每一帧只能包含最多 256 种颜色
- **调色板方式**: 使用索引颜色表,而非真彩色
- **全局/局部调色板**: 可以为所有帧共享一个调色板,或每帧使用独立调色板

## 2. gif.js 库的压缩机制

FreeGIF 使用的 gif.js 库采用了多层压缩技术:

### 2.1 颜色量化 (Color Quantization)

#### 2.1.1 NeuQuant 神经网络算法

gif.js 使用 **NeuQuant** 算法进行颜色量化,这是一种基于 Kohonen 神经网络的算法:

**工作原理:**
1. **初始化**: 创建 256 个神经元,均匀分布在 RGB 色彩空间
2. **学习阶段**:
   - 从图像中采样像素(采样间隔由 `quality` 参数控制)
   - 每个采样像素"训练"神经网络,调整最接近的神经元及其邻近神经元的颜色
   - 进行 100 个学习周期 (ncycles = 100)
3. **构建调色板**: 学习完成后,256 个神经元的颜色值即为最终调色板

**`quality` 参数的影响:**
```javascript
// 在 FreeGIF 中
quality: Math.floor((100 - quality) / 10) + 1
// 用户设置 80% → 实际 quality = 3
// 用户设置 50% → 实际 quality = 6
// 用户设置 10% → 实际 quality = 10
```

- **范围**: 1-30 (gif.js 内部值)
- **含义**: 像素采样间隔,每隔 N 个像素采样一次
- **quality = 1**: 采样所有像素,颜色最准确,但速度最慢
- **quality = 10** (默认): 每 10 个像素采样一次,速度与质量平衡
- **quality = 30**: 采样极少,速度快但颜色失真严重

**代码示例 (NeuQuant.js:74-78):**
```javascript
function NeuQuant(pixels, samplefac) {
  // samplefac = quality 参数
  // 采样像素数 = 总像素数 / (3 * samplefac)
  var samplepixels = toInt(lengthcount / (3 * samplefac));
}
```

#### 2.1.2 颜色距离计算

NeuQuant 使用欧几里得距离在 RGB 空间中查找最接近的颜色:

```javascript
// 距离公式
distance = sqrt((r1-r2)² + (g1-g2)² + (b1-b2)²)
```

### 2.2 抖动处理 (Dithering)

当真彩色图像被限制到 256 色时,会产生明显的色带(banding)。抖动通过在相邻像素间分散量化误差来改善视觉效果。

#### 2.2.1 可用的抖动算法

gif.js 支持以下抖动方法:

| 算法 | 特点 | 误差扩散范围 | 视觉效果 |
|------|------|------------|---------|
| **Floyd-Steinberg** | 最常用,效果好 | 当前像素 + 右1下1 | 细腻,噪点适中 |
| **False Floyd-Steinberg** | 简化版,速度快 | 仅右1下1 | 较粗糙,噪点少 |
| **Stucki** | 误差扩散最广 | 当前像素 + 周围12像素 | 最细腻,噪点最多 |
| **Atkinson** | Apple 经典算法 | 当前像素 + 周围6像素 | 对比度高,适合图标 |

**Serpentine 扫描:**
- 添加 `-serpentine` 后缀(如 `FloydSteinberg-serpentine`)
- 蛇形扫描: 奇数行从左到右,偶数行从右到左
- 优点: 减少垂直条纹伪影

#### 2.2.2 Floyd-Steinberg 误差扩散矩阵

```
        X    7/16
  3/16  5/16  1/16
```

**工作流程:**
1. 将当前像素量化到调色板中最接近的颜色
2. 计算量化误差 = 原始颜色 - 量化颜色
3. 按权重分配误差到右侧和下方的像素

**代码示例 (GIFEncoder.js:286-291):**
```javascript
FloydSteinberg: [
  [7 / 16, 1, 0],   // 右侧像素,误差权重 7/16
  [3 / 16, -1, 1],  // 左下像素,误差权重 3/16
  [5 / 16, 0, 1],   // 正下像素,误差权重 5/16
  [1 / 16, 1, 1]    // 右下像素,误差权重 1/16
]
```

### 2.3 LZW 压缩

颜色量化和抖动后,像素被转换为索引数组(0-255),然后使用 LZW 算法进行无损压缩。

**LZW 工作原理:**
1. 初始化 256 个单字符代码表(对应 256 种颜色)
2. 读取像素索引序列,查找已存在的最长匹配
3. 输出匹配代码,将 "匹配+下一个字符" 加入代码表
4. 代码表动态增长,最多到 4096 个条目

**适合 LZW 的图像特征:**
- ✅ 大块相同颜色(如卡通、图标、截图)
- ✅ 渐变较少的图像
- ❌ 照片、复杂纹理(压缩效果差)

## 3. FreeGIF 当前的压缩实现

### 3.1 现有参数

```javascript
const gif = new window.GIF({
  workers: 2,                    // Web Worker 数量
  quality: Math.floor((100 - quality) / 10) + 1,  // 颜色采样质量
  width: editCanvas.width,       // 输出宽度
  height: editCanvas.height,     // 输出高度
  workerScript: '...'            // Worker 脚本路径
});

gif.addFrame(tempCanvas, {
  delay: delay,                  // 帧延迟(毫秒)
  copy: true                     // 复制像素数据
});
```

### 3.2 质量参数的映射

用户界面显示 1-100%,内部转换为 gif.js 的 1-10 范围:

| 用户设置 | 内部 quality | 采样率 | 文件大小 | 处理速度 |
|---------|-------------|-------|---------|---------|
| 100% | 1 | 100% | 最大 | 最慢 |
| 80% | 3 | 33% | 较大 | 较快 |
| 50% | 6 | 17% | 中等 | 中等 |
| 20% | 9 | 11% | 较小 | 较快 |
| 1% | 10 | 10% | 最小 | 最快 |

## 4. 可以添加的压缩参数

### 4.1 推荐添加的参数

#### 4.1.1 抖动开关与算法选择

**建议 UI:**
```
抖动处理: [关闭 ▼]
  - 关闭 (无抖动)
  - Floyd-Steinberg (推荐)
  - Stucki (最佳质量)
  - Atkinson (适合UI截图)
```

**实现代码:**
```javascript
const gif = new window.GIF({
  // ...
  dither: ditherMethod === '关闭' ? false : ditherMethod + '-serpentine'
});
```

**文件大小影响:**
- 无抖动: 基准大小
- 有抖动: +10% ~ +30% (抖动引入更多细节,降低 LZW 压缩效率)

#### 4.1.2 全局调色板 vs 局部调色板

**建议 UI:**
```
调色板: [自动 ▼]
  - 自动 (每帧独立)
  - 全局调色板 (共享)
```

**实现代码:**
```javascript
const gif = new window.GIF({
  // ...
  globalPalette: paletteMode === '全局调色板' ? true : false
});
```

**影响:**
- **全局调色板**:
  - ✅ 文件更小(调色板只存储一次)
  - ❌ 颜色可能不准确(所有帧共享同一调色板)
  - 适合: 颜色变化小的 GIF (如 UI 动画)
- **局部调色板**:
  - ✅ 每帧颜色最准确
  - ❌ 文件更大(每帧 768 字节调色板)
  - 适合: 颜色变化大的 GIF (如视频片段)

#### 4.1.3 帧裁剪与尺寸优化

**建议 UI:**
```
输出尺寸: [原始 ▼]
  - 原始 (100%)
  - 75%
  - 50%
  - 自定义
```

**实现:**
```javascript
// 在 exportGIF 前缩放画布
if (scaleFactor !== 1) {
  const scaledWidth = Math.round(editCanvas.width * scaleFactor);
  const scaledHeight = Math.round(editCanvas.height * scaleFactor);
  tempCanvas.width = scaledWidth;
  tempCanvas.height = scaledHeight;
  tempCtx.drawImage(img, 0, 0, scaledWidth, scaledHeight);
}
```

**影响:**
- 缩小到 50%: 文件大小约减少 75%
- 像素数 = width × height,压缩数据量与像素数成正比

#### 4.1.4 帧率优化

**建议 UI:**
```
帧优化: [ ] 跳过相似帧
容差值: [5────────] (0-20)
```

**实现思路:**
```javascript
// 计算相邻帧的像素差异
function calculateFrameDifference(frame1, frame2) {
  let diffCount = 0;
  for (let i = 0; i < frame1.data.length; i++) {
    if (Math.abs(frame1.data[i] - frame2.data[i]) > tolerance) {
      diffCount++;
    }
  }
  return diffCount / frame1.data.length;
}

// 如果差异小于阈值,跳过该帧
if (calculateFrameDifference(prevFrame, currentFrame) < threshold) {
  // 增加前一帧的 delay 时间
  prevFrame.delay += currentFrame.delay;
}
```

**影响:**
- 可减少 20%-50% 的帧数
- 适合: 录制教程、演示(大量静止画面)

#### 4.1.5 Worker 数量

**建议 UI:**
```
处理器核心: [2 ▼]
  - 1 (单线程)
  - 2 (默认)
  - 4 (快速)
  - 8 (最快)
```

**影响:**
- 不影响文件大小
- 仅影响导出速度
- 建议: CPU 核心数 - 1

### 4.2 高级参数 (可选)

#### 4.2.1 背景色

```javascript
background: '#ffffff'  // 透明区域的背景色
```

#### 4.2.2 透明色

```javascript
transparent: 0x00FF00  // 将特定颜色设为透明
```

#### 4.2.3 循环次数

```javascript
repeat: 0   // 0 = 无限循环, -1 = 播放一次, N = 循环 N+1 次
```

## 5. 优化建议与最佳实践

### 5.1 不同场景的推荐设置

#### 场景 1: UI 截图 / 教程演示
```
录制帧率: 10 FPS
质量: 70-80%
抖动: Atkinson
调色板: 全局
尺寸: 原始或 75%
帧优化: 开启
```
**预期效果:** 文件小,清晰度高,适合分享

#### 场景 2: 动画 / 游戏录制
```
录制帧率: 15-20 FPS
质量: 50-70%
抖动: Floyd-Steinberg
调色板: 局部
尺寸: 50-75%
帧优化: 关闭
```
**预期效果:** 流畅度好,文件适中

#### 场景 3: 视频片段
```
录制帧率: 20-25 FPS
质量: 30-50%
抖动: False Floyd-Steinberg
调色板: 局部
尺寸: 50%
帧优化: 开启(低容差)
```
**预期效果:** 可接受的质量,文件较大

### 5.2 文件大小估算

**公式:**
```
文件大小 ≈ (宽度 × 高度 × 帧数 × 质量系数) / LZW 压缩率

质量系数:
- 无抖动 + 全局调色板: 0.3 - 0.5
- 有抖动 + 局部调色板: 0.6 - 1.0

LZW 压缩率:
- 简单图像(UI/图标): 3-5x
- 复杂图像(照片): 1.5-2x
```

**示例计算:**
```
800×600 像素, 100 帧, 质量 80%, Floyd-Steinberg 抖动

估算:
= 800 × 600 × 100 × 0.7 / 3
= 11,200,000 字节 / 3
≈ 3.7 MB
```

### 5.3 性能优化建议

1. **限制录制时长**: 建议不超过 10 秒
2. **限制分辨率**: 建议不超过 1280×720
3. **合理选择帧率**: UI 录制 10 FPS 足够,游戏 20 FPS
4. **使用全局调色板**: 颜色变化不大时优先选择
5. **开启帧优化**: 静止画面多的场景必开

## 6. 技术细节与源码位置

### 6.1 关键文件

| 文件 | 作用 | 关键函数 |
|------|------|---------|
| `NeuQuant.js` | 神经网络颜色量化 | `learn()`, `buildColormap()` |
| `GIFEncoder.js` | GIF 编码器 | `analyzePixels()`, `setQuality()` |
| `LZWEncoder.js` | LZW 压缩 | `encode()` |
| `gif.worker.js` | Web Worker 线程 | 并行处理帧 |

### 6.2 参数传递链路

```
recorder.js (用户界面)
  ↓
quality-slider (1-100)
  ↓
Math.floor((100 - quality) / 10) + 1
  ↓
GIF({ quality: N })
  ↓
GIFEncoder.setQuality(N)
  ↓
NeuQuant(pixels, samplefac=N)
  ↓
samplepixels = lengthcount / (3 * N)
```

### 6.3 核心算法伪代码

#### NeuQuant 颜色量化
```python
def neuquant(pixels, quality):
    # 初始化 256 个神经元
    network = [均匀分布的颜色] * 256

    # 计算采样像素
    sample_pixels = len(pixels) // (3 * quality)

    # 学习循环 (100 次)
    for cycle in range(100):
        for each sampled_pixel:
            # 找到最接近的神经元
            winner = find_closest_neuron(sampled_pixel, network)

            # 调整 winner 及其邻近神经元的颜色
            adjust_neuron(winner, sampled_pixel, learning_rate)
            adjust_neighbors(winner, sampled_pixel, radius, learning_rate)

        # 逐步降低学习率和邻域半径
        learning_rate *= decay_factor
        radius *= decay_factor

    return network  # 最终的 256 色调色板
```

#### Floyd-Steinberg 抖动
```python
def floyd_steinberg_dither(image, palette):
    for y in range(height):
        for x in range(width):
            old_pixel = image[y][x]
            new_pixel = find_closest_color(old_pixel, palette)
            image[y][x] = new_pixel

            error = old_pixel - new_pixel

            # 分配误差到相邻像素
            image[y][x+1] += error * 7/16
            image[y+1][x-1] += error * 3/16
            image[y+1][x] += error * 5/16
            image[y+1][x+1] += error * 1/16
```

## 7. 参考资料

1. **GIF 规范**: [GIF89a Specification](https://www.w3.org/Graphics/GIF/spec-gif89a.txt)
2. **NeuQuant 论文**: Dekker, A.H. (1994). "Kohonen neural networks for optimal colour quantization"
3. **LZW 压缩**: Welch, T.A. (1984). "A Technique for High-Performance Data Compression"
4. **Floyd-Steinberg 抖动**: Floyd, R. & Steinberg, L. (1976). "An Adaptive Algorithm for Spatial Greyscale"
5. **gif.js 源码**: [https://github.com/jnordberg/gif.js](https://github.com/jnordberg/gif.js)

## 8. 总结

GIF 压缩是一个多层次的过程:

1. **颜色量化** (最关键): 从数百万色减少到 256 色
   - NeuQuant 算法: 神经网络学习最优调色板
   - `quality` 参数: 控制采样密度,影响颜色准确度

2. **抖动处理** (视觉优化): 通过误差扩散改善色带
   - Floyd-Steinberg: 最常用,效果好
   - 代价: 增加文件大小 10-30%

3. **LZW 压缩** (无损): 压缩索引像素数据
   - 自动进行,无需人工干预
   - 适合色块大的图像

4. **帧优化** (可选): 跳过相似帧减少文件大小

**核心权衡:**
- **质量 vs 文件大小**: quality 参数
- **视觉效果 vs 文件大小**: 抖动开关
- **颜色准确度 vs 文件大小**: 全局/局部调色板
- **清晰度 vs 文件大小**: 输出尺寸

通过合理组合这些参数,可以在质量、大小、速度之间找到最佳平衡点。
