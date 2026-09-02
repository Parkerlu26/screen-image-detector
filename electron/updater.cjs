// 檢查更新 / 一鍵更新。免安裝綠色版沒有安裝器，所以流程是：讀 GitHub 最新 Release
// → 比版號 → 下載成 <目前exe>.new → 驗 sha256 → 交給一個獨立的 PowerShell 等本程序
// 結束後「就地換名」（舊檔搬去 .old、新檔頂上原本的檔名）→ 啟動 → 確認起得來才刪備份。
//
// 三個關鍵決定，都是從「使用者最後一定要有一個能跑的程式」這個條件推出來的：
//   1. 換檔用原本的檔名，不另存新檔名。捷徑、釘選、開機啟動項都指向那個路徑，
//      改名等於每次更新都把它們弄壞；使用者自己取的檔名也會被保留。
//   2. 舊檔只搬去 .old，不直接刪。要等新版真的啟動起來才刪備份，而「真的啟動起來」
//      是靠旗標檔握手回答的：腳本建立 <exe>.updating，新版把主視窗的畫面載完之後
//      才把它刪掉。判定失敗就把 .old 搬回原檔名並啟動它。
//      不變式只有一條，但必須永遠成立：任何一步失敗之後，原本那個路徑上都還要有
//      一個能執行的檔案。
//   3. 下載網址、版號、雜湊值一律由主程序自己向 GitHub 問，不接受畫面層傳進來的值。
//      這個檔案下載完會被執行，信任來源只能是 TLS 之下的 api.github.com。
const { app, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const { spawn } = require('child_process');

const REPO = 'Parkerlu26/screen-image-detector';
const LATEST_RELEASE_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;
const USER_AGENT = 'JuneWatcher-Updater';
// 這是 socket 閒置逾時，不是總時間，所以大檔案慢慢下載不會被砍。
const REQUEST_TIMEOUT_MS = 15000;
// 下載進度回報的節流間隔，避免每個 chunk 都打一次 IPC。
const PROGRESS_INTERVAL_MS = 200;
// 只允許這些網域，每一次轉址都檢查。加上 sha256 比對之後這是第二層保險，
// 但仍然要有：我們不希望任何一跳把 93 MB 的請求送去別人的主機。
const ALLOWED_HOSTS = ['github.com', 'githubusercontent.com'];
const NEW_SUFFIX = '.new';
const OLD_SUFFIX = '.old';
const PART_SUFFIX = '.part';
// 換檔進行中的旗標。換檔腳本在啟動新版之前建立它，新版啟動時把它刪掉——
// 「新版真的跑起來了」這件事就是靠這個刪除動作回答的，而不是靠「幾秒內沒死掉」。
// 它同時也是「現在不要清暫存檔」的信號：腳本這時手上還握著 .old 當回滾用。
const SWAP_MARK_SUFFIX = '.updating';
// 記下「已經套用過哪個 tag」。萬一 Release 的 tag 與 exe 內建版號不一致，
// 沒有這個紀錄就會每次開機都提示更新、下載、重開，永遠停不下來。
const APPLIED_FILENAME = 'applied-update.json';
const CANCELLED = 'cancelled';

/** 同時只允許一個下載；記著它才能取消，也才關得掉檔案 handle。 */
let activeDownload = null;

/**
 * 「v1.2.3」→[1,2,3]、「v1.2.0.1」→[1,2,0,1]。回傳 null 表示這個 tag 根本沒有
 * 版號可比（例如 tag 叫 latest）——那要當成「比不出來」回報，不能默默說已是最新版。
 * 舊版只讀前三段又把非數字當 0，所以 v1.2.0.1 永遠送不出去。
 */
function parseVersion(text) {
  const clean = String(text || '').trim().replace(/^v/i, '');
  // 整串必須是「數字加點」。1.2.3、1.2.3.4 可以；1.2.3-rc1、2026-09-01 一律回 null。
  // 寬鬆解析會製造兩種真實災難：把 v1.2.3-beta 當成正式版靜默套用，以及把日期 tag
  // 解成 [2026,9,1]——比任何版號都新，於是每次開機都提示更新、重下、重開。
  // 回 null 的後果只是畫面說「線上的版本號格式無法比對，請自己到下載頁面看看」，
  // 那是安全的方向。
  if (!/^\d+(\.\d+)*$/.test(clean)) return null;
  return clean.split('.').map((part) => parseInt(part, 10));
}

function isNewer(remote, local) {
  const a = parseVersion(remote);
  const b = parseVersion(local);
  if (!a) return false;
  if (!b) return true;
  const len = a.length > b.length ? a.length : b.length;
  for (let i = 0; i < len; i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

/** 網址必須是 https，而且主機必須落在 ALLOWED_HOSTS 底下（含子網域）。 */
function hostAllowed(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return ALLOWED_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

/**
 * 可以交給瀏覽器開的頁面：只有我們自己那個 repo 底下的路徑。
 * 「是 github.com 就好」不夠——那等於允許畫面層把使用者送到 GitHub 上任何一頁
 * （別人的 repo、別人的 Release 附件下載連結）。
 * 用解析後的 pathname 比對而不是字串開頭，因為 new URL 會把 ../ 正規化掉：
 * https://github.com/Parkerlu26/screen-image-detector/../../someone-else 通不過。
 */
function releasePageAllowed(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    if (parsed.hostname.toLowerCase() !== 'github.com') return false;
    return parsed.pathname === `/${REPO}` || parsed.pathname.startsWith(`/${REPO}/`);
  } catch {
    return false;
  }
}

/**
 * 進度回報。一定要包起來：sender 是 webContents，在 send 的那一瞬間被關掉的話
 * 這裡會丟例外。它的呼叫點在 res.on('data') 裡面——那是別的 tick，例外不會被下載
 * 流程的 try 接到，結果是主程序噴未處理例外，而 activeDownload 永遠卡著不放。
 */
function sendProgress(sender, payload) {
  try {
    if (sender && !sender.isDestroyed()) sender.send('update-download-progress', payload);
  } catch {}
}

/** HTTP 狀態碼翻成使用者看得懂的話。「伺服器回應 403」沒人知道要怎麼辦。 */
function statusMessage(code) {
  if (code === 403 || code === 429) {
    return 'GitHub 暫時限制查詢次數（未登入每小時 60 次），請過一陣子再試';
  }
  if (code === 404) return '在 GitHub 上找不到這個 Release';
  if (code === 401) return 'GitHub 拒絕了這次查詢（401）';
  if (code >= 500) return `GitHub 伺服器忙碌中（${code}），請稍後再試`;
  return `GitHub 回應了非預期的狀態（${code}）`;
}

/** 連線層的錯誤同樣要中文化，而且要說出使用者能採取的動作。 */
function networkMessage(err) {
  const code = (err && err.code) || '';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return '連不上網路（DNS 查不到 GitHub），請確認網路連線';
  if (code === 'ECONNRESET' || code === 'ECONNABORTED' || code === 'EPIPE') return '網路連線被中斷，請再試一次';
  if (code === 'ETIMEDOUT' || code === 'ERR_SOCKET_CONNECTION_TIMEOUT') return '連線逾時，請再試一次';
  if (code === 'ECONNREFUSED') return '連線被拒絕，可能是防火牆或代理伺服器擋住了';
  if (code === 'CERT_HAS_EXPIRED' || String(code).startsWith('UNABLE_TO_VERIFY')) {
    return '無法驗證 GitHub 的憑證，請確認系統時間與防毒軟體的 SSL 設定';
  }
  return (err && err.message) || '連線失敗';
}

/** GET 一次，自己跟隨轉址（Release 附件會跳到 release-assets.githubusercontent.com）。 */
function httpsGet(url, extraHeaders = {}, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    if (!hostAllowed(url)) {
      reject(new Error('下載來源不是 GitHub 的網域，已中止'));
      return;
    }
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
          reject(new Error(statusMessage(code)));
          return;
        }
        resolve(res);
      }
    );
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error('連線逾時')));
    req.on('error', (err) => reject(new Error(networkMessage(err))));
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

