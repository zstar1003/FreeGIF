const { ipcRenderer } = require('electron');

document.getElementById('recordBtn').addEventListener('click', () => {
  ipcRenderer.send('start-selection');
});
