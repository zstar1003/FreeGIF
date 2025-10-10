const { ipcRenderer } = require('electron');

let isSelecting = false;
let startX, startY, endX, endY;
let scaleFactor = 1;

const selection = document.getElementById('selection');
const info = document.getElementById('info');
const hint = document.getElementById('hint');

// 尝试获取屏幕缩放因子
(async () => {
  try {
    // 尝试使用 @electron/remote
    const { screen } = require('@electron/remote') || require('electron').remote;
    scaleFactor = screen.getPrimaryDisplay().scaleFactor;
    console.log('Scale factor:', scaleFactor);
  } catch (e) {
    // 如果失败，使用 window.devicePixelRatio 作为备选
    scaleFactor = window.devicePixelRatio || 1;
    console.log('Using devicePixelRatio as scale factor:', scaleFactor);
  }
})();

document.addEventListener('mousedown', (e) => {
  hint.style.display = 'none';
  isSelecting = true;
  startX = e.clientX;
  startY = e.clientY;
  selection.style.display = 'block';
  updateSelection(e.clientX, e.clientY);
});

document.addEventListener('mousemove', (e) => {
  if (isSelecting) {
    updateSelection(e.clientX, e.clientY);
  }
});

document.addEventListener('mouseup', (e) => {
  if (isSelecting) {
    isSelecting = false;
    endX = e.clientX;
    endY = e.clientY;

    // 计算实际屏幕坐标（考虑 DPI 缩放）
    const bounds = {
      x: Math.round(Math.min(startX, endX) * scaleFactor),
      y: Math.round(Math.min(startY, endY) * scaleFactor),
      width: Math.round(Math.abs(endX - startX) * scaleFactor),
      height: Math.round(Math.abs(endY - startY) * scaleFactor),
      scaleFactor: scaleFactor,
      displayWidth: window.screen.width * scaleFactor,
      displayHeight: window.screen.height * scaleFactor
    };

    if (bounds.width > 10 && bounds.height > 10) {
      ipcRenderer.send('area-selected', bounds);
    } else {
      ipcRenderer.send('cancel-selection');
    }
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    ipcRenderer.send('cancel-selection');
  }
});

function updateSelection(x, y) {
  endX = x;
  endY = y;

  const left = Math.min(startX, endX);
  const top = Math.min(startY, endY);
  const width = Math.abs(endX - startX);
  const height = Math.abs(endY - startY);

  selection.style.left = left + 'px';
  selection.style.top = top + 'px';
  selection.style.width = width + 'px';
  selection.style.height = height + 'px';

  info.style.left = (endX + 10) + 'px';
  info.style.top = (endY + 10) + 'px';
  info.textContent = `${width} × ${height}`;
  info.style.display = 'block';
}
