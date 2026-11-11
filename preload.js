const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  minimize: () => ipcRenderer.send('win:min'),
  maximize: () => ipcRenderer.send('win:max'),
  close: () => ipcRenderer.send('win:close'),
  launch: (settings) => ipcRenderer.invoke('roblox:launch', settings),
  getRobloxStatus: () => ipcRenderer.invoke('roblox:status'),
  repairRoblox: () => ipcRenderer.invoke('roblox:repair'),
  getRobloxCacheStatus: () => ipcRenderer.invoke('roblox:cacheStatus'),
  clearRobloxCache: () => ipcRenderer.invoke('roblox:clearCache'),
  uninstall: () => ipcRenderer.invoke('roblox:uninstall'),
  onRobloxProgress: (callback) => {
    const listener = (_, progress) => callback(progress);
    ipcRenderer.on('roblox:progress', listener);
    return () => ipcRenderer.removeListener('roblox:progress', listener);
  },
  onUpdate: (callback) => {
    const listener = (_, status) => callback(status);
    ipcRenderer.on('app:update-status', listener);
    return () => ipcRenderer.removeListener('app:update-status', listener);
  },
  updateAction: (action, version) => ipcRenderer.invoke('app:update-action', action, version),
  getAppVersion: () => ipcRenderer.invoke('app:version'),
  getSystemStats: () => ipcRenderer.invoke('system:stats'),
  getAppUpdateStatus: () => ipcRenderer.invoke('app:update-status'),
  listBackgroundApps: () => ipcRenderer.invoke('background:list'),
  closeBackgroundApps: (pids) => ipcRenderer.invoke('background:close', pids),
  openFolder: () => ipcRenderer.send('roblox:folder'),
  store: {
    get: () => ipcRenderer.invoke('store:get'),
    set: (k, v) => ipcRenderer.invoke('store:set', k, v),
    replace: (v) => ipcRenderer.invoke('store:replace', v)
  },
  exportSettings: (backup) => ipcRenderer.invoke('settings:export', backup),
  importSettings: () => ipcRenderer.invoke('settings:import'),
  resetSettings: () => ipcRenderer.invoke('settings:reset'),
  applySettings: (s) => ipcRenderer.invoke('settings:apply', s),
  setMode: (m) => ipcRenderer.send('win:mode', m) // 'launcher' | 'full'
});
