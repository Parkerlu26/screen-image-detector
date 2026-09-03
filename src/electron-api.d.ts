/**
 * `window.electronAPI` 的型別。
 *
 * 這份檔案是畫面層與主程序之間那道橋的唯一描述：成員要跟 `electron/preload.cjs`
 * 逐項對應，參數與回傳值要跟 `electron/main.cjs`、`electron/updater.cjs` 裡對應的
 * `ipcMain` handler 一致。改了那邊就要改這裡，否則型別會變成一份看起來很像真的謊言。
 *
 * 成員一律不是選擇性的，只有 `window.electronAPI` 本身是：preload 是一次把整包交
 * 出去的，所以「有 electronAPI 卻少一個方法」在執行期不會發生；真正會發生的是整包
 * 都不在——用瀏覽器開 `npm run dev` 的時候。呼叫點原本就寫成 `?.`，那些寫法在這份
 * 宣告下照樣成立，而 `if (window.electronAPI?.x)` 也還是能一次收斂到兩者都存在。
 */
import type { CooldownTimer, Rect } from './types';

/** 一個可以擷取的畫面來源，由 `get-desktop-sources` 產生。 */
export interface DesktopSource {
  /** Electron 的來源 id，形如 `screen:0:0` 或 `window:<hwnd>:0`。 */
  id: string;
  name: string;
  /** 縮圖，PNG 的 data URL。 */
  thumbnail: string;
  /** 視窗的程式圖示；螢幕來源沒有圖示時是 null。 */
  appIcon?: string | null;
  isScreen?: boolean;
}

/**
 * 滑鼠動作。這四個字串就是 `main.cjs` 的 `MOUSE_ACTIONS` 白名單——主程序會在執行期
 * 再比對一次，因為這串字最後會被接進一段寫進常駐 PowerShell 的指令。這裡用聯集型別
 * 把同一份白名單搬到編譯期，`sound_only` 這種「只提醒不點擊」就不會走到這條路上。
 */
export type MouseAction =
  | 'right_click_and_center'
  | 'right_click'
  | 'left_click_and_center'
  | 'left_click';

export interface MouseActionParams {
  action: MouseAction;
  /** 桌面的實體像素座標，不是擷取畫面裡的座標。 */
  screenX: number;
  screenY: number;
  /** 動作做完把游標移回畫面中央，預設 true。 */
  returnToCenter?: boolean;
}

export interface MouseActionResult {
  success: boolean;
  error?: string;
}

/** 一顆被監看的按鍵，以及它要觸發誰。註冊與回報用的是同一個形狀。 */
export interface HotkeyBinding {
  /** 按鍵名稱，例如 `F5`、`W`、`NUMPAD1`。命名合約在 `src/utils/hotkeys.ts`。 */
  hotkey: string;
  timerId?: string;
  ruleId?: string;
}

/**
 * 主視窗與懸浮視窗之間同步的東西。每次只送有變動的那幾個欄位，收的一方也只更新
 * 收到的那幾個，所以全部都是選擇性的。
 */
export interface TimersSyncPayload {
  timers?: CooldownTimer[];
  opacity?: number;
  layout?: 'horizontal' | 'vertical';
  iconSize?: number;
  textSize?: number;
  showName?: boolean;
}

/** 主程序回傳的檢查更新結果。刻意沒有 downloadUrl：畫面層不需要知道，也不該有機會
 *  影響下載來源——那個檔案下載完會被當成程式本身執行。 */
export interface UpdateInfo {
  ok: boolean;
  currentVersion: string;
  latestVersion?: string;
  hasUpdate?: boolean;
  title?: string;
  notes?: string;
  publishedAt?: string;
  pageUrl?: string;
  downloadSize?: number;
  /** 有 exe 附件、是打包版、找得到自己的 exe、資料夾可寫，四者都成立才能一鍵更新。 */
  canAutoUpdate?: boolean;
  /** 這個附件有 GitHub 提供的 sha256 可以驗證。 */
  verifiable?: boolean;
  /** 這個版本已經換過檔了，但版號還是沒進步——再更新一次也會是同樣結果。 */
  staleRetry?: boolean;
  message?: string;
}

