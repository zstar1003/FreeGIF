const { ipcRenderer, desktopCapturer } = require('electron');
const fs = require('fs');
const path = require('path');
const omggif = require('omggif');

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

// 文本图层系统
let textLayers = []; // 文本图层数组
let selectedTextLayer = null; // 当前选中的文本图层
let isDraggingText = false;
let dragOffsetX = 0;
let dragOffsetY = 0;

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
  document.getElementById('add-text-btn').style.display = 'inline-block';
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
      showNotification('无法打开文件选择对话框', 'error');
      return;
    }
  }

  if (result.canceled || !result.filePaths || result.filePaths.length === 0) return;

  const gifPath = result.filePaths[0];
  await importGIF(gifPath);
});

async function importGIF(filePath) {
  try {
    // 切换到编辑模式并显示加载提示
    editorMode.classList.add('active');
    recorderMode.classList.add('hidden');

    // 立即显示加载提示
    showLoading('正在导入 GIF...');
    document.getElementById('loading-progress').textContent = '正在读取 GIF...';

    // 使用 setTimeout 让 UI 先渲染
    await new Promise(resolve => setTimeout(resolve, 100));

    // 读取 GIF 文件
    const gifBuffer = fs.readFileSync(filePath);

    document.getElementById('loading-progress').textContent = '正在解析 GIF...';
    await new Promise(resolve => setTimeout(resolve, 50));

    // 使用 omggif 解析 GIF
    const gifReader = new omggif.GifReader(new Uint8Array(gifBuffer));

    const frameCount = gifReader.numFrames();
    const width = gifReader.width;
    const height = gifReader.height;

    console.log(`GIF 信息: ${width}x${height}, ${frameCount} 帧`);

    if (frameCount === 0) {
      throw new Error('GIF 文件中没有找到帧');
    }

    const frames = [];
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = width;
    canvas.height = height;

    // 解析每一帧
    for (let i = 0; i < frameCount; i++) {
      try {
        // 获取帧信息
        const frameInfo = gifReader.frameInfo(i);

        // 创建像素数组
        const pixels = new Uint8ClampedArray(width * height * 4);

        // 解码帧
        gifReader.decodeAndBlitFrameRGBA(i, pixels);

        // 创建 ImageData
        const imageData = new ImageData(pixels, width, height);

        // 绘制到 canvas
        ctx.putImageData(imageData, 0, 0);

        // 转换为 dataURL
        const dataURL = canvas.toDataURL('image/png');
        frames.push(dataURL);

        // 更新进度 (使用 requestAnimationFrame 保证 UI 流畅)
        await new Promise(resolve => {
          requestAnimationFrame(() => {
            document.getElementById('loading-progress').textContent =
              `${i + 1} / ${frameCount} 帧`;
            resolve();
          });
        });

        // 每处理 5 帧,让出主线程
        if (i % 5 === 0) {
          await new Promise(resolve => setTimeout(resolve, 1));
        }

      } catch (frameError) {
        console.error(`解析第 ${i} 帧失败:`, frameError);
        // 继续解析下一帧
      }
    }

    if (frames.length === 0) {
      throw new Error('无法解析任何帧');
    }

    console.log(`成功解析 ${frames.length} 帧`);

    // 获取第一帧的延迟时间
    const firstFrameInfo = gifReader.frameInfo(0);
    const delay = (firstFrameInfo.delay || 10) * 10; // GIF delay 是 1/100 秒

    const gifData = {
      frames: frames,
      width: width,
      height: height,
      delay: delay
    };

    // 隐藏加载提示
    hideLoading();

    // 切换到编辑模式
    switchToEditorMode(gifData);

  } catch (error) {
    console.error('Import GIF error:', error);
    hideLoading();
    showNotification('导入 GIF 失败: ' + (error.message || '未知错误'), 'error');

    // 发生错误时回到空状态
    showEmptyState();
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
    showNotification('预览失败: ' + error.message + '\n\n可能需要授予屏幕录制权限', 'error');
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
    showNotification('录制失败: ' + error.message + '\n\n可能需要授予屏幕录制权限', 'error');
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
  showLoading('正在处理视频...');

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
      showNotification('视频处理失败: ' + error.message + '\n\n请重新录制', 'error');

      // 回到编辑模式主界面
      showEmptyState();
    }
  }, 100);
}

