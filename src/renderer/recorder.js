const { ipcRenderer, desktopCapturer } = require('electron');
const fs = require('fs');
const path = require('path');

// gif.js 通过 script 标签加载，挂载到全局 window.GIF
// 不需要 require

// 录制相关变量
let mediaRecorder;
let recordedChunks = [];
let stream;
let recordingBounds;
let recordingStartTime;
let timerInterval;

// 编辑相关变量
let currentFrame = 0;
let isPlaying = false;
let playInterval = null;
let frames = [];
let frameImages = [];
let delay = 100;
let recordingFPS = 10; // 默认录制帧率
let playbackSpeed = 1; // 播放速度倍率
let isLooping = true; // 是否循环播放

// 获取元素
const recorderMode = document.getElementById('recorder-mode');
const editorMode = document.getElementById('editor-mode');
const emptyState = document.getElementById('empty-state');
const editorWorkspace = document.getElementById('editor-workspace');
const previewCanvas = document.getElementById('preview-canvas');
const editCanvas = document.getElementById('edit-canvas');
const previewCtx = previewCanvas.getContext('2d');
const editCtx = editCanvas.getContext('2d');

// ========== 初始化 ==========

// 启动时显示空状态
window.addEventListener('DOMContentLoaded', () => {
  showEmptyState();
});

function showEmptyState() {
  emptyState.classList.remove('hidden');
  editorWorkspace.classList.remove('active');
  document.getElementById('export-btn').style.display = 'none';
}

function hideEmptyState() {
  emptyState.classList.add('hidden');
  editorWorkspace.classList.add('active');
  document.getElementById('export-btn').style.display = 'inline-block';
}

// ========== 开始录制按钮 ==========

document.getElementById('start-record-btn').addEventListener('click', () => {
  ipcRenderer.send('start-selection');
});

// ========== 导入 GIF 按钮 ==========

document.getElementById('import-gif-btn').addEventListener('click', async () => {
  let result;
  try {
    result = await ipcRenderer.invoke('show-open-dialog', {
      title: '导入 GIF',
      filters: [
        { name: 'GIF 文件', extensions: ['gif'] }
      ],
      properties: ['openFile']
    });
  } catch (e) {
    try {
      const { dialog } = require('@electron/remote') || require('electron').remote;
      result = await dialog.showOpenDialog({
        title: '导入 GIF',
        filters: [
          { name: 'GIF 文件', extensions: ['gif'] }
        ],
        properties: ['openFile']
      });
    } catch (e2) {
      alert('无法打开文件选择对话框');
      return;
    }
  }

  if (result.canceled || !result.filePaths || result.filePaths.length === 0) return;

  const gifPath = result.filePaths[0];
  await importGIF(gifPath);
});

async function importGIF(filePath) {
  try {
    // 读取 GIF 文件
    const gifBuffer = fs.readFileSync(filePath);
    const blob = new Blob([gifBuffer], { type: 'image/gif' });
    const url = URL.createObjectURL(blob);

    // 使用 Image 加载 GIF 获取尺寸
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });

    // 简化版：将 GIF 作为单帧处理
    // TODO: 实际应该解析 GIF 的所有帧
    const gifData = {
      frames: [url],
      width: img.width,
      height: img.height,
      delay: 100
    };

    URL.revokeObjectURL(url);

    // 切换到编辑模式
    editorMode.classList.add('active');
    recorderMode.classList.add('hidden');
    switchToEditorMode(gifData);

  } catch (error) {
    console.error('Import GIF error:', error);
    alert('导入 GIF 失败: ' + error.message);
  }
}

// ========== 录制模式 ==========

ipcRenderer.on('start-recording', async (event, bounds) => {
  if (!bounds) {
    console.log('No bounds provided, skipping recording');
    return;
  }

  // 切换到录制模式（预览状态）
  editorMode.classList.remove('active');
  recorderMode.classList.remove('hidden');

  recordingBounds = bounds;

  // 设置预览模式，不立即开始录制
  await setupPreviewMode(bounds);
});

