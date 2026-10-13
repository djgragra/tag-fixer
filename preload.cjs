const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  info: invoke('app:info'),
  supportInfo: invoke('app:support-info'),
  pathForFile: (file) => webUtils.getPathForFile(file),
  files: { pick: invoke('files:pick'), expand: invoke('files:expand') },
  tags: { read: invoke('tags:read'), validate: invoke('tags:validate'), toAscii: invoke('tags:to-ascii') },
  cover: { pick: invoke('cover:pick'), preview: invoke('cover:preview') },
  tools: {
    pattern: invoke('tools:pattern'),
    text: invoke('tools:text'),
    datetime: invoke('tools:datetime'),
    checks: invoke('tools:checks'),
    renameCheck: invoke('rename:check'),
    csvExport: invoke('csv:export'),
    csvImport: invoke('csv:import')
  },
  save: {
    preflight: invoke('save:preflight'),
    run: invoke('save:run'),
    onProgress: (cb) => ipcRenderer.on('save:progress', (_e, p) => cb(p))
  },
  restore: { info: invoke('restore:info'), check: invoke('restore:check'), run: invoke('restore:run') },
  settings: {
    get: invoke('settings:get'),
    update: invoke('settings:update'),
    chooseBackupDir: invoke('settings:choose-backup-dir'),
    openBackupDir: invoke('settings:open-backup-dir')
  },
  backup: { export: invoke('backup:export'), import: invoke('backup:import'), apply: invoke('backup:apply') },
  logs: { openFolder: invoke('logs:open-folder') },
  setDirty: (dirty) => ipcRenderer.send('dirty:set', !!dirty),
  update: {
    check: invoke('update:check'),
    state: invoke('update:state'),
    download: invoke('update:download'),
    cancel: invoke('update:cancel'),
    remind: invoke('update:remind'),
    skip: invoke('update:skip'),
    install: invoke('update:install'),
    reveal: invoke('update:reveal'),
    onProgress: (cb) => ipcRenderer.on('update:progress', (_e, received, total) => cb(received, total)),
    onView: (cb) => ipcRenderer.on('update:view', (_e, view) => cb(view))
  },
  whatsNew: { get: invoke('whatsnew:get'), seen: invoke('whatsnew:seen') },
  openExternal: invoke('open-external')
});
