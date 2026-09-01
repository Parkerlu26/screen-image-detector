const { app, BrowserWindow, session, desktopCapturer, ipcMain, Menu, screen } = require('electron');
const path = require('path');
// Window icon. The inner exe cannot be patched with rcedit on the build host,
// so the taskbar/window icon is set from this file at runtime instead.
const APP_ICON = path.join(__dirname, '..', 'assets', 'icon.ico');
const fs = require('fs');
const { spawn } = require('child_process');
const { registerUpdateHandlers } = require('./updater.cjs');

let mainWindow = null;
let floatingWindow = null;

// File path to store persistent floating window position
const posConfigPath = path.join(app.getPath('userData'), 'floating_window_pos.json');

function loadFloatingPosition() {
  try {
    if (fs.existsSync(posConfigPath)) {
      return JSON.parse(fs.readFileSync(posConfigPath, 'utf8'));
    }
  } catch {}
  return null;
}

function saveFloatingPosition(pos) {
  try {
    fs.writeFileSync(posConfigPath, JSON.stringify(pos), 'utf8');
  } catch {}
}

// 帳號伺服器網址。打包時可以由 .env 的 VITE_API_BASE 寫進程式裡，但若同一層資料夾
// （或使用者資料夾）放了 api-server.txt，就以檔案內容為準——換伺服器不用重新打包。
const API_BASE_FILENAME = 'api-server.txt';

function readApiBaseOverride() {
  const candidates = [];
  // 免安裝版執行時會先解壓到暫存資料夾，PORTABLE_EXECUTABLE_DIR 才是 exe 真正的所在位置。
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    candidates.push(path.join(process.env.PORTABLE_EXECUTABLE_DIR, API_BASE_FILENAME));
  }
  try {
    candidates.push(path.join(path.dirname(app.getPath('exe')), API_BASE_FILENAME));
  } catch {}
  try {
    candidates.push(path.join(app.getPath('userData'), API_BASE_FILENAME));
  } catch {}
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      // 允許檔案裡有註解行（# 開頭）與空行，取第一個像網址的字串。
      const line = fs
        .readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .map((text) => text.trim())
        .find((text) => /^https?:\/\/.+/i.test(text));
      if (line) return line.replace(/\/+$/, '');
    } catch {}
  }
  return '';
}

/** 傳給畫面用的載入參數；有覆寫時以 ?api= 帶進 renderer。 */
function rendererQuery() {
  const override = readApiBaseOverride();
  return override ? { api: override } : undefined;
}

// Persistent PowerShell worker
let psProc = null;
let activeHotkeys = new Map(); // hotkeyName -> { vk, timerId }
// Pending GetWindowRect requests: tag -> { resolve, timer }. The rect has to be
// read inside the same DPI-aware PowerShell process that moves the cursor, or the
// two would disagree about what a pixel is on a scaled display.
let pendingRects = new Map();
let rectSeq = 0;

// Virtual Key Code Map
const VK_MAP = {
  'F1': 0x70, 'F2': 0x71, 'F3': 0x72, 'F4': 0x73, 'F5': 0x74, 'F6': 0x75,
  'F7': 0x76, 'F8': 0x77, 'F9': 0x78, 'F10': 0x79, 'F11': 0x7A, 'F12': 0x7B,
  '0': 0x30, '1': 0x31, '2': 0x32, '3': 0x33, '4': 0x34,
  '5': 0x35, '6': 0x36, '7': 0x37, '8': 0x38, '9': 0x39,
  'A': 0x41, 'B': 0x42, 'C': 0x43, 'D': 0x44, 'E': 0x45, 'F': 0x46,
  'G': 0x47, 'H': 0x48, 'I': 0x49, 'J': 0x4A, 'K': 0x4B, 'L': 0x4C,
  'M': 0x4D, 'N': 0x4E, 'O': 0x4F, 'P': 0x50, 'Q': 0x51, 'R': 0x52,
  'S': 0x53, 'T': 0x54, 'U': 0x55, 'V': 0x56, 'W': 0x57, 'X': 0x58,
  'Y': 0x59, 'Z': 0x5A, 'SPACE': 0x20, 'TAB': 0x09, 'SHIFT': 0x10, 'CONTROL': 0x11, 'ALT': 0x12
};

