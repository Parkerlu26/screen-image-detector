// 檢查更新 / 一鍵更新。免安裝綠色版沒有安裝器，所以流程是：讀 GitHub 最新 Release
// → 比版號 → 把新的 exe 下載到 exe 所在的同一層資料夾 → 交給一個獨立的 PowerShell
// 等本程序結束後啟動新檔、刪掉舊檔。任何一步失敗都會退回「開啟下載頁面」，
// 使用者不會卡在半途。
const { app, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { spawn } = require('child_process');

const REPO = 'Parkerlu26/screen-image-detector';
const LATEST_RELEASE_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;
const USER_AGENT = 'JuneWatcher-Updater';
const REQUEST_TIMEOUT_MS = 15000;
// 下載進度回報的節流間隔，避免每個 chunk 都打一次 IPC。
const PROGRESS_INTERVAL_MS = 200;

/** 同時只允許一個下載；記著它才能取消。 */
let activeDownload = null;

/** 「v1.2.3」→ [1,2,3]。非數字都當 0，所以 tag 有沒有前綴、有沒有後綴都不影響。 */
function parseVersion(text) {
  const parts = String(text || '').trim().replace(/^v/i, '').split(/[.\-+_]/);
  const nums = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const n = parseInt(parts[i], 10);
    nums[i] = Number.isFinite(n) ? n : 0;
  }
  return nums;
}

function isNewer(remote, local) {
  const a = parseVersion(remote);
  const b = parseVersion(local);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

/** GET 一次，自己跟隨轉址（Release 附件會跳到 objects.githubusercontent.com）。 */
function httpsGet(url, extraHeaders = {}, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { 'User-Agent': USER_AGENT, ...extraHeaders } },
      (res) => {
        const code = res.statusCode || 0;
        if (code >= 300 && code < 400 && res.headers.location) {
          res.resume();
          if (redirectsLeft <= 0) {
            reject(new Error('轉址次數過多'));
            return;
          }
          const next = new URL(res.headers.location, url).toString();
          // 轉址後的網址帶有簽章，多送 Authorization 之類的標頭會被拒絕，所以不往下傳。
          httpsGet(next, {}, redirectsLeft - 1).then(resolve, reject);
          return;
        }
        if (code !== 200) {
          res.resume();
          reject(new Error(`伺服器回應 ${code}`));
          return;
        }
        resolve(res);
      }
    );
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error('連線逾時')));
    req.on('error', reject);
  });
}