function exeDir() {
  const exe = currentExe();
  return exe ? path.dirname(exe) : appDir();
}

/**
 * 只在「自動換檔失敗、要把下載好的檔案留給使用者自己執行」時才用得到的檔名。
 * 字元白名單是必要的：這個字串會被接進檔名再交給 path.join，
 * 沒過濾的話 ../.. 之類的輸入可以跳出程式所在的資料夾。
 */
function localExeName(tag) {
  const clean = String(tag || '').replace(/^v/i, '').replace(/[^0-9A-Za-z._-]/g, '');
  const safe = /^[0-9A-Za-z][0-9A-Za-z._-]*$/.test(clean) && !clean.includes('..') ? clean : 'new';
  return `六月幫你顧_免安裝綠色版_v${safe}.exe`;
}

/**
 * Release 裡那個「就是程式本身」的 exe。
 * 不能只取第一個 .exe：build 設定裡還有 nsis target，哪一天同一個 Release 多放一個
 * 安裝檔，靜默換檔流程就會把安裝檔當成程式本身搬到原檔名上——使用者的捷徑從此指向
 * 一個安裝程式。分不清楚時寧可回 null，讓使用者走手動下載。
 * 還沒上傳完的附件（state 不是 uploaded）也要排除。
 */
function pickExeAsset(release) {
  const assets = (Array.isArray(release && release.assets) ? release.assets : []).filter(
    (a) => a && /\.exe$/i.test(a.name || '') && (a.state === undefined || a.state === 'uploaded')
  );
  if (!assets.length) return null;
  const portable = assets.filter((a) => /portable|免安裝/i.test(a.name || ''));
  if (portable.length === 1) return portable[0];
  if (portable.length > 1) return null;
  // 沒有任何附件標著 portable／免安裝：只有在「全場只有一個 exe」而且它看起來不是
  // 安裝程式的時候才敢用。含「免安裝」的檔名不會走到這裡（上面已經接走了），
  // 所以這裡可以直接把「安裝」當成拒絕的訊號。
  if (assets.length !== 1) return null;
  const only = assets[0];
  if (/setup|install|安裝/i.test(only.name || '')) return null;
  return only;
}

