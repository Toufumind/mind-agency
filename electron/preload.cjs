/**
 * Mind Agency — Electron Preload Script
 *
 * Exposes safe APIs to the renderer process via contextBridge.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mind', {
  // App info
  platform: process.platform,
  version: process.env.npm_package_version || '0.1.0',

  // Window controls (used by custom title bar)
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.sendSync('window:isMaximized'),

  // v0.4: Auto-update APIs
  update: {
    check: () => ipcRenderer.invoke('update:check'),
    download: (url, version) => ipcRenderer.invoke('update:download', url, version),
    restart: () => ipcRenderer.invoke('update:restart'),
    getVersion: () => ipcRenderer.invoke('update:version'),
    onAvailable: (callback) => ipcRenderer.on('update-available', (event, data) => callback(data)),
    onProgress: (callback) => ipcRenderer.on('update-progress', (event, data) => callback(data)),
  },

  // IPC channels (for future use)
  send: (channel, data) => {
    const allowed = ['app:action'];
    if (allowed.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },
  on: (channel, callback) => {
    const allowed = ['app:event'];
    if (allowed.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => callback(...args));
    }
  },
});
