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
  // 檢查更新 / 一鍵更新。downloadUpdate 成功後程式會自己關掉再開新版；
  // 換不成的時候會回 { ok: true, restarting: false }，那表示檔案已經換好了，
  // 只是得由使用者自己重開。
  // 刻意不收參數：下載網址、版號、大小、雜湊值全部由主程序自己向 GitHub 問。
  // 下載回來的檔案會被執行，畫面層不該有任何機會影響它是從哪裡來的。
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  checkForUpdate: () => ipcRenderer.invoke('check-for-update'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  cancelUpdateDownload: () => ipcRenderer.invoke('cancel-update-download'),
  openReleasePage: (url) => ipcRenderer.invoke('open-release-page', url),
  // 更新紀錄檔（換檔的後半段發生在程式關掉之後，只留在這個檔案裡）。
  openUpdateLog: () => ipcRenderer.invoke('open-update-log'),
  onUpdateDownloadProgress: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('update-download-progress', listener);
    return () => ipcRenderer.removeListener('update-download-progress', listener);
  },
  isElectron: true,
});