function showLoading(title = '正在处理...') {
  console.log('显示加载提示');
  const overlay = document.getElementById('loading-overlay');
  overlay.classList.add('active');
  overlay.style.display = 'flex'; // 强制显示
  document.querySelector('.loading-text').textContent = title;
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

// ========== 通知弹窗 ==========

function showNotification(message, type = 'success') {
  const modal = document.getElementById('notification-modal');
  const icon = document.getElementById('notification-icon');
  const messageEl = document.getElementById('notification-message');

  // 设置图标和样式
  icon.className = 'notification-icon ' + type;
  if (type === 'success') {
    icon.textContent = '✓';
  } else if (type === 'error') {
    icon.textContent = '✕';
  } else if (type === 'info') {
    icon.textContent = 'ℹ';
  }

  messageEl.textContent = message;
  modal.classList.add('active');
}

function hideNotification() {
  const modal = document.getElementById('notification-modal');
  modal.classList.remove('active');
}

// 点击确定按钮关闭通知
document.getElementById('notification-btn').addEventListener('click', () => {
  hideNotification();
});

// 点击背景关闭通知
document.getElementById('notification-modal').addEventListener('click', (e) => {
  if (e.target.id === 'notification-modal') {
    hideNotification();
  }
});

// ========== 关于软件弹窗 ==========

function showAbout() {
  const modal = document.getElementById('about-modal');
  modal.classList.add('active');
}

function hideAbout() {
  const modal = document.getElementById('about-modal');
  modal.classList.remove('active');
}

// 点击关于按钮显示弹窗
document.getElementById('about-btn').addEventListener('click', () => {
  showAbout();
});

// 点击关闭按钮关闭弹窗
document.getElementById('about-close-btn').addEventListener('click', () => {
  hideAbout();
});

// 点击背景关闭弹窗
document.getElementById('about-modal').addEventListener('click', (e) => {
  if (e.target.id === 'about-modal') {
    hideAbout();
  }
});

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
      const totalFrames = actualFrames; // 移除帧数限制

      console.log(`视频时长: ${duration.toFixed(2)}s`);
      console.log(`计算帧数: ${duration.toFixed(2)} * ${fps} = ${actualFrames}`);

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

  // 不再预加载所有图片，改为懒加载
  frameImages = []; // 清空
  initializeEditor();
}

// 懒加载帧图片 - 只在需要时创建
function getFrameImage(index) {
  return new Promise((resolve, reject) => {
    // 如果已经加载过，直接返回
    if (frameImages[index]) {
      resolve(frameImages[index]);
      return;
    }

    // 创建新的 Image 对象
    const img = new Image();
    img.onload = () => {
      frameImages[index] = img;
      resolve(img);
    };
    img.onerror = () => reject(new Error(`加载第 ${index + 1} 帧失败`));
    img.src = frames[index];
  });
}

function initializeEditor() {
  renderTimeline();
  showFrame(0);

  // 设置裁剪帧的范围和默认值（从1开始显示）
  document.getElementById('trim-start').min = 1;
  document.getElementById('trim-start').value = 1;
  document.getElementById('trim-end').min = 1;
  document.getElementById('trim-end').max = frames.length;
  document.getElementById('trim-end').value = frames.length;

  updateFrameCounter();
  updateResolutionInfo();
  estimateFileSize();
}

function renderTimeline() {
  const timeline = document.getElementById('timeline-frames');
  timeline.innerHTML = '';

  frames.forEach((frame, index) => {
    const thumb = document.createElement('div');
    thumb.className = 'frame-thumb';
    thumb.dataset.frameIndex = index;

    // 不再生成缩略图，使用纯色背景
    thumb.style.backgroundColor = '#1a1a1a';

    const frameNum = document.createElement('div');
    frameNum.className = 'frame-number';
    frameNum.textContent = index + 1; // 从1开始显示
    thumb.appendChild(frameNum);

    thumb.addEventListener('click', () => {
      showFrame(index);
    });

    timeline.appendChild(thumb);
  });
}

