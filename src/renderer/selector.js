const { ipcRenderer } = require('electron');

let isSelecting = false;
let startX, startY, endX, endY;

const selection = document.getElementById('selection');
const info = document.getElementById('info');
const hint = document.getElementById('hint');

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

    const bounds = {
      x: Math.min(startX, endX),
      y: Math.min(startY, endY),
      width: Math.abs(endX - startX),
      height: Math.abs(endY - startY)
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
