const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),
  // Rect of the captured screen/window in physical desktop pixels, so detection
  // results (which are in capture-frame pixels) can be mapped before clicking.
  getCaptureGeometry: (sourceId, frameWidth, frameHeight) =>
    ipcRenderer.invoke('get-capture-geometry', { sourceId, frameWidth, frameHeight }),
  performMouseAction: (params) => ipcRenderer.invoke('perform-mouse-action', params),
  registerGlobalHotkey: (params) => ipcRenderer.invoke('register-global-hotkey', params),
  unregisterAllHotkeys: () => ipcRenderer.invoke('unregister-all-hotkeys'),
  openFloatingWindow: () => ipcRenderer.invoke('open-floating-window'),
  closeFloatingWindow: () => ipcRenderer.invoke('close-floating-window'),
  resizeFloatingWindow: (params) => ipcRenderer.invoke('resize-floating-window', params),
  syncTimersData: (data) => ipcRenderer.send('sync-timers-data', data),
  onTimersDataSynced: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('timers-data-synced', listener);
    return () => ipcRenderer.removeListener('timers-data-synced', listener);
  },
  onGlobalHotkeyTriggered: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('global-hotkey-triggered', listener);
    return () => ipcRenderer.removeListener('global-hotkey-triggered', listener);
  },
  onFloatingWindowClosed: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('floating-window-closed', listener);
    return () => ipcRenderer.removeListener('floating-window-closed', listener);
  },
  isElectron: true,
});