async function showFrame(index) {
  if (index < 0 || index >= frames.length) return;

  currentFrame = index;

  // 懒加载当前帧图片
  try {
    const img = await getFrameImage(index);
    editCtx.clearRect(0, 0, editCanvas.width, editCanvas.height);
    editCtx.drawImage(img, 0, 0, editCanvas.width, editCanvas.height);
  } catch (error) {
    console.error('显示帧失败:', error);
  }

  document.querySelectorAll('.frame-thumb').forEach((thumb, i) => {
    thumb.classList.toggle('active', i === index);
  });

  updateFrameCounter();

  // 播放时自动滚动时间轴
  if (isPlaying) {
    const timelineContainer = document.querySelector('.timeline-container');
    const activeThumb = document.querySelector('.frame-thumb.active');

    if (timelineContainer && activeThumb) {
      const containerWidth = timelineContainer.clientWidth;
      const thumbWidth = 60; // 缩略图宽度
      const thumbPosition = index * thumbWidth;

      // 计算滚动位置，使当前帧保持在视野左侧1/4处
      const targetScroll = thumbPosition - containerWidth / 4;

      // 如果是循环回到第一帧（index=0），使用瞬间滚动
      const scrollBehavior = (index === 0) ? 'auto' : 'smooth';

      // 滚动
      timelineContainer.scrollTo({
        left: Math.max(0, targetScroll),
        behavior: scrollBehavior
      });
    }
  }
}

function updateFrameCounter() {
  document.getElementById('frame-counter').textContent =
    `帧 ${currentFrame + 1} / ${frames.length}`;
}

function updateResolutionInfo() {
  const width = editCanvas.width;
  const height = editCanvas.height;
  document.getElementById('resolution-info').textContent = `分辨率 ${width} x ${height}`;
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
    if (currentFrame >= frames.length) {
      if (isLooping) {
        // 循环播放，从头开始
        currentFrame = 0;
      } else {
        // 不循环，停止播放
        stopPlayback();
        currentFrame = frames.length - 1; // 停在最后一帧
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
  showFrame(currentFrame - 1 >= 0 ? currentFrame - 1 : frames.length - 1);
});

document.getElementById('next-frame-btn').addEventListener('click', () => {
  stopPlayback();
  showFrame((currentFrame + 1) % frames.length);
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
  // 用户输入的是1-based，转换为0-based索引
  const start = parseInt(document.getElementById('trim-start').value) - 1;
  const end = parseInt(document.getElementById('trim-end').value) - 1;

  if (start < 0 || end >= frames.length || start > end) {
    showNotification('帧范围无效，请检查输入', 'error');
    return;
  }

  stopPlayback();

  // 裁剪 frames 数组和 frameImages 数组
  frames = frames.slice(start, end + 1);
  frameImages = frameImages.slice(start, end + 1);

  currentFrame = 0;

  initializeEditor();
});

// ========== 文本图层功能 ==========

let textIdCounter = 0;

// 点击添加文本按钮 - 直接创建文本图层
document.getElementById('add-text-btn').addEventListener('click', () => {
  // 创建默认文本图层
  const textLayer = {
    id: textIdCounter++,
    text: '双击编辑文本',
    x: editCanvas.width / 2,
    y: editCanvas.height / 2,
    fontSize: 32,
    fontFamily: 'Arial',
    color: '#ffffff',
    strokeColor: '#000000',
    strokeWidth: 2,
    rotation: 0
  };

  textLayers.push(textLayer);
  renderTextLayer(textLayer);
  selectTextLayer(textLayer);

  // 延迟后自动进入编辑模式
  setTimeout(() => {
    const textDiv = document.querySelector(`.text-layer[data-layer-id="${textLayer.id}"]`);
    if (textDiv) {
      enterEditMode(textDiv, textLayer);
    }
  }, 100);
});

// 渲染文本图层到DOM
function renderTextLayer(layer) {
  const container = document.getElementById('text-overlay-container');

  // 创建canvas容器的内部容器(用于保持画布的宽高比)
  let canvasContainer = container.querySelector('div');
  if (!canvasContainer) {
    canvasContainer = document.createElement('div');
    container.appendChild(canvasContainer);

    // 设置容器大小匹配画布
    updateTextContainerSize();
  }

  const textDiv = document.createElement('div');
  textDiv.className = 'text-layer';
  textDiv.dataset.layerId = layer.id;
  textDiv.textContent = layer.text;
  textDiv.style.left = `${layer.x}px`;
  textDiv.style.top = `${layer.y}px`;
  textDiv.style.fontSize = `${layer.fontSize}px`;
  textDiv.style.fontFamily = layer.fontFamily;
  textDiv.style.color = layer.color;
  textDiv.style.transform = `translate(-50%, -50%) rotate(${layer.rotation}deg)`;

  // 应用描边
  if (layer.strokeWidth > 0) {
    textDiv.style.webkitTextStroke = `${layer.strokeWidth}px ${layer.strokeColor}`;
    textDiv.style.paintOrder = 'stroke fill';
  }

  // 添加事件监听
  textDiv.addEventListener('mousedown', (e) => handleTextMouseDown(e, layer));
  textDiv.addEventListener('click', (e) => {
    e.stopPropagation();
    selectTextLayer(layer);
  });

  // 双击进入编辑模式
  textDiv.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    enterEditMode(textDiv, layer);
  });

  canvasContainer.appendChild(textDiv);
}