function getVkCode(key) {
  const upper = key.trim().toUpperCase();
  if (VK_MAP[upper]) return VK_MAP[upper];
  if (upper.length === 1) return upper.charCodeAt(0);
  return null;
}

function initPowerShellWorker() {
  try {
    psProc = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', '-'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const initScript = `
Add-Type -TypeDefinition @"
using System;
using System.Threading;
using System.Runtime.InteropServices;

public class WinAutomation {
  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, int dwExtraInfo);
  [DllImport("user32.dll")]
  public static extern int GetSystemMetrics(int nIndex);
  [DllImport("user32.dll")]
  public static extern short GetAsyncKeyState(int vKey);
  [DllImport("user32.dll")]
  public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")]
  public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("dwmapi.dll")]
  public static extern int DwmGetWindowAttribute(IntPtr hWnd, int attr, out RECT r, int size);

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

  /**
   * Report a window's rectangle in physical desktop pixels.
   *
   * Printed rather than returned because this process is a long-lived pipe: the
   * tag lets the Node side match the answer to its request.
   *
   * DWMWA_EXTENDED_FRAME_BOUNDS (9) is preferred over GetWindowRect: since
   * Windows 10 GetWindowRect includes an invisible resize border of several
   * pixels that the screen capture does not, so using it shifts every click.
   */
  public static void PrintWindowRect(string tag, long hwnd) {
    IntPtr h = new IntPtr(hwnd);
    RECT r;
    bool ok = false;
    if (h != IntPtr.Zero && IsWindow(h)) {
      RECT d;
      if (DwmGetWindowAttribute(h, 9, out d, 16) == 0 && d.Right > d.Left && d.Bottom > d.Top) {
        r = d;
        ok = true;
      } else {
        ok = GetWindowRect(h, out r);
      }
    } else {
      r = new RECT();
    }
    if (!ok) {
      Console.WriteLine("RECT:" + tag + ":none");
      return;
    }
    Console.WriteLine("RECT:" + tag + ":" + r.Left + "," + r.Top + "," + (r.Right - r.Left) + "," + (r.Bottom - r.Top));
  }

  public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  public const uint MOUSEEVENTF_LEFTUP = 0x0004;
  public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
  public const uint MOUSEEVENTF_RIGHTUP = 0x0010;

  public static void DoAction(string actionType, int x, int y, bool returnToCenter) {
    new Thread(() => {
      try {
        SetCursorPos(x, y);
        Thread.Sleep(25);
        if (actionType == "right_click_and_center" || actionType == "right_click") {
          mouse_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, 0);
          Thread.Sleep(35);
          mouse_event(MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0);
        } else if (actionType == "left_click_and_center" || actionType == "left_click") {
          mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
          Thread.Sleep(35);
          mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
        }
        if (returnToCenter) {
          Thread.Sleep(25);
          int sw = GetSystemMetrics(0);
          int sh = GetSystemMetrics(1);
          SetCursorPos(sw / 2, sh / 2);
        }
      } catch {}
    }).Start();
  }

  private static volatile bool _running = true;
  private static volatile int[] _watchedKeys = new int[0];
  private static bool[] _keyStates = new bool[256];
  private static Thread _thread;

  public static void SetWatchedKeys(int[] vks) {
    _watchedKeys = vks;
  }

  public static void Stop() {
    _running = false;
  }

  public static void StartWatcherThread() {
    _running = true;
    _thread = new Thread(RunLoop);
    _thread.IsBackground = true;
    _thread.Start();
  }

  private static void RunLoop() {
    while (_running) {
      int[] keys = _watchedKeys;
      for (int i = 0; i < keys.Length; i++) {
        int vk = keys[i];
        if (vk <= 0 || vk >= 256) continue;
        bool isDown = (GetAsyncKeyState(vk) & 0x8000) != 0;
        if (isDown && !_keyStates[vk]) {
          _keyStates[vk] = true;
          Console.WriteLine("KEY_DOWN:" + vk);
        } else if (!isDown && _keyStates[vk]) {
          _keyStates[vk] = false;
        }
      }
      Thread.Sleep(10);
    }
  }
}
"@

