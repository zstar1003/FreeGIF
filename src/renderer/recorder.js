const { ipcRenderer, desktopCapturer } = require('electron');
const fs = require('fs');
const path = require('path');
const GIF = require('gif.js');

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

// 获取元素
const recorderMode = document.getElementById('recorder-mode');
const editorMode = document.getElementById('editor-mode');
const previewCanvas = document.getElementById('preview-canvas');
const editCanvas = document.getElementById('edit-canvas');
const previewCtx = previewCanvas.getContext('2d');
const editCtx = editCanvas.getContext('2d');

// ========== 录制模式 ==========

ipcRenderer.on('start-recording', async (event, bounds) => {
  recordingBounds = bounds;
  await startRecording(bounds);
});

async function startRecording(bounds) {
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
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        const scaleX = video.videoWidth / window.screen.width;
        const scaleY = video.videoHeight / window.screen.height;

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

function handleDataAvailable(event) {
  if (event.data.size > 0) {
    recordedChunks.push(event.data);
  }
}

async function handleStop() {
  const blob = new Blob(recordedChunks, { type: 'video/webm' });

  // 停止所有轨道
  stream.getTracks().forEach(track => track.stop());

  // 将视频转换为帧
  const gifData = await convertToGIF(blob, recordingBounds);

  // 切换到编辑模式
  switchToEditorMode(gifData);
}

async function convertToGIF(videoBlob, bounds) {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.src = URL.createObjectURL(videoBlob);
    video.muted = true;

    video.onloadedmetadata = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      canvas.width = bounds.width;
      canvas.height = bounds.height;

      const frameList = [];
      const fps = 10;
      const duration = video.duration;
      const totalFrames = Math.min(Math.floor(duration * fps), 100);

      let currentFrameNum = 0;

      video.onseeked = () => {
        const scaleX = video.videoWidth / window.screen.width;
        const scaleY = video.videoHeight / window.screen.height;

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
        if (currentFrameNum < totalFrames) {
          video.currentTime = (currentFrameNum / fps);
        } else {
          const gifData = {
            frames: frameList,
            width: bounds.width,
            height: bounds.height,
            delay: 100
          };
          URL.revokeObjectURL(video.src);
          resolve(gifData);
        }
      };

      video.currentTime = 0;
    };

    video.onerror = (e) => {
      console.error('Video loading error:', e);
      resolve({
        frames: [],
        width: bounds.width,
        height: bounds.height,
        delay: 100
      });
    };
  });
}

// ========== 编辑模式 ==========

function switchToEditorMode(gifData) {
  recorderMode.classList.add('hidden');
  editorMode.classList.add('active');

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

document.getElementById('prev-frame-btn').addEventListener('click', () => {
  stopPlayback();
  showFrame(currentFrame - 1 >= 0 ? currentFrame - 1 : frameImages.length - 1);
});

document.getElementById('next-frame-btn').addEventListener('click', () => {
  stopPlayback();
  showFrame((currentFrame + 1) % frameImages.length);
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

// 重新录制
document.getElementById('re-record-btn').addEventListener('click', () => {
  stopPlayback();
  ipcRenderer.send('start-selection');
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
      const gif = new GIF({
        workers: 2,
        quality: Math.floor((100 - quality) / 10) + 1,
        width: editCanvas.width,
        height: editCanvas.height,
        workerScript: path.join(__dirname, '../../node_modules/gif.js/dist/gif.worker.js')
      });

      frameImages.forEach((img) => {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = editCanvas.width;
        tempCanvas.height = editCanvas.height;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(img, 0, 0, editCanvas.width, editCanvas.height);

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
  const pixelCount = editCanvas.width * editCanvas.height;
  const frameCount = frameImages.length;

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