// 进入编辑模式
function enterEditMode(textDiv, layer) {
  // 如果已经在编辑,直接返回
  if (textDiv.getAttribute('contenteditable') === 'true') {
    return;
  }

  isDraggingText = false;
  textDiv.contentEditable = true;
  textDiv.classList.add('editing');
  textDiv.focus();

  // 选中所有文本
  const range = document.createRange();
  range.selectNodeContents(textDiv);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);

  // 失去焦点时退出编辑模式
  const exitEdit = () => {
    textDiv.contentEditable = false;
    textDiv.classList.remove('editing');
    layer.text = textDiv.textContent.trim() || '空文本';
    textDiv.textContent = layer.text;
    textDiv.removeEventListener('blur', exitEdit);
  };

  textDiv.addEventListener('blur', exitEdit);

  // 按Enter键退出编辑
  textDiv.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      textDiv.blur();
    }
  });
}

// 更新文本容器大小以匹配画布
function updateTextContainerSize() {
  const canvas = document.getElementById('edit-canvas');
  const container = document.getElementById('text-overlay-container');
  const canvasContainer = container.querySelector('div');

  if (canvasContainer && canvas) {
    const rect = canvas.getBoundingClientRect();
    canvasContainer.style.width = `${canvas.clientWidth}px`;
    canvasContainer.style.height = `${canvas.clientHeight}px`;
  }
}

// 选择文本图层
function selectTextLayer(layer) {
  selectedTextLayer = layer;

  // 更新所有文本图层的选中状态
  document.querySelectorAll('.text-layer').forEach(div => {
    if (parseInt(div.dataset.layerId) === layer.id) {
      div.classList.add('selected');
    } else {
      div.classList.remove('selected');
    }
  });

  // 显示工具栏并填充数据
  showToolbar(layer);
}

// 显示工具栏
function showToolbar(layer) {
  const toolbar = document.getElementById('text-toolbar');
  toolbar.style.display = 'flex';

  // 填充属性值
  document.getElementById('text-font-toolbar').value = layer.fontFamily;
  document.getElementById('text-size-toolbar').value = layer.fontSize;
  document.getElementById('text-color-toolbar').value = layer.color;
  document.getElementById('text-stroke-color-toolbar').value = layer.strokeColor;
  document.getElementById('text-stroke-width-toolbar').value = layer.strokeWidth;
  document.getElementById('text-rotation-toolbar').value = layer.rotation;
}

// 隐藏工具栏
function hideToolbar() {
  document.getElementById('text-toolbar').style.display = 'none';
  selectedTextLayer = null;

  // 取消所有选中状态
  document.querySelectorAll('.text-layer').forEach(div => {
    div.classList.remove('selected');
  });
}