// 设置预览模式（不立即录制）
async function setupPreviewMode(bounds) {
  try {
    // 获取屏幕源
    const sources = await ipcRenderer.invoke('get-sources');
    const primarySource = sources[0];

    // 获取屏幕流
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: primarySource.id,
          minWidth: 1280,
          maxWidth: 4000,
          minHeight: 720,
          maxHeight: 4000
        }
      }
    });

    // 设置预览
    setupRecordingPreview(stream, bounds);

    // 显示帧率选择、重新截取和开始录制按钮，隐藏停止按钮
    document.getElementById('fps-control').style.display = 'flex';
    document.getElementById('reselect-btn').style.display = 'inline-block';
    document.getElementById('start-recording-btn').style.display = 'inline-block';
    document.getElementById('stop-btn').style.display = 'none';
    document.getElementById('recording-indicator').style.display = 'none';
    document.getElementById('timer').style.display = 'none';

  } catch (error) {
    console.error('Error setting up preview:', error);
    alert('预览失败: ' + error.message + '\n\n可能需要授予屏幕录制权限');
    ipcRenderer.send('cancel-selection');
  }
}

async function startRecording(bounds) {
  try {
    // 读取用户选择的帧率
    recordingFPS = parseInt(document.getElementById('fps-select').value);
    console.log('录制帧率设置为:', recordingFPS, 'FPS');

    // 隐藏帧率选择、重新截取和开始按钮，显示停止按钮和计时器
    document.getElementById('fps-control').style.display = 'none';
    document.getElementById('reselect-btn').style.display = 'none';
    document.getElementById('start-recording-btn').style.display = 'none';
    document.getElementById('stop-btn').style.display = 'inline-block';
    document.getElementById('recording-indicator').style.display = 'block';
    document.getElementById('timer').style.display = 'inline-block';

    // 如果还没有 stream，需要重新获取
    if (!stream) {
      const sources = await ipcRenderer.invoke('get-sources');
      const primarySource = sources[0];

      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: primarySource.id,
            minWidth: 1280,
            maxWidth: 4000,
            minHeight: 720,
            maxHeight: 4000
          }
        }
      });

      setupRecordingPreview(stream, bounds);
    }

    // 创建 MediaRecorder
    const options = { mimeType: 'video/webm; codecs=vp9' };
    mediaRecorder = new MediaRecorder(stream, options);

    mediaRecorder.ondataavailable = handleDataAvailable;
    mediaRecorder.onstop = handleStop;

    recordedChunks = [];
    mediaRecorder.start();

    // 开始计时
    recordingStartTime = Date.now();
    updateTimer();
    timerInterval = setInterval(updateTimer, 1000);

  } catch (error) {
    console.error('Error starting recording:', error);
    alert('录制失败: ' + error.message + '\n\n可能需要授予屏幕录制权限');
    ipcRenderer.send('cancel-selection');
  }
}

function setupRecordingPreview(mediaStream, bounds) {
  const video = document.createElement('video');
  video.srcObject = mediaStream;
  video.muted = true;
  video.play();

  previewCanvas.width = bounds.width;
  previewCanvas.height = bounds.height;

  video.onloadedmetadata = () => {
    const updatePreview = () => {
      // 预览模式下也要持续更新，不只是录制时
      if (stream && stream.active) {
        // 使用传递过来的显示器实际分辨率
        const displayWidth = bounds.displayWidth || (window.screen.width * (bounds.scaleFactor || 1));
        const displayHeight = bounds.displayHeight || (window.screen.height * (bounds.scaleFactor || 1));

        const scaleX = video.videoWidth / displayWidth;
        const scaleY = video.videoHeight / displayHeight;

        previewCtx.drawImage(
          video,
          bounds.x * scaleX,
          bounds.y * scaleY,
          bounds.width * scaleX,
          bounds.height * scaleY,
          0,
          0,
          bounds.width,
          bounds.height
        );

        requestAnimationFrame(updatePreview);
      }
    };
    updatePreview();
  };
}

