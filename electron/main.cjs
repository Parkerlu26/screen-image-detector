const { app, BrowserWindow, session, desktopCapturer, ipcMain, Menu, screen } = require('electron');
const path = require('path');
// Window icon. The inner exe cannot be patched with rcedit on the build host,
// so the taskbar/window icon is set from this file at runtime instead.
const APP_ICON = path.join(__dirname, '..', 'assets', 'icon.ico');
const fs = require('fs');
const { spawn } = require('child_process');
const {
  registerUpdateHandlers,
  cleanupLeftovers,
  confirmBootForSwap,
  takeOverIfPending,
  finishTakeover,
  sleepSync,
} = require('./updater.cjs');

let mainWindow = null;
let floatingWindow = null;

// 允許經 IPC 觸發的滑鼠動作。這份清單必須跟下面那段 C# DoAction 裡認得的字串一致：
// 它是白名單，不是提示。畫面層送來的 action 會被接進 PowerShell 的 stdin，
// 那條管線能執行任意指令，所以「不在這四個裡面」的唯一正確處理是拒絕。
const MOUSE_ACTIONS = ['right_click_and_center', 'right_click', 'left_click_and_center', 'left_click'];

/** 座標一律夾成有限整數。C# 那邊收 int，送 NaN、Infinity 或 1e21 進去只會讓整行指令失效。 */
function safeCoord(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 0;
  // 上限刻意設得比任何真實桌面都大（多螢幕的虛擬桌面座標可以是負的、也可以很大），
  // 這個夾取只為了擋掉「大到會被印成科學記號」的荒謬值，不是為了限制螢幕範圍。
  return Math.max(-1000000, Math.min(1000000, n));
}

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

// 帳號伺服器網址。打包時由 .env 的 VITE_API_BASE 寫進程式裡，但同一層資料夾放了
// api-server.txt 就以檔案內容為準——換伺服器不用重新打包。
//
// 這個檔案決定帳號密碼會被送到哪台主機，所以它的信任邊界要講清楚：
//   1. 只讀 exe 旁邊那一份。原本還會讀 %APPDATA%，但那是低權限程序也寫得進去的
//      地方；exe 旁邊不是——能在那裡放檔案的人本來就能直接換掉 exe，讀它並沒有
//      多給任何人權力。
//   2. 只接受 https。http 等於把密碼用明文交給路徑上的每一台裝置，而且對方可以
//      改寫回應。唯一例外是 localhost：那是自己機器上的開發伺服器，沒有網路可攔。
const API_BASE_FILENAME = 'api-server.txt';

/** https 才收；localhost 例外（本機開發用），其餘一律忽略。 */
function isTrustedApiBase(text) {
  try {
    const url = new URL(text);
    if (url.protocol === 'https:') return true;
    if (url.protocol !== 'http:') return false;
    const host = url.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  } catch {
    return false;
  }
}