// 工具栏控件事件
document.getElementById('text-font-toolbar').addEventListener('change', (e) => {
  if (selectedTextLayer) {
    selectedTextLayer.fontFamily = e.target.value;
    updateTextLayerDOM(selectedTextLayer);
  }
});

document.getElementById('text-size-toolbar').addEventListener('input', (e) => {
  if (selectedTextLayer) {
    selectedTextLayer.fontSize = parseInt(e.target.value);
    updateTextLayerDOM(selectedTextLayer);
  }
});

document.getElementById('text-color-toolbar').addEventListener('input', (e) => {
  if (selectedTextLayer) {
    selectedTextLayer.color = e.target.value;
    updateTextLayerDOM(selectedTextLayer);
  }
});

document.getElementById('text-stroke-color-toolbar').addEventListener('input', (e) => {
  if (selectedTextLayer) {
    selectedTextLayer.strokeColor = e.target.value;
    updateTextLayerDOM(selectedTextLayer);
  }
});

document.getElementById('text-stroke-width-toolbar').addEventListener('input', (e) => {
  if (selectedTextLayer) {
    selectedTextLayer.strokeWidth = parseInt(e.target.value);
    updateTextLayerDOM(selectedTextLayer);
  }
});

document.getElementById('text-rotation-toolbar').addEventListener('input', (e) => {
  if (selectedTextLayer) {
    selectedTextLayer.rotation = parseInt(e.target.value);
    updateTextLayerDOM(selectedTextLayer);
  }
});

// 更新文本图层DOM
function updateTextLayerDOM(layer) {
  const textDiv = document.querySelector(`.text-layer[data-layer-id="${layer.id}"]`);
  if (textDiv) {
    textDiv.style.fontSize = `${layer.fontSize}px`;
    textDiv.style.fontFamily = layer.fontFamily;
    textDiv.style.color = layer.color;
    textDiv.style.transform = `translate(-50%, -50%) rotate(${layer.rotation}deg)`;

    if (layer.strokeWidth > 0) {
      textDiv.style.webkitTextStroke = `${layer.strokeWidth}px ${layer.strokeColor}`;
      textDiv.style.paintOrder = 'stroke fill';
    } else {
      textDiv.style.webkitTextStroke = '';
    }
  }
}

// 文本拖动
function handleTextMouseDown(e, layer) {
  // 如果在编辑模式,不允许拖动
  const textDiv = e.currentTarget;
  if (textDiv.getAttribute('contenteditable') === 'true') {
    return;
  }

  e.stopPropagation();
  isDraggingText = true;
  selectedTextLayer = layer;

  const rect = textDiv.getBoundingClientRect();
  dragOffsetX = e.clientX - rect.left - rect.width / 2;
  dragOffsetY = e.clientY - rect.top - rect.height / 2;

  selectTextLayer(layer);
}

document.addEventListener('mousemove', (e) => {
  if (isDraggingText && selectedTextLayer) {
    const container = document.getElementById('text-overlay-container').querySelector('div');
    const rect = container.getBoundingClientRect();

    const x = e.clientX - rect.left - dragOffsetX;
    const y = e.clientY - rect.top - dragOffsetY;

    selectedTextLayer.x = x;
    selectedTextLayer.y = y;

    const textDiv = document.querySelector(`.text-layer[data-layer-id="${selectedTextLayer.id}"]`);
    if (textDiv) {
      textDiv.style.left = `${x}px`;
      textDiv.style.top = `${y}px`;
    }
  }
});

document.addEventListener('mouseup', () => {
  isDraggingText = false;
});

// 删除文本按钮(工具栏)
document.getElementById('delete-text-toolbar-btn').addEventListener('click', () => {
  if (selectedTextLayer) {
    // 从数组中删除
    textLayers = textLayers.filter(layer => layer.id !== selectedTextLayer.id);

    // 从DOM中删除
    const textDiv = document.querySelector(`.text-layer[data-layer-id="${selectedTextLayer.id}"]`);
    if (textDiv) {
      textDiv.remove();
    }

    hideToolbar();
    showNotification('文本已删除', 'success');
  }
});