function updateTimer() {
  const elapsed = Date.now() - recordingStartTime;
  const seconds = Math.floor(elapsed / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  document.getElementById('timer').textContent =
    `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

document.getElementById('stop-btn').addEventListener('click', () => {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    clearInterval(timerInterval);
  }
});

// 开始录制按钮（预览模式下点击）
document.getElementById('start-recording-btn').addEventListener('click', () => {
  if (recordingBounds) {
    startRecording(recordingBounds);
  }
});

// 重新截取按钮（预览模式下点击）
document.getElementById('reselect-btn').addEventListener('click', () => {
  // 停止当前的预览流
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }

  // 清空预览画布
  if (previewCtx) {
    previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
  }

  // 重置录制边界
  recordingBounds = null;

  // 隐藏录制窗口，打开选择器
  ipcRenderer.send('start-selection');
});

function handleDataAvailable(event) {
  if (event.data.size > 0) {
    recordedChunks.push(event.data);
  }
}

async function handleStop() {
  console.log('========== 开始处理录制停止 ==========');
  const blob = new Blob(recordedChunks, { type: 'video/webm' });
  console.log('视频 blob 大小:', (blob.size / 1024 / 1024).toFixed(2), 'MB');

  // 停止所有轨道
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    console.log('已停止媒体流');
  }

  // 隐藏录制模式
  recorderMode.classList.add('hidden');
  console.log('已隐藏录制模式');

  // 切换到编辑模式（但显示加载状态）
  editorMode.classList.add('active');
  console.log('已显示编辑模式');

  // 立即显示加载提示
  showLoading();

  // 使用 setTimeout 让 UI 先渲染
  setTimeout(async () => {
    console.log('开始转换视频');
    try {
      // 将视频转换为帧
      const gifData = await convertToGIF(blob, recordingBounds);

      console.log('转换完成，帧数:', gifData.frames.length);

      // 隐藏加载提示
      hideLoading();

      // 切换到编辑模式
      switchToEditorMode(gifData);
    } catch (error) {
      console.error('转换失败:', error);
      hideLoading();
      alert('视频处理失败: ' + error.message + '\n\n请重新录制');

      // 回到编辑模式主界面
      showEmptyState();
    }
  }, 100);
}

function showLoading() {
  console.log('显示加载提示');
  const overlay = document.getElementById('loading-overlay');
  overlay.classList.add('active');
  overlay.style.display = 'flex'; // 强制显示
  document.getElementById('loading-progress').textContent = '准备中...';
  console.log('加载提示已显示，overlay display:', overlay.style.display);
}

function hideLoading() {
  console.log('隐藏加载提示');
  const overlay = document.getElementById('loading-overlay');
  overlay.classList.remove('active');
  overlay.style.display = 'none';
}

function updateLoadingProgress(current, total) {
  document.getElementById('loading-progress').textContent = `${current} / ${total} 帧`;
}

async function convertToGIF(videoBlob, bounds) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.src = URL.createObjectURL(videoBlob);
    video.muted = true;
    video.preload = 'auto';

    video.onloadedmetadata = async () => {
      console.log('Video metadata loaded');
      console.log('Video duration:', video.duration);
      console.log('Recording time:', (Date.now() - recordingStartTime) / 1000, 'seconds');

      // WebM 视频的 duration 可能是 Infinity，我们使用录制时间作为备选
      let duration;
      if (isFinite(video.duration) && video.duration > 0) {
        duration = video.duration;
        console.log('使用视频元数据时长:', duration);
      } else {
        // 使用录制时间计算（从开始到停止的实际时间）
        duration = (Date.now() - recordingStartTime) / 1000;
        console.log('视频时长无效，使用录制时间:', duration);
      }

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      canvas.width = bounds.width;
      canvas.height = bounds.height;

      const frameList = [];
      const fps = recordingFPS; // 使用用户设置的帧率

      // 计算实际应该提取的帧数
      const actualFrames = Math.floor(duration * fps);
      const totalFrames = Math.min(actualFrames, 300);

      console.log(`视频时长: ${duration.toFixed(2)}s`);
      console.log(`计算帧数: ${duration.toFixed(2)} * ${fps} = ${actualFrames}`);
      console.log(`实际提取: ${totalFrames} 帧（最大限制300）`);

      if (totalFrames <= 0) {
        reject(new Error('录制时间过短，请录制至少1秒'));
        return;
      }

      let currentFrameNum = 0;
      let lastSeekFailed = false;

      // 更新初始进度
      requestAnimationFrame(() => {
        updateLoadingProgress(0, totalFrames);
      });

      const processNextFrame = () => {
        if (currentFrameNum >= totalFrames || lastSeekFailed) {
          // 所有帧处理完成或遇到无法 seek 的时间点
          console.log(`帧提取完成，共提取 ${frameList.length} 帧`);

          if (frameList.length === 0) {
            reject(new Error('未能提取任何帧，请重试'));
            return;
          }

          const gifData = {
            frames: frameList,
            width: bounds.width,
            height: bounds.height,
            delay: 100
          };
          URL.revokeObjectURL(video.src);
          resolve(gifData);
          return;
        }

        // 计算当前帧对应的视频时间（秒）
        const targetTime = (currentFrameNum / fps);

        // 不要设置超出范围的时间
        if (isFinite(video.duration) && targetTime >= video.duration) {
          console.log(`时间 ${targetTime.toFixed(2)}s 超过视频时长，停止提取`);
          lastSeekFailed = true;
          processNextFrame(); // 触发完成逻辑
          return;
        }

        video.currentTime = targetTime;
      };

      video.onseeked = () => {
        try {
          // 使用传递过来的显示器实际分辨率
          const displayWidth = bounds.displayWidth || (window.screen.width * (bounds.scaleFactor || 1));
          const displayHeight = bounds.displayHeight || (window.screen.height * (bounds.scaleFactor || 1));

          const scaleX = video.videoWidth / displayWidth;
          const scaleY = video.videoHeight / displayHeight;

          ctx.drawImage(
            video,
            bounds.x * scaleX,
            bounds.y * scaleY,
            bounds.width * scaleX,
            bounds.height * scaleY,
            0,
            0,
            bounds.width,
            bounds.height
          );

          const frameData = canvas.toDataURL('image/png');
          frameList.push(frameData);

          currentFrameNum++;

          // 每10帧输出一次日志
          if (currentFrameNum % 10 === 0 || currentFrameNum === totalFrames) {
            console.log(`已提取 ${currentFrameNum} / ${totalFrames} 帧`);
          }

          // 使用 requestAnimationFrame 更新进度，保证 UI 流畅
          requestAnimationFrame(() => {
            updateLoadingProgress(currentFrameNum, totalFrames);
          });

          // 每处理 5 帧，使用 setTimeout 让出主线程
          if (currentFrameNum % 5 === 0) {
            setTimeout(processNextFrame, 1);
          } else {
            processNextFrame();
          }
        } catch (error) {
          console.error('Frame extraction error:', error);
          reject(error);
        }
      };

      video.onerror = (e) => {
        console.error('Video loading error:', e);
        reject(new Error('视频加载失败'));
      };

      // 开始处理第一帧
      processNextFrame();
    };

    video.onerror = (e) => {
      console.error('Video error during load:', e);
      reject(new Error('视频加载失败'));
    };
  });
}

// ========== 编辑模式 ==========

function switchToEditorMode(gifData) {
  recorderMode.classList.add('hidden');
  editorMode.classList.add('active');
  hideEmptyState();

  frames = gifData.frames;
  delay = gifData.delay || 100;

  editCanvas.width = gifData.width;
  editCanvas.height = gifData.height;

  loadFrameImages();
}

async function loadFrameImages() {
  frameImages = await Promise.all(frames.map(dataURL => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = dataURL;
    });
  }));

  frameImages = frameImages.filter(img => img !== null);

  if (frameImages.length > 0) {
    initializeEditor();
  } else {
    alert('加载帧数据失败，请重试');
  }
}

function initializeEditor() {
  renderTimeline();
  showFrame(0);

  document.getElementById('trim-end').max = frameImages.length - 1;
  document.getElementById('trim-end').value = frameImages.length - 1;
  document.getElementById('trim-start').max = frameImages.length - 1;

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

    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = 60;
    thumbCanvas.height = 80;
    const thumbCtx = thumbCanvas.getContext('2d');

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
  editCtx.clearRect(0, 0, editCanvas.width, editCanvas.height);
  editCtx.drawImage(frameImages[index], 0, 0, editCanvas.width, editCanvas.height);

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

  const actualDelay = delay / playbackSpeed; // 根据速度倍率调整延迟

  playInterval = setInterval(() => {
    currentFrame = currentFrame + 1;

    // 检查是否到达最后一帧
    if (currentFrame >= frameImages.length) {
      if (isLooping) {
        // 循环播放，从头开始
        currentFrame = 0;
      } else {
        // 不循环，停止播放
        stopPlayback();
        currentFrame = frameImages.length - 1; // 停在最后一帧
      }
    }

    showFrame(currentFrame);
  }, actualDelay);
}

function stopPlayback() {
  isPlaying = false;
  document.getElementById('play-btn').textContent = '播放';
  if (playInterval) {
    clearInterval(playInterval);
    playInterval = null;
  }
}

document.getElementById('prev-frame-btn').addEventListener('click', () => {
  stopPlayback();
  showFrame(currentFrame - 1 >= 0 ? currentFrame - 1 : frameImages.length - 1);
});

document.getElementById('next-frame-btn').addEventListener('click', () => {
  stopPlayback();
  showFrame((currentFrame + 1) % frameImages.length);
});

// 速度控制按钮
document.querySelectorAll('.speed-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    // 移除所有按钮的 active 类
    document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
    // 添加当前按钮的 active 类
    btn.classList.add('active');

    // 更新播放速度
    playbackSpeed = parseFloat(btn.dataset.speed);

    // 如果正在播放，重启播放以应用新速度
    if (isPlaying) {
      stopPlayback();
      startPlayback();
    }
  });
});

// 循环播放复选框
document.getElementById('loop-checkbox').addEventListener('change', (e) => {
  isLooping = e.target.checked;
});

// 裁剪功能
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

  initializeEditor();
});

// 质量预设配置
const qualityPresets = {
  high: {
    quality: 90,
    dither: 'FloydSteinberg',
    palette: 'local',
    description: '高质量模式 - 颜色准确,细节丰富,文件较大'
  },
  medium: {
    quality: 70,
    dither: 'FloydSteinberg',
    palette: 'local',
    description: '标准质量 - 质量与大小平衡,适合大多数场景'
  },
  low: {
    quality: 40,
    dither: 'FalseFloydSteinberg',
    palette: 'global',
    description: '压缩优先 - 文件最小,适合快速分享'
  }
};

// 质量预设切换
document.getElementById('quality-preset').addEventListener('change', (e) => {
  const preset = e.target.value;

  if (preset === 'custom') {
    // 切换到自定义模式,展开高级设置
    const advancedSettings = document.getElementById('advanced-settings');
    const advancedToggle = document.getElementById('advanced-toggle');
    advancedSettings.classList.remove('hidden');
    advancedToggle.classList.add('expanded');
  } else {
    // 应用预设
    const config = qualityPresets[preset];
    document.getElementById('quality-slider').value = config.quality;
    document.getElementById('quality-label').textContent = config.quality + '%';
    document.getElementById('dither-select').value = config.dither;
    document.getElementById('palette-select').value = config.palette;

    estimateFileSize();
  }
});

// 高级设置折叠/展开
document.getElementById('advanced-toggle').addEventListener('click', () => {
  const advancedSettings = document.getElementById('advanced-settings');
  const advancedToggle = document.getElementById('advanced-toggle');

  advancedSettings.classList.toggle('hidden');
  advancedToggle.classList.toggle('expanded');
});

// 质量调整 - 切换到自定义模式
document.getElementById('quality-slider').addEventListener('input', (e) => {
  document.getElementById('quality-label').textContent = e.target.value + '%';
  document.getElementById('quality-preset').value = 'custom';
  estimateFileSize();
});

// 分辨率缩放 - 切换到自定义模式
document.getElementById('resolution-scale').addEventListener('change', () => {
  document.getElementById('quality-preset').value = 'custom';
  estimateFileSize();
});

// 抖动选择 - 切换到自定义模式
document.getElementById('dither-select').addEventListener('change', () => {
  document.getElementById('quality-preset').value = 'custom';
  estimateFileSize();
});

// 调色板选择 - 切换到自定义模式
document.getElementById('palette-select').addEventListener('change', () => {
  document.getElementById('quality-preset').value = 'custom';
  estimateFileSize();
});

// 导出功能
document.getElementById('export-btn').addEventListener('click', async () => {
  const quality = parseInt(document.getElementById('quality-slider').value);
  stopPlayback();

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
      // 读取用户设置
      const ditherValue = document.getElementById('dither-select').value;
      const paletteMode = document.getElementById('palette-select').value;
      const resolutionScale = parseFloat(document.getElementById('resolution-scale').value);

      // 处理抖动参数
      const ditherOption = ditherValue === 'false' ? false : ditherValue + '-serpentine';

      // 计算输出尺寸
      const outputWidth = Math.round(editCanvas.width * resolutionScale);
      const outputHeight = Math.round(editCanvas.height * resolutionScale);

      const gif = new window.GIF({
        workers: 2,
        quality: Math.floor((100 - quality) / 10) + 1,
        width: outputWidth,
        height: outputHeight,
        dither: ditherOption,
        globalPalette: paletteMode === 'global',
        workerScript: path.join(__dirname, '../../node_modules/gif.js/dist/gif.worker.js')
      });

      frameImages.forEach((img) => {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = outputWidth;
        tempCanvas.height = outputHeight;
        const tempCtx = tempCanvas.getContext('2d');

        // 缩放绘制
        tempCtx.drawImage(img, 0, 0, outputWidth, outputHeight);

        gif.addFrame(tempCanvas, { delay: delay, copy: true });
      });

      gif.on('finished', (blob) => {
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
  const resolutionScale = parseFloat(document.getElementById('resolution-scale').value);

  // 使用缩放后的尺寸计算
  const outputWidth = Math.round(editCanvas.width * resolutionScale);
  const outputHeight = Math.round(editCanvas.height * resolutionScale);
  const pixelCount = outputWidth * outputHeight;
  const frameCount = frameImages.length;

  // 读取抖动和调色板设置
  const ditherValue = document.getElementById('dither-select').value;
  const paletteMode = document.getElementById('palette-select').value;

  // 基础字节数计算
  const bytesPerPixel = (quality / 100) * 3;

  // 抖动系数 (抖动会增加细节,降低LZW压缩效率)
  let ditherFactor = 1.0;
  if (ditherValue !== 'false') {
    ditherFactor = 1.2; // 抖动大约增加 20% 文件大小
  }

  // 调色板系数 (全局调色板更小)
  let paletteFactor = 1.0;
  if (paletteMode === 'global') {
    paletteFactor = 0.95; // 大约减少 5%
  }

  // LZW 压缩率 (假设 3x,实际取决于图像复杂度)
  const lzwCompressionRatio = 3;

  // 估算公式
  let estimatedBytes = (pixelCount * frameCount * bytesPerPixel * ditherFactor * paletteFactor * 0.5) / lzwCompressionRatio;

  // 添加帧头部、调色板等开销
  const headerOverhead = frameCount * 800 + 2000; // 每帧约800字节开销
  estimatedBytes += headerOverhead;

  let sizeStr;
  if (estimatedBytes < 1024) {
    sizeStr = estimatedBytes.toFixed(0) + ' B';
  } else if (estimatedBytes < 1024 * 1024) {
    sizeStr = (estimatedBytes / 1024).toFixed(1) + ' KB';
  } else {
    sizeStr = (estimatedBytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  // 显示详细信息
  const detailsText = `预计大小: ${sizeStr} (${frameCount} 帧, ${outputWidth}×${outputHeight})`;
  document.getElementById('file-size-info').textContent = detailsText;
}
