// Electron preload 脚本 — 暴露安全的 IPC 接口给渲染进程
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('desktopAPI', {
  selectVideoFile: () => ipcRenderer.invoke('select-video-file'),
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
});
