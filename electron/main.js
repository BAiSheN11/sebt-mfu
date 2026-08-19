// Electron 主进程 — SEBT 2D Top-Down Tester 桌面版
import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = !app.isPackaged;

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: 'SEBT 2D Top-Down Tester',
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // 允许本地文件系统访问（上传视频用）
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  if (isDev) {
    // 开发模式: 连接 vite dev server
    mainWindow.loadURL('http://localhost:8001');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    // 生产模式: 加载打包好的 dist/index.html
    const indexPath = path.join(__dirname, '..', 'dist', 'index.html');
    mainWindow.loadFile(indexPath);
  }

  // 外链在浏览器中打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// IPC: 选择视频文件（系统原生文件对话框）
ipcMain.handle('select-video-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择 SEBT 视频文件',
    properties: ['openFile'],
    filters: [
      { name: 'Video Files', extensions: ['mp4', 'webm', 'mov', 'm4v', 'avi'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }

  const filePath = result.filePaths[0];
  try {
    const stats = fs.statSync(filePath);
    return {
      canceled: false,
      filePath,
      fileName: path.basename(filePath),
      fileSize: stats.size,
    };
  } catch {
    return { canceled: false, filePath, fileName: path.basename(filePath), fileSize: 0 };
  }
});

// IPC: 获取应用信息（是否为桌面端、版本等）
ipcMain.handle('get-app-info', () => {
  return {
    isDesktop: true,
    version: app.getVersion(),
    platform: process.platform,
  };
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
