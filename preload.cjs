const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  info: () => ipcRenderer.invoke('app:info'),
  pathForFile: (file) => webUtils.getPathForFile(file),
  files: {
    pick: (kind, opts) => ipcRenderer.invoke('files:pick', kind, opts),
    expand: (paths, opts) => ipcRenderer.invoke('files:expand', paths, opts)
  },
  tags: {
    read: (paths) => ipcRenderer.invoke('tags:read', paths),
    validate: (items) => ipcRenderer.invoke('tags:validate', items),
    toAscii: (texts) => ipcRenderer.invoke('tags:to-ascii', texts)
  },
  save: {
    preflight: (items) => ipcRenderer.invoke('save:preflight', items),
    run: (items) => ipcRenderer.invoke('save:run', items),
    onProgress: (cb) => ipcRenderer.on('save:progress', (_e, p) => cb(p))
  },
  restore: {
    info: () => ipcRenderer.invoke('restore:info'),
    check: () => ipcRenderer.invoke('restore:check'),
    run: () => ipcRenderer.invoke('restore:run')
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    chooseBackupDir: () => ipcRenderer.invoke('settings:choose-backup-dir'),
    openBackupDir: () => ipcRenderer.invoke('settings:open-backup-dir')
  },
  setDirty: (dirty) => ipcRenderer.send('dirty:set', !!dirty),
  update: {
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    reveal: (file) => ipcRenderer.invoke('update:reveal', file),
    onProgress: (cb) => ipcRenderer.on('update:progress', (_e, received, total) => cb(received, total))
  },
  openExternal: (url) => ipcRenderer.invoke('open-external', url)
});
