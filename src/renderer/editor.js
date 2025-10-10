const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');
const GIF = require('gif.js');

let gifData = null;
let currentFrame = 0;
let isPlaying = false;
let playInterval = null;
let frames = [];
let delay = 100;
let frameImages = [];

const canvas = document.getElementById('preview-canvas');
const ctx = canvas.getContext('2d');

// 接收 GIF 数据
ipcRenderer.on('load-gif', (event, data) => {
  gifData = data;
  frames = data.frames;
  delay = data.delay || 100;

  canvas.width = data.width;
  canvas.height = data.height;

  loadFrameImages();
});

async function loadFrameImages() {
  // 将 dataURL 转换为 Image 对象
  frameImages = await Promise.all(frames.map(dataURL => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = dataURL;
    });
  }));

  // 过滤掉加载失败的图片
  frameImages = frameImages.filter(img => img !== null);

  if (frameImages.length > 0) {
    initializeEditor();
  } else {
    alert('加载帧数据失败，请重试');
  }
}

function initializeEditor() {
  // 初始化时间轴
  renderTimeline();

  // 显示第一帧
  showFrame(0);

  // 更新控件
  document.getElementById('trim-end').max = frameImages.length - 1;
  document.getElementById('trim-end').value = frameImages.length - 1;
  document.getElementById('trim-start').max = frameImages.length - 1;
  document.getElementById('trim-end-label').textContent = frameImages.length - 1;
  document.getElementById('speed-slider').value = delay;
  document.getElementById('speed-label').textContent = delay + 'ms';

  updateFrameCounter();
  estimateFileSize();
}