/** 附件的 sha256（GitHub 會給 "sha256:<hex>"）。沒有就回空字串。 */
function parseDigest(digest) {
  const m = /^sha256:([0-9a-f]{64})$/i.exec(String(digest || '').trim());
  return m ? m[1].toLowerCase() : '';
}

/**
 * 資料夾能不能寫。一定要真的寫一個檔案試試看：Windows 上 fs.accessSync(W_OK)
 * 只看唯讀屬性、看不到 ACL，所以在 Program Files 底下它會回報「可以寫」，
 * 等到真的要換檔才失敗。
 */
function canWrite(dir) {
  const probe = path.join(dir, `.june-write-test-${process.pid}`);
  try {
    fs.writeFileSync(probe, '');
    return true;
  } catch {
    return false;
  } finally {
    try {
      fs.rmSync(probe, { force: true });
    } catch {}
  }
}

function appliedPath() {
  try {
    return path.join(app.getPath('userData'), APPLIED_FILENAME);
  } catch {
    return '';
  }
}

/** 上一次真的送出去換檔的 tag。 */
function readAppliedTag() {
  const file = appliedPath();
  if (!file) return '';
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return String((data && data.tag) || '');
  } catch {
    return '';
  }
}

function writeAppliedTag(tag) {
  const file = appliedPath();
  if (!file) return;
  try {
    fs.writeFileSync(file, JSON.stringify({ tag: String(tag || ''), at: Date.now() }), 'utf8');
  } catch {}
}

/**
 * 開機時清掉上一輪沒清完的暫存檔（下載被中斷的 .part、換檔沒跑到的 .new、
 * 換檔中斷留下的 .old）。不清的話一個 .part 就佔 90 MB。
 * 這件事之所以安全，是因為主程序有單一實例鎖：不會有另一個實例正在寫這些檔案。
 *
 * 但有一個例外必須先處理：如果 .updating 旗標還在，表示換檔腳本正在旁邊等我們
 * 「證明自己起得來」，而它手上還握著 .old 當回滾備份。這時候一個字都不要碰——
 * .new / .old 是別人正在用的回滾材料。等下一次開機（那時已經沒有旗標）再清。
 */
function cleanupLeftovers() {
  const exe = currentExe();
  if (!exe) return;
  if (fs.existsSync(exe + SWAP_MARK_SUFFIX)) return;
  for (const file of [exe + NEW_SUFFIX + PART_SUFFIX, exe + NEW_SUFFIX, exe + OLD_SUFFIX]) {
    try {
      fs.rmSync(file, { force: true });
    } catch {}
  }
}