export interface DownloadUpdateResult {
  ok: boolean;
  message?: string;
  /** 使用者自己按了取消。這不是錯誤，畫面不用再嚇他一次。 */
  cancelled?: boolean;
  /** true＝主程序馬上會關掉自己並啟動新版；false＝檔案已經換好，但要使用者自己重開。 */
  restarting?: boolean;
  /**
   * 檔名是不是已經換好了。restarting 為 true 時這兩件事仍然是分開的：
   * 換好了＝關掉之後啟動的一定是新版；還沒換好＝關掉之後由換檔腳本接手，
   * 而換檔還可能失敗（那時它會把原本的版本重新啟動）。畫面要照實說。
   */
  swapped?: boolean;
  /** 這次下載有 GitHub 的 sha256 可以對，而且對過了。 */
  verified?: boolean;
}

export interface DownloadProgress {
  received: number;
  total: number;
}

export interface ElectronAPI {
  getDesktopSources: () => Promise<DesktopSource[]>;
  /**
   * 擷取來源目前在桌面上的位置，單位是實體像素；問不到就回 null，呼叫端那時要退回
   * 原始的畫面座標，而不是拿一個猜的矩形去點。
   */
  getCaptureGeometry: (
    sourceId: string,
    frameWidth: number,
    frameHeight: number
  ) => Promise<Rect | null>;
  performMouseAction: (params: MouseActionParams) => Promise<MouseActionResult>;
  /** 回 false＝這個按鍵名稱對不到虛擬鍵，永遠不會被監看，畫面該叫他換一顆。 */
  registerGlobalHotkey: (params: HotkeyBinding) => Promise<boolean>;
  unregisterAllHotkeys: () => Promise<boolean>;
  openFloatingWindow: () => Promise<boolean>;
  closeFloatingWindow: () => Promise<boolean>;
  resizeFloatingWindow: (params: { width: number; height: number }) => Promise<boolean>;
  /** 這個是 `ipcRenderer.send`，不是 invoke，所以沒有回傳值也等不到對方收到。 */
  syncTimersData: (data: TimersSyncPayload) => void;
  /** 回傳值是取消訂閱用的，元件收掉的時候一定要呼叫。 */
  onTimersDataSynced: (callback: (data: TimersSyncPayload) => void) => () => void;
  onGlobalHotkeyTriggered: (callback: (data: HotkeyBinding) => void) => () => void;
  onFloatingWindowClosed: (callback: () => void) => () => void;
  getAppVersion: () => Promise<string>;
  checkForUpdate: () => Promise<UpdateInfo>;
  /** 刻意不收參數：下載網址、版號、大小、雜湊值全部由主程序自己向 GitHub 問。 */
  downloadUpdate: () => Promise<DownloadUpdateResult>;
  /** 回 false＝主程序手上沒有正在進行的下載（已經下載完、正在換檔了）。 */
  cancelUpdateDownload: () => Promise<boolean>;
  /** 網址必須落在我們自己那個 repo 底下，否則主程序會改開自己的下載頁。 */
  openReleasePage: (url?: string) => Promise<boolean>;
  /** 打開更新紀錄檔。換檔的後半段發生在程式關掉之後，只留在那個檔案裡。 */
  openUpdateLog: () => Promise<boolean>;
  onUpdateDownloadProgress: (callback: (data: DownloadProgress) => void) => () => void;
  isElectron: true;
}

declare global {
  interface Window {
    /** 只有 Electron 的 preload 會塞這個屬性；用瀏覽器開的時候是 undefined。 */
    electronAPI?: ElectronAPI;
  }
}