function renderTimeline() {
  const timeline = document.getElementById('timeline-frames');
  timeline.innerHTML = '';

  frameImages.forEach((img, index) => {
    const thumb = document.createElement('div');
    thumb.className = 'frame-thumb';
    thumb.dataset.frameIndex = index;

    // 创建缩略图
    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = 60;
    thumbCanvas.height = 80;
    const thumbCtx = thumbCanvas.getContext('2d');

    // 缩放绘制帧
    const scale = Math.min(60 / img.width, 80 / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    const x = (60 - w) / 2;
    const y = (80 - h) / 2;

    thumbCtx.drawImage(img, x, y, w, h);

    thumb.style.backgroundImage = `url(${thumbCanvas.toDataURL()})`;

    const frameNum = document.createElement('div');
    frameNum.className = 'frame-number';
    frameNum.textContent = index;
    thumb.appendChild(frameNum);

    thumb.addEventListener('click', () => {
      showFrame(index);
    });

    timeline.appendChild(thumb);
  });
}

function showFrame(index) {
  if (index < 0 || index >= frameImages.length) return;

  currentFrame = index;

  // 清空画布并绘制当前帧
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(frameImages[index], 0, 0, canvas.width, canvas.height);

  // 更新时间轴高亮
  document.querySelectorAll('.frame-thumb').forEach((thumb, i) => {
    thumb.classList.toggle('active', i === index);
  });

  updateFrameCounter();
}

function updateFrameCounter() {
  document.getElementById('frame-counter').textContent =
    `帧 ${currentFrame + 1} / ${frameImages.length}`;
}

// 播放控制
document.getElementById('play-btn').addEventListener('click', () => {
  if (isPlaying) {
    stopPlayback();
  } else {
    startPlayback();
  }
});

function startPlayback() {
  isPlaying = true;
  document.getElementById('play-btn').textContent = '暂停';

  playInterval = setInterval(() => {
    currentFrame = (currentFrame + 1) % frameImages.length;
    showFrame(currentFrame);
  }, delay);
}

function stopPlayback() {
  isPlaying = false;
  document.getElementById('play-btn').textContent = '播放';
  if (playInterval) {
    clearInterval(playInterval);
    playInterval = null;
  }
}

// 帧导航
document.getElementById('prev-frame-btn').addEventListener('click', () => {
  stopPlayback();
  showFrame(currentFrame - 1 >= 0 ? currentFrame - 1 : frameImages.length - 1);
});

document.getElementById('next-frame-btn').addEventListener('click', () => {
  stopPlayback();
  showFrame((currentFrame + 1) % frameImages.length);
});

// 裁剪功能
document.getElementById('trim-start').addEventListener('input', (e) => {
  document.getElementById('trim-start-label').textContent = e.target.value;
});

document.getElementById('trim-end').addEventListener('input', (e) => {
  document.getElementById('trim-end-label').textContent = e.target.value;
});

document.getElementById('apply-trim-btn').addEventListener('click', () => {
  const start = parseInt(document.getElementById('trim-start').value);
  const end = parseInt(document.getElementById('trim-end').value);

  if (start >= end) {
    alert('开始帧必须小于结束帧');
    return;
  }

  stopPlayback();
  frameImages = frameImages.slice(start, end + 1);
  currentFrame = 0;

  // 重新初始化
  initializeEditor();
});

// 速度调整
document.getElementById('speed-slider').addEventListener('input', (e) => {
  delay = parseInt(e.target.value);
  document.getElementById('speed-label').textContent = delay + 'ms';

  if (isPlaying) {
    stopPlayback();
    startPlayback();
  }

  estimateFileSize();
});

// 质量调整
document.getElementById('quality-slider').addEventListener('input', (e) => {
  document.getElementById('quality-label').textContent = e.target.value + '%';
  estimateFileSize();
});

// 导出功能
document.getElementById('export-btn').addEventListener('click', async () => {
  const quality = parseInt(document.getElementById('quality-slider').value);

  stopPlayback();

  // 选择保存位置 - 优先使用 IPC 方式
  let result;
  try {
    result = await ipcRenderer.invoke('show-save-dialog', {
      title: '保存 GIF',
      defaultPath: `freegif-${Date.now()}.gif`,
      filters: [
        { name: 'GIF 文件', extensions: ['gif'] }
      ]
    });
  } catch (e) {
    // 备选方案：使用 remote
    try {
      const { dialog } = require('@electron/remote') || require('electron').remote;
      result = await dialog.showSaveDialog({
        title: '保存 GIF',
        defaultPath: `freegif-${Date.now()}.gif`,
        filters: [
          { name: 'GIF 文件', extensions: ['gif'] }
        ]
      });
    } catch (e2) {
      alert('无法打开保存对话框');
      return;
    }
  }

  if (result.canceled || !result.filePath) return;

  document.getElementById('export-btn').disabled = true;
  document.getElementById('export-btn').textContent = '导出中...';

  try {
    await exportGIF(result.filePath, quality);
    alert('GIF 导出成功！');
  } catch (error) {
    console.error('Export error:', error);
    alert('导出失败: ' + error.message);
  } finally {
    document.getElementById('export-btn').disabled = false;
    document.getElementById('export-btn').textContent = '导出 GIF';
  }
});

async function exportGIF(filePath, quality) {
  return new Promise((resolve, reject) => {
    try {
      const gif = new GIF({
        workers: 2,
        quality: Math.floor((100 - quality) / 10) + 1,
        width: canvas.width,
        height: canvas.height,
        workerScript: path.join(__dirname, '../../node_modules/gif.js/dist/gif.worker.js')
      });

      // 添加所有帧
      frameImages.forEach((img) => {
        // 创建临时canvas绘制每一帧
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(img, 0, 0, canvas.width, canvas.height);

        gif.addFrame(tempCanvas, { delay: delay, copy: true });
      });

      gif.on('finished', (blob) => {
        // 将 blob 转换为 buffer 并写入文件
        const reader = new FileReader();
        reader.onload = () => {
          const buffer = Buffer.from(reader.result);
          fs.writeFile(filePath, buffer, (err) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
        };
        reader.onerror = reject;
        reader.readAsArrayBuffer(blob);
      });

      gif.on('error', reject);

      gif.render();
    } catch (error) {
      reject(error);
    }
  });
}

function estimateFileSize() {
  const quality = parseInt(document.getElementById('quality-slider').value);
  const pixelCount = canvas.width * canvas.height;
  const frameCount = frameImages.length;

  // 粗略估算（实际大小会有差异）
  const bytesPerPixel = (quality / 100) * 3;
  const estimatedBytes = pixelCount * frameCount * bytesPerPixel * 0.5;

  let sizeStr;
  if (estimatedBytes < 1024) {
    sizeStr = estimatedBytes.toFixed(0) + ' B';
  } else if (estimatedBytes < 1024 * 1024) {
    sizeStr = (estimatedBytes / 1024).toFixed(1) + ' KB';
  } else {
    sizeStr = (estimatedBytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  document.getElementById('file-size-info').textContent = `预计大小: ${sizeStr}`;
}