# DPI awareness must be set before any coordinate is read or written, so that
# GetWindowRect, SetCursorPos and GetSystemMetrics all speak physical pixels.
[WinAutomation]::SetProcessDPIAware() | Out-Null
[WinAutomation]::StartWatcherThread();
`;
    psProc.stdin.write(initScript + '\n');

    let buffer = '';
    psProc.stdout.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('RECT:')) {
          const rest = trimmed.slice(5);
          const sep = rest.indexOf(':');
          const tag = rest.slice(0, sep);
          const body = rest.slice(sep + 1);
          const pending = pendingRects.get(tag);
          if (pending) {
            pendingRects.delete(tag);
            clearTimeout(pending.timer);
            if (body === 'none') {
              pending.resolve(null);
            } else {
              const [x, y, w, h] = body.split(',').map((v) => parseInt(v, 10));
              pending.resolve(
                [x, y, w, h].some(isNaN) || w <= 0 || h <= 0 ? null : { x, y, width: w, height: h }
              );
            }
          }
          continue;
        }
        if (trimmed.startsWith('KEY_DOWN:')) {
          const code = parseInt(trimmed.replace('KEY_DOWN:', ''), 10);
          if (!isNaN(code)) {
            for (const [hotkey, val] of activeHotkeys.entries()) {
              if (val.vk === code) {
                // Send to both mainWindow (audio/logic) and floatingWindow (HUD animation)
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send('global-hotkey-triggered', {
                    hotkey,
                    timerId: val.timerId,
                    ruleId: val.ruleId,
                  });
                }
                if (floatingWindow && !floatingWindow.isDestroyed()) {
                  floatingWindow.webContents.send('global-hotkey-triggered', {
                    hotkey,
                    timerId: val.timerId,
                    ruleId: val.ruleId,
                  });
                }
              }
            }
          }
        }
      }
    });
  } catch (err) {
    console.error('Failed to start worker:', err);
  }
}

function updateWatchedKeysInWorker() {
  if (!psProc || psProc.killed) return;
  const vks = Array.from(activeHotkeys.values()).map((v) => v.vk).filter(Boolean);
  const cmd = `[WinAutomation]::SetWatchedKeys(@(${vks.join(',')}))\n`;
  try {
    psProc.stdin.write(cmd);
  } catch {}
}

function createFloatingWindow() {
  if (floatingWindow && !floatingWindow.isDestroyed()) {
    floatingWindow.show();
    floatingWindow.focus();
    return;
  }

  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
  const savedPos = loadFloatingPosition();

  let initX = screenW - 250;
  let initY = 100;

  if (savedPos && typeof savedPos.x === 'number' && typeof savedPos.y === 'number') {
    initX = savedPos.x;
    initY = savedPos.y;
  }

  floatingWindow = new BrowserWindow({
    icon: APP_ICON,
    width: 220,
    height: 135,
    x: initX,
    y: initY,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      sandbox: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');

  if (isDev) {
    floatingWindow.loadURL('http://localhost:3000/#floating');
  } else {
    floatingWindow.loadFile(path.join(__dirname, '../dist/index.html'), {
      hash: 'floating',
      query: rendererQuery(),
    });
  }

  floatingWindow.setAlwaysOnTop(true, 'screen-saver');

  // Automatically remember floating window position on move
  floatingWindow.on('moved', () => {
    if (floatingWindow && !floatingWindow.isDestroyed()) {
      const [x, y] = floatingWindow.getPosition();
      saveFloatingPosition({ x, y });
    }
  });

  floatingWindow.on('close', () => {
    if (floatingWindow && !floatingWindow.isDestroyed()) {
      const [x, y] = floatingWindow.getPosition();
      saveFloatingPosition({ x, y });
    }
  });

  floatingWindow.on('closed', () => {
    floatingWindow = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('floating-window-closed');
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    icon: APP_ICON,
    width: 1400,
    height: 920,
    minWidth: 1024,
    minHeight: 680,
    title: '六月幫你顧',
    backgroundColor: '#020617',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      sandbox: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  Menu.setApplicationMenu(null);

  // IPC handler to list available screens/windows
  ipcMain.handle('get-desktop-sources', async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['window', 'screen'],
        thumbnailSize: { width: 480, height: 270 },
        fetchWindowIcons: true,
      });

      return sources.map((s) => ({
        id: s.id,
        name: s.name,
        thumbnail: s.thumbnail.toDataURL(),
        appIcon: s.appIcon ? s.appIcon.toDataURL() : null,
        isScreen: s.id.startsWith('screen:'),
      }));
    } catch (err) {
      console.error('Error fetching desktop sources:', err);
      return [];
    }
  });

  /**
   * Where the captured source actually lives on the desktop, in physical pixels.
   *
   * The detection worker reports matches in capture-frame coordinates, which are
   * only the same thing as desktop coordinates by accident (one unscaled monitor
   * at 100% DPI). Auto-click needs this to map one to the other, so a window that
   * is moved, resized, or on a second monitor still gets clicked in the right
   * place. Returns null when the geometry is unknown, and the renderer then falls
   * back to the raw coordinates rather than clicking somewhere random.
   */
  ipcMain.handle('get-capture-geometry', async (event, { sourceId, frameWidth, frameHeight }) => {
    try {
      if (typeof sourceId !== 'string' || !sourceId) return null;

      // "screen:<display_id>:0" — Electron already knows the display layout.
      if (sourceId.startsWith('screen:')) {
        const displayId = sourceId.split(':')[1];
        const displays = screen.getAllDisplays();
        const physical = (d) => {
          const f = d.scaleFactor || 1;
          return {
            x: Math.round(d.bounds.x * f),
            y: Math.round(d.bounds.y * f),
            width: Math.round(d.bounds.width * f),
            height: Math.round(d.bounds.height * f),
          };
        };
        // The id in the source string does not reliably equal Display.id on
        // Windows, and falling back to the primary display silently clicks the
        // wrong monitor. Match on the captured frame size next, which is exact
        // for a full-screen capture, and only then give up to the primary.
        let match = displays.find((d) => String(d.id) === displayId);
        if (!match && frameWidth > 0 && frameHeight > 0) {
          const sized = displays.filter((d) => {
            const p = physical(d);
            return p.width === Math.round(frameWidth) && p.height === Math.round(frameHeight);
          });
          if (sized.length === 1) match = sized[0];
        }
        if (!match && displays.length === 1) match = displays[0];
        if (!match) match = screen.getPrimaryDisplay();
        if (!match) return null;
        // bounds are DIP; the PowerShell worker is DPI-aware, so scale up.
        return physical(match);
      }

      // "window:<hwnd>:0" — ask the click worker itself, so both agree on DPI.
      if (sourceId.startsWith('window:')) {
        const hwnd = sourceId.split(':')[1];
        if (!/^\d+$/.test(hwnd)) return null;
        if (!psProc || psProc.killed) initPowerShellWorker();
        if (!psProc || psProc.killed) return null;
        const tag = `g${++rectSeq}`;
        return await new Promise((resolve) => {
          // The first request can queue behind PowerShell's Add-Type compile,
          // which takes seconds on a cold start; 600ms timed out every time and
          // the click silently fell back to raw frame coordinates.
          const timer = setTimeout(() => {
            pendingRects.delete(tag);
            resolve(null);
          }, 4000);
          pendingRects.set(tag, { resolve, timer });
          try {
            psProc.stdin.write(`[WinAutomation]::PrintWindowRect("${tag}", ${hwnd});\n`);
          } catch {
            pendingRects.delete(tag);
            clearTimeout(timer);
            resolve(null);
          }
        });
      }

      return null;
    } catch (err) {
      console.error('get-capture-geometry error:', err);
      return null;
    }
  });

  // IPC handler for mouse right-click and center automation
  ipcMain.handle('perform-mouse-action', async (event, { action, screenX, screenY, returnToCenter = true }) => {
    try {
      if (!psProc || psProc.killed) {
        initPowerShellWorker();
      }
      const x = Math.round(screenX || 0);
      const y = Math.round(screenY || 0);
      const cmd = `[WinAutomation]::DoAction("${action}", ${x}, ${y}, $${returnToCenter ? 'true' : 'false'});\n`;
      psProc.stdin.write(cmd);
      return { success: true };
    } catch (err) {
      console.error('Mouse action error:', err);
      return { success: false, error: String(err) };
    }
  });

  // Non-blocking Pass-Through Key Registration (Never blocks typing or games!)
  ipcMain.handle('register-global-hotkey', async (event, { hotkey, timerId, ruleId }) => {
    try {
      if (!hotkey) return false;
      const normalizedKey = hotkey.trim().toUpperCase();
      const vk = getVkCode(normalizedKey);
      if (vk) {
        activeHotkeys.set(normalizedKey, { vk, timerId, ruleId });
        updateWatchedKeysInWorker();
      }
      return true;
    } catch (err) {
      console.warn('Failed to register non-blocking key:', hotkey, err);
      return false;
    }
  });

  ipcMain.handle('unregister-all-hotkeys', async () => {
    activeHotkeys.clear();
    updateWatchedKeysInWorker();
    return true;
  });

  // IPC handlers for Floating Window
  ipcMain.handle('open-floating-window', async () => {
    createFloatingWindow();
    return true;
  });

  ipcMain.handle('close-floating-window', async () => {
    if (floatingWindow && !floatingWindow.isDestroyed()) {
      floatingWindow.close();
      floatingWindow = null;
    }
    return true;
  });

  ipcMain.handle('resize-floating-window', async (event, { width, height }) => {
    if (floatingWindow && !floatingWindow.isDestroyed()) {
      const w = Math.max(100, Math.round(width));
      const h = Math.max(80, Math.round(height));
      floatingWindow.setSize(w, h);
    }
    return true;
  });

  // Sync timers across windows
  ipcMain.on('sync-timers-data', (event, data) => {
    if (mainWindow && !mainWindow.isDestroyed() && event.sender !== mainWindow.webContents) {
      mainWindow.webContents.send('timers-data-synced', data);
    }
    if (floatingWindow && !floatingWindow.isDestroyed() && event.sender !== floatingWindow.webContents) {
      floatingWindow.webContents.send('timers-data-synced', data);
    }
  });

  const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'), { query: rendererQuery() });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (floatingWindow && !floatingWindow.isDestroyed()) {
      floatingWindow.close();
    }
  });
}

app.whenReady().then(() => {
  initPowerShellWorker();
  registerUpdateHandlers(ipcMain);

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(true);
  });
  session.defaultSession.setPermissionCheckHandler(() => true);

  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
      if (sources.length > 0) {
        callback({ video: sources[0] });
      } else {
        callback({});
      }
    } catch (err) {
      console.error('Display media request error:', err);
      callback({});
    }
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('will-quit', () => {
  if (psProc && !psProc.killed) {
    try {
      psProc.stdin.write('[WinAutomation]::Stop();\n');
      psProc.kill();
    } catch {}
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
