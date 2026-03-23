import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  startAutomation: (config) => ipcRenderer.invoke('start-automation', config),
  startStoryAutomation: (config) => ipcRenderer.invoke('start-story-automation', config),
  stopAutomation: () => ipcRenderer.invoke('stop-automation'),
  onLog: (callback) => {
    const listener = (event, msg) => callback(msg);
    ipcRenderer.on('py-log', listener);
    return () => ipcRenderer.removeListener('py-log', listener);
  },
  onProgress: (callback) => {
    const listener = (event, stats) => callback(stats);
    ipcRenderer.on('py-progress', listener);
    return () => ipcRenderer.removeListener('py-progress', listener);
  },
  onDone: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('py-done', listener);
    return () => ipcRenderer.removeListener('py-done', listener);
  },
  onError: (callback) => {
    const listener = (event, err) => callback(err);
    ipcRenderer.on('py-error', listener);
    return () => ipcRenderer.removeListener('py-error', listener);
  },
  onStoryUpdate: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('py-story-update', listener);
    return () => ipcRenderer.removeListener('py-story-update', listener);
  },
  browseFile: () => ipcRenderer.invoke('open-file-dialog'),
  browseDir: () => ipcRenderer.invoke('open-dir-dialog'),
  openOutputDir: (path) => ipcRenderer.invoke('open-output-dir', path),
  getVersion: () => ipcRenderer.invoke('get-version'),
  onUpdateAvailable: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('update-available', listener)
    return () => ipcRenderer.removeListener('update-available', listener)
  },
  onUpdateReady: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('update-ready', listener)
    return () => ipcRenderer.removeListener('update-ready', listener)
  },
  installDeps: (pythonDir) => ipcRenderer.invoke('install-deps', pythonDir),
})