async function fetchJson(url) {
  const res = await httpsGet(url, { Accept: 'application/vnd.github+json' });
  const chunks = [];
  for await (const chunk of res) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** exe 真正所在的資料夾。免安裝版會先解壓到暫存區，所以優先看 PORTABLE_EXECUTABLE_DIR。 */
function appDir() {
  if (process.env.PORTABLE_EXECUTABLE_DIR) return process.env.PORTABLE_EXECUTABLE_DIR;
  try {
    return path.dirname(app.getPath('exe'));
  } catch {
    return process.cwd();
  }
}

/** 目前執行中的 exe。免安裝版要用 PORTABLE_EXECUTABLE_FILE，不然會指到暫存區裡的內層 exe。 */
function currentExe() {
  if (process.env.PORTABLE_EXECUTABLE_FILE) return process.env.PORTABLE_EXECUTABLE_FILE;
  try {
    return app.getPath('exe');
  } catch {
    return '';
  }
}

/** 新檔沿用本機的命名慣例（GitHub 上的附件名是純 ASCII 的，不好認）。 */
function localExeName(version) {
  return `六月幫你顧_免安裝綠色版_v${String(version).replace(/^v/i, '')}.exe`;
}

/** Release 裡那個 Windows 可執行檔。 */
function pickExeAsset(release) {
  const assets = Array.isArray(release && release.assets) ? release.assets : [];
  return assets.find((a) => /\.exe$/i.test(a.name || '')) || null;
}

function canWrite(dir) {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * 比對 GitHub 上的最新 Release。永遠回傳物件、不丟例外——檢查更新失敗不該讓畫面壞掉。
 */
async function checkForUpdate() {
  const currentVersion = app.getVersion();
  try {
    const release = await fetchJson(LATEST_RELEASE_URL);
    const latestVersion = String(release.tag_name || '').replace(/^v/i, '');
    if (!latestVersion) {
      return { ok: false, currentVersion, message: '讀不到最新版本號' };
    }
    const asset = pickExeAsset(release);
    return {
      ok: true,
      currentVersion,
      latestVersion,
      hasUpdate: isNewer(latestVersion, currentVersion),
      title: release.name || `v${latestVersion}`,
      notes: release.body || '',
      publishedAt: release.published_at || '',
      pageUrl: release.html_url || RELEASES_PAGE,
      // 沒有 exe 附件時只能請使用者自己去下載頁面。
      downloadUrl: asset ? asset.browser_download_url : '',
      downloadSize: asset ? asset.size || 0 : 0,
      canAutoUpdate: Boolean(asset) && app.isPackaged && canWrite(appDir()),
    };
  } catch (err) {
    return {
      ok: false,
      currentVersion,
      pageUrl: RELEASES_PAGE,
      message: (err && err.message) || '無法連線到 GitHub',
    };
  }
}

/** PowerShell 字串常值。路徑含中文或空白時，這是最不會出錯的傳法。 */
function psQuote(text) {
  return `'${String(text).replace(/'/g, "''")}'`;
}

/**
 * 換檔並重開。舊 exe 在執行中是鎖住的，所以這件事必須交給程式外面的人做：
 * 一個沒有視窗的 PowerShell 等本程序結束 → 啟動新檔 → 重試刪掉舊檔。
 * 用 -EncodedCommand（UTF-16LE base64）而不是寫成 .bat，是因為 cmd 讀 .bat 用的是
 * 系統 OEM 編碼，中文路徑會變成亂碼。
 */
function applyUpdate(newExe) {
  const oldExe = currentExe();
  const lines = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$target = ${psQuote(newExe)}`,
    `$old = ${psQuote(oldExe)}`,
    `try { Wait-Process -Id ${process.pid} -Timeout 30 } catch {}`,
    'Start-Sleep -Milliseconds 800',
    `Start-Process -FilePath $target -WorkingDirectory ${psQuote(path.dirname(newExe))}`,
    // 舊檔要等免安裝版的外層程序也放手才刪得掉，所以重試而不是只試一次；
    // 真的刪不掉就留著，反正不影響新版執行。
    'if ($old -and ($old -ne $target)) {',
    '  for ($i = 0; $i -lt 12; $i++) {',
    '    Start-Sleep -Milliseconds 700',
    '    Remove-Item -LiteralPath $old -Force',
    '    if (-not (Test-Path -LiteralPath $old)) { break }',
    '  }',
    '}',
  ].join('\n');
  const encoded = Buffer.from(lines, 'utf16le').toString('base64');
  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded],
    { detached: true, stdio: 'ignore', windowsHide: true }
  );
  child.unref();
}

/**
 * 下載新版 exe 到 exe 所在的資料夾，一邊回報進度，完成後直接換檔重開。
 * 先寫成 .part 再改名，中途斷線不會留下一個看起來正常但其實不完整的 exe。
 */
async function downloadUpdate(sender, { downloadUrl, version, downloadSize } = {}) {
  if (activeDownload) return { ok: false, message: '已經在下載了' };
  if (!downloadUrl) return { ok: false, message: '這個版本沒有可下載的執行檔' };
  if (!app.isPackaged) return { ok: false, message: '開發模式不支援自動更新' };
  const dir = appDir();
  if (!canWrite(dir)) {
    return { ok: false, message: '程式所在的資料夾沒有寫入權限，請改用手動下載' };
  }

  const dest = path.join(dir, localExeName(version || 'new'));
  const partial = `${dest}.part`;
  try {
    fs.rmSync(partial, { force: true });
  } catch {}

  try {
    const res = await httpsGet(downloadUrl);
    const total = Number(res.headers['content-length']) || Number(downloadSize) || 0;
    let received = 0;
    let lastSent = 0;
    await new Promise((resolve, reject) => {
      const file = fs.createWriteStream(partial);
      activeDownload = { res, file, partial };
      res.on('data', (chunk) => {
        received += chunk.length;
        const now = Date.now();
        if (now - lastSent >= PROGRESS_INTERVAL_MS) {
          lastSent = now;
          if (!sender.isDestroyed()) {
            sender.send('update-download-progress', { received, total });
          }
        }
      });
      res.on('error', reject);
      file.on('error', reject);
      file.on('finish', resolve);
      res.pipe(file);
    });
    activeDownload = null;

    const written = fs.statSync(partial).size;
    if (total && written !== total) {
      fs.rmSync(partial, { force: true });
      return { ok: false, message: '下載不完整，請再試一次' };
    }
    fs.rmSync(dest, { force: true });
    fs.renameSync(partial, dest);
    if (!sender.isDestroyed()) {
      sender.send('update-download-progress', { received: written, total: written });
    }
    applyUpdate(dest);
    // 讓 IPC 回應先送出去，畫面才有機會顯示「即將重新啟動」。
    setTimeout(() => app.quit(), 800);
    return { ok: true, restarting: true, file: dest };
  } catch (err) {
    activeDownload = null;
    try {
      fs.rmSync(partial, { force: true });
    } catch {}
    const cancelled = err && err.message === 'cancelled';
    return {
      ok: false,
      cancelled,
      message: cancelled ? '已取消下載' : (err && err.message) || '下載失敗',
    };
  }
}

function cancelDownload() {
  if (!activeDownload) return false;
  const { res } = activeDownload;
  activeDownload = null;
  try {
    res.destroy(new Error('cancelled'));
  } catch {}
  return true;
}

/** 註冊 IPC。呼叫端只要在 app ready 之後叫一次。 */
function registerUpdateHandlers(ipcMain) {
  ipcMain.handle('get-app-version', () => app.getVersion());
  ipcMain.handle('check-for-update', () => checkForUpdate());
  ipcMain.handle('download-update', (event, params) => downloadUpdate(event.sender, params));
  ipcMain.handle('cancel-update-download', () => cancelDownload());
  ipcMain.handle('open-release-page', (event, url) => {
    shell.openExternal(url || RELEASES_PAGE);
    return true;
  });
}

module.exports = { registerUpdateHandlers, checkForUpdate, parseVersion, isNewer };