/**
 * 換檔握手的另一半：刪掉 .updating，告訴換檔腳本「新版真的活起來了」。
 *
 * 呼叫點刻意放在主視窗的畫面載入完成，而不是 app.whenReady()。要回答的問題是
 * 「使用者拿到一個能用的程式了嗎」，而 whenReady 只證明 Electron 的主程序起來了；
 * 畫面載完才代表 Chromium、asar 裡的前端、preload 這一整條都沒問題。
 *
 * 刪完之後刻意不順手清 .new / .old：腳本這一刻正要判定成功並自己刪備份，
 * 萬一它因為別的原因判定失敗（例如新檔被防毒吃掉），那個備份是唯一的退路。
 *
 * 這個動作是換檔協定的一半，未來版本不能拿掉，否則舊版的換檔腳本會以為新版沒起來
 * 而把它回滾掉。
 */
function confirmBootForSwap() {
  const exe = currentExe();
  if (!exe) return;
  try {
    fs.rmSync(exe + SWAP_MARK_SUFFIX, { force: true });
  } catch {}
}

/**
 * 比對 GitHub 上的最新 Release。永遠回傳物件、不丟例外——檢查更新失敗不該讓畫面壞掉。
 * 注意這裡不回傳下載網址：畫面層不需要知道，也不該有機會影響它。
 */
