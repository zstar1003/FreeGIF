const { app, BrowserWindow, ipcMain, desktopCapturer, screen, dialog } = require('electron');
const path = require('path');

let mainWindow;
let selectorWindow;
let recorderWindow;

// 尝试启用 remote 模块（如果需要）
try {
  require('@electron/remote/main').initialize();
} catch (e) {
  console.log('Remote module not available');
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 300,
    resizable: false,
    frame: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    }
  });

  mainWindow.loadFile('src/renderer/index.html');

  // 启用 remote 模块
  try {
    require('@electron/remote/main').enable(mainWindow.webContents);
  } catch (e) {
    console.log('Remote module not available');
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createSelectorWindow() {
  const { width, height } = screen.getPrimaryDisplay().bounds;

  selectorWindow = new BrowserWindow({
    width: width,
    height: height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    movable: false,
    fullscreen: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    }
  });

  selectorWindow.loadFile('src/renderer/selector.html');
  selectorWindow.setAlwaysOnTop(true, 'screen-saver');

  // 启用 remote 模块
  try {
    require('@electron/remote/main').enable(selectorWindow.webContents);
  } catch (e) {
    console.log('Remote module not available');
  }

  selectorWindow.on('closed', () => {
    selectorWindow = null;
  });
}

function createRecorderWindow(bounds) {
  recorderWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    }
  });

  recorderWindow.loadFile('src/renderer/recorder.html');

  // 启用 remote 模块
  try {
    require('@electron/remote/main').enable(recorderWindow.webContents);
  } catch (e) {
    console.log('Remote module not available');
  }

  // 等待加载完成后发送录制指令
  recorderWindow.webContents.on('did-finish-load', () => {
    recorderWindow.webContents.send('start-recording', bounds);
  });

  recorderWindow.on('closed', () => {
    recorderWindow = null;
  });
}

app.whenReady().then(createMainWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});

// IPC Handlers
ipcMain.on('start-selection', () => {
  // 如果已经有录制窗口，关闭它
  if (recorderWindow) {
    recorderWindow.close();
  }
  // 隐藏主窗口
  if (mainWindow) {
    mainWindow.hide();
  }
  setTimeout(() => {
    createSelectorWindow();
  }, 200);
});

ipcMain.on('cancel-selection', () => {
  if (selectorWindow) {
    selectorWindow.close();
  }
  if (recorderWindow) {
    recorderWindow.close();
  }
  if (mainWindow) {
    mainWindow.show();
  }
});

ipcMain.on('area-selected', (event, bounds) => {
  // 关闭选择窗口
  if (selectorWindow) {
    selectorWindow.close();
  }
  // 创建录制窗口
  createRecorderWindow(bounds);
});

ipcMain.handle('get-sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 1920, height: 1080 }
  });
  return sources;
});

// 添加 dialog handler 作为备选方案
ipcMain.handle('show-save-dialog', async (event, options) => {
  return await dialog.showSaveDialog(options);
});