function readApiBaseOverride() {
  const candidates = [];
  // 免安裝版執行時會先解壓到暫存資料夾，PORTABLE_EXECUTABLE_DIR 才是 exe 真正的所在位置。
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    candidates.push(path.join(process.env.PORTABLE_EXECUTABLE_DIR, API_BASE_FILENAME));
  }
  try {
    candidates.push(path.join(path.dirname(app.getPath('exe')), API_BASE_FILENAME));
  } catch {}
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      // 允許註解行（# 開頭）與空行，取第一個通得過信任檢查的網址。
      const line = fs
        .readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .map((text) => text.trim())
        .find((text) => /^https?:\/\/.+/i.test(text) && isTrustedApiBase(text));
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
// 名稱→虛擬鍵碼的對應搬到 keymap.cjs，因為它必須跟畫面層的側錄命名逐字一致，
// 而那件事需要一支能單獨跑的測試來守（scratch/keymaptest.mts）。
const { getVkCode } = require('./keymap.cjs');

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
    // 開窗那一瞬間畫面還沒畫出來，這個色就是那一格的底色，跟 tokens.css 的 --bg 一致。
    backgroundColor: '#08090a',
    /**
     * 標題列自己畫（App 裡的 TitleBar 元件），但縮小／放大／關閉三顆仍然交給 Windows：
     * 'hidden' + titleBarOverlay 保留了 Snap Layouts（滑到放大鈕上出現的排版選單）與
     * 系統的按鈕行為，而 frame:false 會把這些一起弄丟，得自己用 IPC 重做一份殘缺的。
     * 這裡先給深色的值；使用者選淺色時由畫面層呼叫 set-title-bar-overlay 換掉。
     */
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#08090a', symbolColor: '#9ca3ad', height: 32 },
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

  // IPC handler for mouse right-click and center automation.
  //
  // 這裡的參數會被接進一段字串，然後寫進一個常駐 PowerShell 的 stdin。那條管線就是
  // 一個「執行任意指令」的入口，所以畫面層送來的東西一個都不能直接相信：
  //   - action 只能是 C# DoAction 真的認得的那四個字串，用白名單比對而不是過濾字元。
  //     過濾是列舉壞東西（永遠列不完），白名單是列舉好東西（一共四個）。
  //   - 座標必須是有限的整數。NaN／字串／Infinity 接進去會變成 PowerShell 的語法錯誤，
  //     雖然不是注入，但會讓那條指令靜默失效，比較難查。
  ipcMain.handle('perform-mouse-action', async (event, { action, screenX, screenY, returnToCenter = true }) => {
    try {
      if (!MOUSE_ACTIONS.includes(action)) {
        return { success: false, error: `unsupported action: ${String(action)}` };
      }
      if (!psProc || psProc.killed) {
        initPowerShellWorker();
      }
      const x = safeCoord(screenX);
      const y = safeCoord(screenY);
      const cmd = `[WinAutomation]::DoAction("${action}", ${x}, ${y}, $${returnToCenter ? 'true' : 'false'});\n`;
      psProc.stdin.write(cmd);
      return { success: true };
    } catch (err) {
      console.error('Mouse action error:', err);
      return { success: false, error: String(err) };
    }
  });

  // Non-blocking Pass-Through Key Registration (Never blocks typing or games!)
  //
  // 對不到虛擬鍵就必須回 false。舊版不管成不成功一律回 true，於是「這顆鍵永遠不會
  // 被監看」這件事沒有任何人知道 —— 畫面上顯示註冊成功，使用者按下去卻毫無反應，
  // 只能從「計時器不會開始」反推。回 false 之後畫面層才有機會告訴使用者換一顆鍵。
  ipcMain.handle('register-global-hotkey', async (event, { hotkey, timerId, ruleId }) => {
    try {
      if (!hotkey) return false;
      const normalizedKey = hotkey.trim().toUpperCase();
      const vk = getVkCode(normalizedKey);
      if (vk === null) {
        console.warn('這個快捷鍵名稱對不到任何按鍵，不會被監看:', normalizedKey);
        return false;
      }
      activeHotkeys.set(normalizedKey, { vk, timerId, ruleId });
      updateWatchedKeysInWorker();
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

  /**
   * 換深淺主題時重畫 Windows 那三顆原生按鈕。
   *
   * 收的是「送出請求的那個視窗」而不是 mainWindow：懸浮視窗載的是同一份畫面程式，
   * 開機套用外觀時也會走到這裡，而它是無邊框的（沒有 setTitleBarOverlay 可呼叫）。
   * 那種情況回 false 就好，不是錯誤。顏色只收 #rrggbb，免得把奇怪的字串餵進原生 API。
   */
  ipcMain.handle('set-title-bar-overlay', async (event, options) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win || win.isDestroyed() || typeof win.setTitleBarOverlay !== 'function') return false;
      const hex = /^#[0-9a-fA-F]{6}$/;
      const color = options && options.color;
      const symbolColor = options && options.symbolColor;
      if (!hex.test(color || '') || !hex.test(symbolColor || '')) return false;
      win.setTitleBarOverlay({ color, symbolColor, height: 32 });
      return true;
    } catch (err) {
      // 無邊框視窗會丟例外（Electron 只允許 titleBarStyle 為 hidden 的視窗改這個）。
      return false;
    }
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

  // 剛換完檔的那一次啟動，換檔腳本正在等一個「我真的活起來了」的訊號，方式是等
  // <exe>.updating 消失。放在這裡而不是 whenReady：畫面載完才表示 Chromium、asar
  // 裡的前端、preload 這一整條都沒問題，那才是使用者要的「程式能用」。
  // 沒在換檔的時候這個呼叫什麼事都不會發生（旗標本來就不存在）。
  mainWindow.webContents.once('did-finish-load', () => {
    confirmBootForSwap();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (floatingWindow && !floatingWindow.isDestroyed()) {
      floatingWindow.close();
    }
  });
}

// 更新來的那一次啟動，第一件事是接手：回報「我真的活起來了」，然後等舊版結束。
//
// 這一行必須在下面那把鎖之前，而且必須是同步的。此刻鎖還在舊版手上：先去搶就一定
// 會輸，而輸掉的那一方的標準反應是 app.quit()——於是接手永遠不會發生，畫面上會是
// 「視窗自己關掉、什麼都沒發生」，正是這次要修掉的症狀。
// 不是更新來的（也就是絕大多數的啟動）時它立刻回傳 null，什麼事都不會做。
const pendingTakeover = takeOverIfPending();

// 免安裝版很容易被連點兩下開成兩份。單一實例鎖在這個程式裡不只是禮貌問題，而是
// 正確性前提：
//   1. 更新流程會在啟動時清掉 <exe>.new / .part / .old。第二個實例一開，就會把
//      第一個正在下載的 90 MB 檔案刪掉。
//   2. 全域熱鍵只有先註冊到的那一份收得到，兩份互搶會讓熱鍵時好時壞。
//   3. 兩份同時驅動 PowerShell 移動滑鼠，等於兩個人搶同一支游標。
//
// 接手那一次要多試幾輪：舊版的 pid 已經消失了，但作業系統把它那個單一實例用的
// 隱藏視窗拆掉不見得就在同一個瞬間。搶不到就退場是對的（那表示真的有另一份在跑），
// 只是別把「差幾百毫秒」也算成那種情況——交接紙條留在原地，下次啟動會再試一次。
function acquireInstanceLock(takingOver) {
  if (app.requestSingleInstanceLock()) return true;
  if (!takingOver) return false;
  for (let i = 0; i < 4; i++) {
    sleepSync(300);
    if (app.requestSingleInstanceLock()) return true;
  }
  return false;
}

const hasInstanceLock = acquireInstanceLock(Boolean(pendingTakeover));
if (!hasInstanceLock) {
  app.quit();
}

// 使用者再點一次圖示的意思是「把它叫出來」，不是「再開一個」。
app.on('second-instance', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  // app.quit() 不是同步的，whenReady 還是可能先跑到。沒拿到鎖的那一份只負責結束：
  // 不要開視窗、不要註冊熱鍵，尤其不要去清任何暫存檔。
  if (!hasInstanceLock) return;

  // 上一輪沒清完的更新暫存檔（下載被中斷的 .part、沒換成功的 .new、換檔留下的
  // .old）。放到這裡是因為有上面那把鎖，才能確定沒有另一份正在寫它們。
  cleanupLeftovers();

  // 接手的下半段：把自己改名頂到使用者平常按的那個檔名上、刪掉舊的執行檔。
  // 刻意不 await：它最多要花 30 秒（防毒掃那個 190 MB 的檔案時鎖會持續好一陣子），
  // 而使用者此刻要的是看到視窗。失敗也不擋任何功能，下一次啟動會再試一次。
  // 沒在接手的時候（pendingTakeover 是 null）它立刻回傳，什麼都不做。
  void finishTakeover(pendingTakeover);

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