async function checkForUpdate() {
  const currentVersion = app.getVersion();
  try {
    const release = await fetchJson(LATEST_RELEASE_URL);
    const tag = String(release.tag_name || '');
    const latestVersion = tag.replace(/^v/i, '');
    if (!parseVersion(tag)) {
      return { ok: false, currentVersion, pageUrl: RELEASES_PAGE, message: '線上的版本號格式無法比對，請自己到下載頁面看看' };
    }
    const asset = pickExeAsset(release);
    const hasUpdate = isNewer(latestVersion, currentVersion);
    const dir = exeDir();
    return {
      ok: true,
      currentVersion,
      latestVersion,
      hasUpdate,
      title: release.name || `v${latestVersion}`,
      notes: release.body || '',
      publishedAt: release.published_at || '',
      pageUrl: release.html_url || RELEASES_PAGE,
      downloadSize: asset ? asset.size || 0 : 0,
      // 有可用附件、是打包版、找得到自己的 exe、資料夾真的可寫，四者都成立才能一鍵更新。
      canAutoUpdate: Boolean(asset) && app.isPackaged && Boolean(currentExe()) && canWrite(dir),
      // 這個附件有沒有 sha256 可以驗。
      verifiable: Boolean(asset && parseDigest(asset.digest)),
      // 這個 tag 已經換過檔了，但版號還是沒進步 → 不要再自動提示，免得無限重下。
      staleRetry: hasUpdate && readAppliedTag() === tag,
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
 * 換檔並重開。舊 exe 在執行中是鎖住的，所以這件事必須交給程式外面的人做。
 * 用 -EncodedCommand（UTF-16LE base64）而不是寫成 .bat，是因為 cmd 讀 .bat 用的是
 * 系統 OEM 編碼，中文路徑會變成亂碼。
 *
 * ErrorActionPreference 設成 Stop 而不是 SilentlyContinue：這個腳本每一步都會失敗，
 * 而失敗必須被看見、被處理，不能被吞掉繼續往下走（舊版就是這樣才會在新版沒啟動的
 * 情況下把舊檔刪掉）。
 */
function swapScript({ target, staged, expectedSize }) {
  const dir = path.dirname(target);
  return [
    "$ErrorActionPreference = 'Stop'",
    `$target = ${psQuote(target)}`,
    `$staged = ${psQuote(staged)}`,
    `$backup = ${psQuote(target + OLD_SUFFIX)}`,
    `$dir = ${psQuote(dir)}`,
    `$size = ${Number(expectedSize) || 0}`,
    // 換檔旗標。步驟 4 建立它，新版啟動時自己刪掉；它消失就是「新版真的跑起來了」。
    `$mark = ${psQuote(target + SWAP_MARK_SUFFIX)}`,
    '',
    '# 1. 等舊程序真的結束。免安裝版的外層 launcher 會抱著 exe 不放，沒等到就換檔',
    '#    只會換一半。這裡等不到就什麼都不做，而且刻意不去啟動舊版——',
    '#    走到這條路表示舊程序還活著（app.quit() 被擋住或畫面卡死），',
    '#    使用者手上有一個還開著的程式，再開一個只會被單一實例鎖踢掉。',
    '#    $target 到這裡完全沒被動過，所以「原路徑一定有一個能跑的 exe」是成立的。',
    `for ($i = 0; $i -lt 240; $i++) {`,
    `  if (-not (Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue)) { break }`,
    '  Start-Sleep -Milliseconds 500',
    '}',
    `if (Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue) { exit 1 }`,
    'Start-Sleep -Milliseconds 800',
    '',
    '# 2. 新檔要還在、大小要對才動手。防毒把下載回來的檔案吃掉時就停在這裡。',
    '#    這裡跟步驟 1 不同：舊程序已經結束了，使用者的程式剛剛在他眼前關掉。',
    '#    什麼都不做就等於「按了更新，程式消失了」，所以一定要把舊版重新啟動。',
    'if (-not (Test-Path -LiteralPath $staged)) {',
    '  try { Start-Process -FilePath $target -WorkingDirectory $dir } catch {}',
    '  exit 1',
    '}',
    'if ($size -gt 0 -and (Get-Item -LiteralPath $staged).Length -ne $size) {',
    '  Remove-Item -LiteralPath $staged -Force -ErrorAction SilentlyContinue',
    '  try { Start-Process -FilePath $target -WorkingDirectory $dir } catch {}',
    '  exit 1',
    '}',
    '',
    '# 3. 就地換名。檔案鎖可能還沒放掉（防毒正在掃那個 90 MB 的新檔），所以要重試。',
    '#    重試迴圈唯一要守住的不變式是：每一圈開始時 $target 一定在原地，$backup 是可丟的。',
    '#    舊版沒守住這件事——第一圈如果「舊檔已改名、新檔還沒頂上」就失敗，',
    '#    第二圈的 Remove-Item 會把唯一的舊 exe 刪掉，之後原路徑就永遠是空的。',
    '$swapped = $false',
    'for ($i = 0; $i -lt 20; $i++) {',
    '  try {',
    '    if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Force }',
    '    Move-Item -LiteralPath $target -Destination $backup -Force',
    '    Move-Item -LiteralPath $staged -Destination $target -Force',
    '    $swapped = $true',
    '    break',
    '  } catch {',
    '    # 失敗就先把不變式修回來，再睡一下重試。',
    '    if (-not (Test-Path -LiteralPath $target)) {',
    '      if (Test-Path -LiteralPath $backup) {',
    '        try { Move-Item -LiteralPath $backup -Destination $target -Force } catch {}',
    '      } elseif (Test-Path -LiteralPath $staged) {',
    '        # 極端狀況：舊檔不見了、新檔還在。那就讓新檔頂上，總比原路徑空著好。',
    '        try { Move-Item -LiteralPath $staged -Destination $target -Force; $swapped = $true } catch {}',
    '      }',
    '    }',
    '    if ($swapped) { break }',
    '    Start-Sleep -Milliseconds 700',
    '  }',
    '}',
    'if (-not $swapped) {',
    '  # 不變式保證這裡的 $target 還在（上面的 catch 已經修過），保險再檢查一次。',
    '  if (-not (Test-Path -LiteralPath $target)) {',
    '    if (Test-Path -LiteralPath $backup) {',
    '      try { Move-Item -LiteralPath $backup -Destination $target -Force } catch {}',
    '    } elseif (Test-Path -LiteralPath $staged) {',
    '      try { Move-Item -LiteralPath $staged -Destination $target -Force } catch {}',
    '    }',
    '  }',
    '  try { Start-Process -FilePath $target -WorkingDirectory $dir } catch {}',
    '  exit 1',
    '}',
    '',
    '# 4. 啟動新版，並用旗標握手確認它真的起來了。',
    '#    「六秒內沒有以非零碼結束」根本回答不了「起來了嗎」：新版可能開了一個錯誤',
    '#    對話框卡在那裡、可能 exit 0 就收工，免安裝版的外層 launcher 也可能先退場。',
    '#    所以改成要正向證據：腳本先建立 $mark，新版把畫面載完之後才把它刪掉。',
    '#    旗標消失＝真的跑起來了；行程沒了而旗標還在＝沒起來。',
    '#    「還活著但旗標沒被刪」刻意當成成功——不跟一個正在執行的程式搶它自己的檔案。',
    '$useMark = $true',
    "try { Set-Content -LiteralPath $mark -Value 'swap' -Encoding ASCII } catch { $useMark = $false }",
    '$failed = $false',
    '$booted = $false',
    '$exited = $false',
    '$grace = 24',
    'try {',
    '  $p = Start-Process -FilePath $target -WorkingDirectory $dir -PassThru',
    '  $havePid = ($p -ne $null)',
    '  # 有旗標可用就等最多 60 秒（冷開機＋解壓縮＋防毒掃描是真的會慢）；',
    '  # 沒有旗標就退回舊的判定，時間也維持原本的 6 秒。',
    '  $rounds = 120',
    '  if (-not $useMark) { $rounds = 12 }',
    '  for ($i = 0; $i -lt $rounds; $i++) {',
    '    Start-Sleep -Milliseconds 500',
    '    if ($useMark -and -not (Test-Path -LiteralPath $mark)) { $booted = $true; break }',
    '    if ($havePid -and $p.HasExited) {',
    '      $exited = $true',
    '      # Start-Process -PassThru 拿到的物件不保證讀得到 ExitCode（拿不到時是 $null，',
    '      # 讀它本身也可能丟例外）。$null -ne 0 會是 true，直接拿它當「非零＝失敗」用',
    '      # 就會把一個其實跑得好好的新版回滾掉，所以只有「明確拿到非零」才算失敗。',
    '      $code = $null',
    '      try { $code = $p.ExitCode } catch {}',
    '      if ($code -ne $null -and $code -ne 0) { break }',
    '      if (-not $useMark) { $booted = $true; break }',
    '      # exit 0：可能是外層 launcher 交棒後自己退場，再給 12 秒等旗標消失。',
    '      $grace = $grace - 1',
    '      if ($grace -le 0) { break }',
    '    }',
    '  }',
    '  if (-not $booted -and $exited) { $failed = $true }',
    '  if (-not (Test-Path -LiteralPath $target)) { $failed = $true }',
    '} catch { $failed = $true }',
    '',
    '# 5. 失敗就回滾。這是整段腳本存在的理由：絕對不能讓使用者落到',
    '#    「新的跑不起來、舊的也不見了」。',
    '#    舊版把三個動作寫在同一個 try 裡，所以只要備份已經被刪掉（新版開機的清理程式',
    '#    就會做這件事），第二個 Move 會丟例外，而第一個 Move 早就把新檔從原檔名搬走了',
    '#    ——原路徑於是變成空的。現在每一步各自 try，最後再強制檢查原檔名有沒有東西。',
    'if ($failed) {',
    '  if (Test-Path -LiteralPath $backup) {',
    '    try {',
    '      if (Test-Path -LiteralPath $target) {',
    '        Remove-Item -LiteralPath $staged -Force -ErrorAction SilentlyContinue',
    '        Move-Item -LiteralPath $target -Destination $staged -Force',
    '      }',
    '    } catch {}',
    '    try { Move-Item -LiteralPath $backup -Destination $target -Force } catch {}',
    '  }',
    '  # 回滾成不成功是次要的，原檔名有一個能執行的東西才是必要的。備份優先，其次是新檔。',
    '  if (-not (Test-Path -LiteralPath $target)) {',
    '    if (Test-Path -LiteralPath $backup) {',
    '      try { Move-Item -LiteralPath $backup -Destination $target -Force } catch {}',
    '    } elseif (Test-Path -LiteralPath $staged) {',
    '      try { Move-Item -LiteralPath $staged -Destination $target -Force } catch {}',
    '    }',
    '  }',
    '  Remove-Item -LiteralPath $mark -Force -ErrorAction SilentlyContinue',
    '  try { if (Test-Path -LiteralPath $target) { Start-Process -FilePath $target -WorkingDirectory $dir } } catch {}',
    '  exit 1',
    '}',
    '',
    '# 6. 確定成功了才刪備份。旗標正常情況下已經被新版刪掉，這裡收尾以防它留著',
    '#    （留著會讓下一次開機的清理程式以為又有換檔在進行中）。',
    'Remove-Item -LiteralPath $mark -Force -ErrorAction SilentlyContinue',
    'for ($i = 0; $i -lt 12; $i++) {',
    '  Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue',
    '  if (-not (Test-Path -LiteralPath $backup)) { break }',
    '  Start-Sleep -Milliseconds 700',
    '}',
  ].join('\n');
}

/**
 * 把換檔腳本丟出去。回傳 Promise：spawn 的失敗（找不到 powershell.exe、被 AppLocker
 * 擋掉）是非同步送到 'error' 事件的，舊版沒接，於是畫面收到「即將重新啟動」、
 * 800 毫秒後程式關掉，而根本沒有人會去啟動新版。
 */
function applyUpdate(params) {
  const encoded = Buffer.from(swapScript(params), 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    let settled = false;
    let child;
    try {
      child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded],
        { detached: true, stdio: 'ignore', windowsHide: true }
      );
    } catch (err) {
      reject(err);
      return;
    }
    child.once('spawn', () => {
      if (settled) return;
      settled = true;
      child.unref();
      resolve();
    });
    child.once('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

/** Windows 不能刪掉還開著的檔案，所以清理前一定要先把 handle 關掉。 */
function closeStream(file) {
  return new Promise((resolve) => {
    if (!file || file.destroyed) {
      resolve();
      return;
    }
    const done = setTimeout(resolve, 2000);
    file.once('close', () => {
      clearTimeout(done);
      resolve();
    });
    file.destroy();
  });
}

/**
 * 下載新版 exe 並換檔。刻意不接受任何參數：網址、版號、大小、雜湊值全部由主程序
 * 自己向 GitHub 問。舊版是把 downloadUrl 和 version 從畫面層經 IPC 傳進來，
 * 而這個檔案下載完會被執行、版號會被接進檔名——那是不該存在的信任關係。
 * 先寫成 .part 再改名，中途斷線不會留下一個看起來正常但其實不完整的 exe。
 */
async function downloadUpdate(sender) {
  if (activeDownload) return { ok: false, message: '已經在下載了' };
  if (!app.isPackaged) return { ok: false, message: '開發模式不支援自動更新' };
  const target = currentExe();
  if (!target) return { ok: false, message: '找不到目前執行檔的位置，請改用手動下載' };
  const dir = path.dirname(target);
  if (!canWrite(dir)) {
    return {
      ok: false,
      message: '程式所在的資料夾沒有寫入權限（例如放在 Program Files 底下），請把程式搬到桌面或文件資料夾，或改用手動下載',
    };
  }

  let release;
  try {
    release = await fetchJson(LATEST_RELEASE_URL);
  } catch (err) {
    return { ok: false, message: (err && err.message) || '無法連線到 GitHub' };
  }
  const tag = String(release.tag_name || '');
  const asset = pickExeAsset(release);
  if (!asset) return { ok: false, message: '這個 Release 沒有可以自動更新的執行檔，請改用手動下載' };
  if (!isNewer(tag.replace(/^v/i, ''), app.getVersion())) {
    return { ok: false, message: '線上的版本並沒有比目前這個新' };
  }
  const url = String(asset.browser_download_url || '');
  if (!hostAllowed(url)) return { ok: false, message: '下載網址不是 GitHub 的網域，已中止' };

  const expectedDigest = parseDigest(asset.digest);
  const expectedSize = Number(asset.size) || 0;
  const staged = target + NEW_SUFFIX;
  const partial = staged + PART_SUFFIX;
  try {
    fs.rmSync(partial, { force: true });
  } catch {}

  let file = null;
  let res = null;
  try {
    res = await httpsGet(url);
    // content-length 可能沒有（chunked），那就退回用 GitHub 給的附件大小當分母。
    const total = Number(res.headers['content-length']) || expectedSize;
    let received = 0;
    let lastSent = 0;
    const hash = crypto.createHash('sha256');
    await new Promise((resolve, reject) => {
      file = fs.createWriteStream(partial);
      activeDownload = { res, file };
      res.on('data', (chunk) => {
        hash.update(chunk);
        received += chunk.length;
        const now = Date.now();
        if (now - lastSent >= PROGRESS_INTERVAL_MS) {
          lastSent = now;
          sendProgress(sender, { received, total });
        }
      });
      res.on('error', reject);
      file.on('error', reject);
      file.on('finish', resolve);
      res.pipe(file);
    });
    activeDownload = null;
    // Windows 不能對還開著的檔案改名，所以一定要先等 fd 關掉。
    await closeStream(file);

    const written = fs.statSync(partial).size;
    if (expectedSize && written !== expectedSize) {
      fs.rmSync(partial, { force: true });
      return { ok: false, message: '下載回來的檔案大小不對，可能中途斷線，請再試一次' };
    }
    // 這個檔案接下來會被執行。GitHub 只要給了雜湊值就一定要比對——TLS 保證的是
    // 「東西是從 GitHub 來的」，雜湊保證的是「而且沒有在磁碟這一段壞掉或被換掉」。
    if (expectedDigest && hash.digest('hex') !== expectedDigest) {
      fs.rmSync(partial, { force: true });
      return { ok: false, message: '下載回來的檔案驗證失敗（雜湊值不符），已經丟棄，請再試一次或改用手動下載' };
    }
    try {
      fs.rmSync(staged, { force: true });
    } catch {}
    fs.renameSync(partial, staged);
    sendProgress(sender, { received: written, total: written });

    try {
      await applyUpdate({ target, staged, expectedSize: written });
    } catch (err) {
      // 換檔腳本連起不來（找不到 powershell.exe、被群組原則或 AppLocker 擋掉）。
      // 新版已經在硬碟上了，所以把它改成一個可以直接雙擊的檔名交給使用者，
      // 而不是回一句「更新失敗」然後留一個 .new 在旁邊。
      const manual = path.join(dir, localExeName(tag));
      let handed = '';
      try {
        fs.rmSync(manual, { force: true });
        fs.renameSync(staged, manual);
        handed = manual;
      } catch {}
      return {
        ok: false,
        message: handed
          ? `無法啟動換檔程式（${(err && err.message) || 'powershell.exe'}）。新版已經下載好放在：${handed}，請關掉這個程式後直接執行它。`
          : `無法啟動換檔程式（${(err && err.message) || 'powershell.exe'}），請改用手動下載。`,
      };
    }
    // 記下這個 tag 已經送出去換檔了。萬一 Release 的 tag 跟 exe 內建版號不一致，
    // 下次開機才不會又提示同一版、又下載 90 MB、又重開一次。
    writeAppliedTag(tag);
    // 讓這次 IPC 的回應先送到畫面（顯示「即將重新啟動」），再退出。
    setTimeout(() => app.quit(), 800);
    return { ok: true, restarting: true, verified: Boolean(expectedDigest) };
  } catch (err) {
    activeDownload = null;
    // 連線也要斷，不只是關檔案。磁碟寫滿時只關檔案的話，socket 會繼續把 90 MB
    // 收完——使用者早就看到「下載失敗」了，網路卻還在跑。
    try {
      if (res) res.destroy();
    } catch {}
    await closeStream(file);
    try {
      fs.rmSync(partial, { force: true });
    } catch {}
    const cancelled = Boolean(err && err.message === CANCELLED);
    return {
      ok: false,
      cancelled,
      message: cancelled ? '已取消下載' : (err && err.message) || '下載失敗',
    };
  }
}

/**
 * 取消。先把連線斷掉再關檔案 handle，順序不能反：Windows 上檔案還開著就刪不掉，
 * 而連線沒斷的話 pipe 會繼續往一個正在關的 stream 寫。
 */
async function cancelDownload() {
  const current = activeDownload;
  if (!current) return false;
  activeDownload = null;
  try {
    current.res.destroy(new Error(CANCELLED));
  } catch {}
  await closeStream(current.file);
  return true;
}

/**
 * IPC 註冊。三個地方刻意不信任畫面層：
 *   - download-update 不收參數（網址／版號／雜湊自己去 GitHub 問）。
 *   - open-release-page 收到的網址必須落在我們自己那個 repo 的路徑底下，
 *     否則就改開我們自己的頁面。shell.openExternal 會把字串交給作業系統，
 *     而且「開一個網頁」也不該變成「開任何人的下載連結」。
 *   - 進度事件只送回發出請求的那個 webContents。
 */
function registerUpdateHandlers(ipcMain) {
  ipcMain.handle('get-app-version', () => app.getVersion());
  ipcMain.handle('check-for-update', () => checkForUpdate());
  ipcMain.handle('download-update', (event) => downloadUpdate(event.sender));
  ipcMain.handle('cancel-update-download', () => cancelDownload());
  ipcMain.handle('open-release-page', async (_event, url) => {
    const wanted = String(url || '');
    const safe = releasePageAllowed(wanted) ? wanted : RELEASES_PAGE;
    try {
      await shell.openExternal(safe);
      return true;
    } catch {
      return false;
    }
  });
}

module.exports = {
  registerUpdateHandlers,
  checkForUpdate,
  cleanupLeftovers,
  confirmBootForSwap,
  // 匯出給測試用：版號比較是整個更新流程的判斷核心。
  parseVersion,
  isNewer,
  hostAllowed,
  releasePageAllowed,
  pickExeAsset,
};
