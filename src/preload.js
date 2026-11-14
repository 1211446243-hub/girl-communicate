'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('zhijian', {
  personas: () => ipcRenderer.invoke('personas:list'),
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (patch) => ipcRenderer.invoke('settings:save', patch)
  },
  key: {
    status: () => ipcRenderer.invoke('key:status'),
    set: (key) => ipcRenderer.invoke('key:set', key),
    clear: () => ipcRenderer.invoke('key:clear'),
    test: (key) => ipcRenderer.invoke('key:test', key)
  },
  chat: {
    history: (personaId) => ipcRenderer.invoke('chat:history', personaId),
    send: (personaId, text) => ipcRenderer.invoke('chat:send', personaId, text),
    regenerate: (personaId) => ipcRenderer.invoke('chat:regenerate', personaId),
    stop: (personaId) => ipcRenderer.invoke('chat:stop', personaId),
    clear: (personaId, opts) => ipcRenderer.invoke('chat:clear', personaId, opts),
    undoClear: (personaId) => ipcRenderer.invoke('chat:undoClear', personaId),
    restoreBackup: (personaId) => ipcRenderer.invoke('chat:restoreBackup', personaId),
    importJson: (personaId) => ipcRenderer.invoke('chat:import', personaId),
    exportAs: (personaId, format) => ipcRenderer.invoke('chat:export', personaId, format),
    mood: (personaId) => ipcRenderer.invoke('mood:get', personaId),
    moodIcon: (personaId, emotion) => ipcRenderer.invoke('mood:icon', personaId, emotion),
    onEvent: (cb) => {
      const h = (_e, data) => cb(data);
      ipcRenderer.on('chat:event', h);
      return () => ipcRenderer.removeListener('chat:event', h);
    }
  },
  memory: {
    get: (personaId) => ipcRenderer.invoke('memory:get', personaId),
    save: (personaId, items) => ipcRenderer.invoke('memory:save', personaId, items),
    clear: (personaId) => ipcRenderer.invoke('memory:clear', personaId),
    flush: (personaId) => ipcRenderer.invoke('memory:flush', personaId)
  },
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
  openExternal: (url) => ipcRenderer.invoke('open:external', url),
  openPersonaDir: () => ipcRenderer.invoke('open:personaDir'),
  appInfo: () => ipcRenderer.invoke('app:info')
});