// 应用文本到所有帧(工具栏)
document.getElementById('apply-text-toolbar-btn').addEventListener('click', async () => {
  if (textLayers.length === 0) {
    showNotification('没有文本图层', 'error');
    return;
  }

  stopPlayback();
  showLoading('正在应用文本到所有帧...');

  setTimeout(async () => {
    for (let i = 0; i < frames.length; i++) {
      await applyTextLayersToFrame(i);
      if (i % 5 === 0 || i === frames.length - 1) {
        document.getElementById('loading-progress').textContent = `${i + 1} / ${frames.length} 帧`;
      }
      if (i % 5 === 0) {
        await new Promise(resolve => setTimeout(resolve, 1));
      }
    }

    // 清空文本图层
    textLayers = [];
    document.querySelectorAll('.text-layer').forEach(div => div.remove());
    hideToolbar();

    hideLoading();
    showFrame(currentFrame);
    showNotification('文本已应用到所有帧', 'success');
  }, 100);
});

// 应用所有文本图层到指定帧
async function applyTextLayersToFrame(frameIndex) {
  const img = await getFrameImage(frameIndex);

  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = editCanvas.width;
  tempCanvas.height = editCanvas.height;
  const tempCtx = tempCanvas.getContext('2d');

  // 绘制原始图像
  tempCtx.drawImage(img, 0, 0, editCanvas.width, editCanvas.height);

  // 绘制所有文本图层
  textLayers.forEach(layer => {
    tempCtx.save();
    tempCtx.translate(layer.x, layer.y);
    tempCtx.rotate((layer.rotation * Math.PI) / 180);

    tempCtx.font = `${layer.fontSize}px ${layer.fontFamily}`;
    tempCtx.textAlign = 'center';
    tempCtx.textBaseline = 'middle';

    if (layer.strokeWidth > 0) {
      tempCtx.strokeStyle = layer.strokeColor;
      tempCtx.lineWidth = layer.strokeWidth;
      tempCtx.strokeText(layer.text, 0, 0);
    }

    tempCtx.fillStyle = layer.color;
    tempCtx.fillText(layer.text, 0, 0);

    tempCtx.restore();
  });

  frames[frameIndex] = tempCanvas.toDataURL('image/png');
  frameImages[frameIndex] = null;
}

// 清空文本图层
function clearTextLayers() {
  textLayers = [];
  document.querySelectorAll('.text-layer').forEach(div => div.remove());
  hideToolbar();
}

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
      showNotification('无法打开保存对话框', 'error');
      return;
    }
  }

  if (result.canceled || !result.filePath) return;

  // 显示加载提示
  showLoading('正在导出 GIF...');
  document.getElementById('loading-progress').textContent = '准备导出...';

  try {
    await exportGIF(result.filePath, quality);
    hideLoading();
    showNotification('GIF 导出成功！', 'success');
  } catch (error) {
    console.error('Export error:', error);
    hideLoading();
    showNotification('导出失败: ' + error.message, 'error');
  }
});

async function exportGIF(filePath, quality) {
  return new Promise(async (resolve, reject) => {
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

      // 懒加载所有帧并添加到GIF
      for (let i = 0; i < frames.length; i++) {
        const img = await getFrameImage(i);
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = outputWidth;
        tempCanvas.height = outputHeight;
        const tempCtx = tempCanvas.getContext('2d');

        // 缩放绘制
        tempCtx.drawImage(img, 0, 0, outputWidth, outputHeight);

        gif.addFrame(tempCanvas, { delay: delay, copy: true });
      }

      // 监听编码进度
      gif.on('progress', (progress) => {
        const percent = Math.round(progress * 100);
        requestAnimationFrame(() => {
          document.getElementById('loading-progress').textContent = `编码中 ${percent}%`;
        });
      });

      gif.on('finished', (blob) => {
        document.getElementById('loading-progress').textContent = '写入文件...';

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
  const frameCount = frames.length; // 使用 frames.length 而不是 frameImages.length

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
