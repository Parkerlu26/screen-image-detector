// 檢查更新 / 一鍵更新。免安裝綠色版沒有安裝器，所以流程是：讀 GitHub 最新 Release
// → 比版號 → 下載成 <目前exe>.new → 驗 sha256 → 在本程序內就把檔名換好（舊檔搬去
// .old、新檔頂上原本的檔名）→ 交給一個獨立的 PowerShell 等本程序結束後啟動新版 →
// 確認起得來才刪備份。
//
// 四個關鍵決定，都是從「使用者最後一定要有一個能跑的程式」這個條件推出來的：
//   1. 換檔用原本的檔名，不另存新檔名。捷徑、釘選、開機啟動項都指向那個路徑，
//      改名等於每次更新都把它們弄壞；使用者自己取的檔名也會被保留。
//   2. 換檔在「程式還活著」的時候就做完。Windows 禁止刪除正在執行的映像檔，但允許
//      改名，所以這件事根本不必等程式結束、也不必外包給腳本。這樣做的理由是失敗面：
//      換檔一旦在這裡完成，原路徑上就已經是新版，後面那個 PowerShell 不管被防毒擋掉、
//      被 EDR 砍掉還是根本沒被執行，使用者只要再打開他平常用的那個檔案就是新版。
//      舊的做法把「換檔」和「重開」一起外包出去，於是腳本一失敗就兩件事都沒發生：
//      程式自己關掉、新版沒開、舊版還在原地——而且沒有任何紀錄。
//   3. 因此外面那個腳本只剩一件事：等本程序結束 → 啟動新版 → 確認它起得來 → 刪備份。
//      而且要先證明它自己活著（在紀錄檔寫下第一行）本程序才會 quit。spawn 成功只代表
//      行程被建立，防毒把它砍掉的時候 spawn 一樣會成功。等不到就不要關程式，改成請
//      使用者自己關掉再打開——那句話一定成立，因為檔案已經換好了。
//      「新版真的啟動起來」同樣要正向證據：腳本建立 <exe>.updating，新版把主視窗的
//      畫面載完之後才把它刪掉。判定失敗就把 .old 搬回原檔名並啟動它。
//      不變式只有一條，但必須永遠成立：任何一步失敗之後，原本那個路徑上都還要有
//      一個能執行的檔案。
//   4. 全程寫一份純文字紀錄放在 exe 旁邊。程式關掉之後發生的事情，沒有紀錄就完全
//      看不見，只能猜。這份紀錄是唯一能事後回答「那次更新到底卡在哪一步」的東西。
//   5. 下載網址、版號、雜湊值一律由主程序自己向 GitHub 問，不接受畫面層傳進來的值。
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
// 「改名全被拒絕、只能用複製」時的落地檔名。複製不能直接寫使用者天天雙擊的那個路徑：
// 中途斷電或磁碟滿了會在那個檔名底下留一個半截的 exe，而後面每一個判斷都只看
// 「檔案存在嗎」，於是會一路把它當成一個能執行的程式。先落地再改名，改名是原子的。
const COPY_SUFFIX = '.copy';
// 換檔進行中的旗標。換檔腳本在啟動新版之前建立它，新版啟動時把它刪掉——
// 「新版真的跑起來了」這件事就是靠這個刪除動作回答的，而不是靠「幾秒內沒死掉」。
// 它同時也是「現在不要清暫存檔」的信號：腳本這時手上還握著 .old 當回滾用。
const SWAP_MARK_SUFFIX = '.updating';
// 「可以重開了」的許可檔。主程序決定要關閉自己的時候才寫下它，換檔腳本等到舊程序
// 消失之後第一件事就是檢查它在不在——不在就一步都不走。
// 這是必要的，因為「腳本被建立了」和「主程序決定關閉」是兩件獨立的事：等不到腳本
// 回報活著的時候主程序會留在原地，可是那個腳本可能只是慢，它還在等舊程序消失。
// 使用者照畫面指示自己關掉程式的那一刻，等待就結束了，腳本於是往下走——而這時
// 主程序早就把 .new 改名成交手用的檔名，腳本找不到新版，最後那句 Start-Process
// 啟動的是舊版，還會用單一實例鎖把使用者剛剛打開的新版踢掉。那正是
// 「更新完打開還是舊版」的其中一條路徑。
const SWAP_GO_SUFFIX = '.relaunch';
// 更新過程的純文字紀錄，放在 exe 旁邊（不是 userData）——出問題的時候使用者要找得到它、
// 打得開、寄得出來。程式關掉之後的每一步都只剩這裡看得到。
const SWAP_LOG_FILENAME = '六月幫你顧-更新紀錄.txt';
const SWAP_LOG_MAX_BYTES = 64 * 1024;
// 換檔腳本必須在這段時間內自己寫下第一行，本程序才會關閉。PowerShell 冷啟動慢的機器
// 大約 1～3 秒，給到 8 秒；使用者這時看著「下載完成」，多等幾秒沒有代價。
const WATCHDOG_ALIVE_TIMEOUT_MS = 8000;
const WATCHDOG_POLL_MS = 150;
// 新版啟動後要在多久之內、多密集地去看那個旗標。刻意不是「載完畫面時看一次」：
// 旗標是換檔腳本建立的，而它建立旗標的時間點不保證早於新版把畫面畫出來的時間點。
// 只看一次的話，那種「使用者自己先把新版打開了」的情況沒有任何人會去刪旗標，
// 腳本於是判定新版起不來，把一個好的新版回滾掉——那就是「更新完打開還是舊版」。
// 窗口要比腳本等旗標的時間（120 秒）長一點，否則兩邊會在邊界上互相錯過。
const BOOT_CONFIRM_WINDOW_MS = 150000;
const BOOT_CONFIRM_POLL_MS = 500;
// 新版啟動後多久清掉 .old / .new。旗標被刪掉的那一刻換檔腳本就已經判定成功、
// 不會再回滾，所以那之後備份不再是回滾材料，可以自己清——不必依賴腳本活著。
const SWAP_CLEANUP_DELAY_MS = 15000;
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
 * 兩個路徑指的是不是同一個檔案。用來擋「交手用的檔名剛好就是使用者正在執行的那個
 * 檔案」——那時候先 rm 再 rename 會去動他手上唯一能跑的東西。
 *
 * 不能用 `a !== b` 判斷：Windows 的檔案系統不分大小寫，`...v1.3.1.exe` 和
 * `...V1.3.1.EXE` 是同一個檔案，但字串不相等。tag 從 GitHub 來，大小寫不在我們
 * 手上。resolve 先把分隔符與相對片段正規化，再一起降成小寫比。
 * 這是保守方向的比較：寧可多判成「同一個」而放棄改名（結果是照原樣提示使用者），
 * 也不要少判而去刪掉他正在跑的檔案。
 */
function samePath(a, b) {
  if (!a || !b) return false;
  try {
    return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
  } catch {
    return String(a).toLowerCase() === String(b).toLowerCase();
  }
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

/** 更新紀錄檔的位置：跟 exe 同一個資料夾。 */
function swapLogPath() {
  const dir = exeDir();
  return dir ? path.join(dir, SWAP_LOG_FILENAME) : '';
}

/** 紀錄檔不能無限長。超過上限就砍掉前半段，並且從下一個換行開始留，不留半行。 */
function trimSwapLog(file) {
  try {
    if (fs.statSync(file).size <= SWAP_LOG_MAX_BYTES) return;
    const buf = fs.readFileSync(file);
    const keep = buf.subarray(buf.length - Math.floor(SWAP_LOG_MAX_BYTES / 2));
    const cut = keep.indexOf(0x0a);
    fs.writeFileSync(file, cut >= 0 ? keep.subarray(cut + 1) : keep);
  } catch {}
}

/** 本地時間的時間戳。刻意不用 toISOString()：那是 UTC，而換檔腳本那邊寫進同一個檔案的
 *  是本地時間，同一份紀錄裡混兩種時區只會讓人看不懂事件的先後。 */
function logStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * 寫一行紀錄。回傳紀錄檔路徑，寫不進去（資料夾唯讀）就回空字串——更新本身不會因為
 * 寫不了紀錄而失敗。
 * 開頭補 BOM、換行用 CRLF，都是為了「使用者用記事本打開它」這個唯一的使用情境。
 * 換檔腳本用 Add-Content -Encoding UTF8 接著往下寫，接得起來。
 */
function appendSwapLog(line) {
  const file = swapLogPath();
  if (!file) return '';
  try {
    let head = '';
    if (!fs.existsSync(file)) head = '﻿';
    else trimSwapLog(file);
    fs.appendFileSync(file, `${head}${logStamp()}  ${line}\r\n`, 'utf8');
    return file;
  } catch {
    return '';
  }
}

function appliedPath() {
  try {
    return path.join(app.getPath('userData'), APPLIED_FILENAME);
  } catch {
    return '';
  }
}

/**
 * 上一次真的送出去換檔的 tag，以及同一個 tag 送出去過幾次。
 *
 * 為什麼要記次數：光有 tag 的話，「這個版本已經試過了」就會變成一次定終身。而
 * 「試過了但版號沒動」有兩種完全不同的成因——發布時 tag 與 exe 內建版號不一致
 * （再試一百次都一樣），或是那一次換檔被防毒／檔案鎖擋掉（換個時間就成了）。
 * 前者要閉嘴，後者該再試一次。分不出來就折衷：同一個 tag 給兩次機會。
 */
function readApplied() {
  const file = appliedPath();
  if (!file) return { tag: '', attempts: 0 };
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      tag: String((data && data.tag) || ''),
      attempts: Number((data && data.attempts) || 0) || 0,
    };
  } catch {
    return { tag: '', attempts: 0 };
  }
}

/** 只給版號比較用的舊介面。 */
function readAppliedTag() {
  return readApplied().tag;
}

function writeAppliedTag(tag) {
  const file = appliedPath();
  if (!file) return;
  const next = String(tag || '');
  const prev = readApplied();
  const attempts = prev.tag === next ? prev.attempts + 1 : 1;
  try {
    fs.writeFileSync(file, JSON.stringify({ tag: next, attempts, at: Date.now() }), 'utf8');
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
  const removed = [];
  if (!exe) return removed;
  if (fs.existsSync(exe + SWAP_MARK_SUFFIX)) return removed;
  // .relaunch 也在這裡清掉：它只在「這一輪主程序決定關閉」的那幾百毫秒內有意義，
  // 留到下一輪就變成一張過期的許可證，會讓下一次的換檔腳本以為可以動手。
  for (const file of [
    exe + NEW_SUFFIX + PART_SUFFIX,
    exe + NEW_SUFFIX,
    exe + OLD_SUFFIX,
    exe + COPY_SUFFIX,
    exe + SWAP_GO_SUFFIX,
  ]) {
    try {
      if (!fs.existsSync(file)) continue;
      fs.rmSync(file, { force: true });
      if (!fs.existsSync(file)) removed.push(path.basename(file));
    } catch {}
  }
  // 只有真的清掉東西才寫紀錄，普通啟動不留痕跡。
  if (removed.length) appendSwapLog(`已清掉更新暫存檔：${removed.join('、')}`);
  return removed;
}

/**
 * 換檔握手的另一半：刪掉 .updating，告訴換檔腳本「新版真的活起來了」。
 *
 * 呼叫點刻意放在主視窗的畫面載入完成，而不是 app.whenReady()。要回答的問題是
 * 「使用者拿到一個能用的程式了嗎」，而 whenReady 只證明 Electron 的主程序起來了；
 * 畫面載完才代表 Chromium、asar 裡的前端、preload 這一整條都沒問題。
 *
 * 刪掉旗標之後隔一段時間才自己清 .new / .old：刪旗標的那一刻，換檔腳本就已經看到
 * 成功、不會再走回滾那條路，備份於是不再是回滾材料。以前這件事完全交給腳本做，
 * 腳本被防毒擋掉就會留下一個 90 MB 的 .old 躺到下一次開機——那正是「舊版沒被刪掉」
 * 這個症狀。現在腳本活著就它刪，腳本死了就這裡刪，兩邊都失手才留到下次開機。
 *
 * 這個動作是換檔協定的一半，未來版本不能拿掉，否則舊版的換檔腳本會以為新版沒起來
 * 而把它回滾掉。
 *
 * 為什麼要持續看而不是載完畫面時看一次：旗標是換檔腳本建立的，而「腳本建立旗標」
 * 和「新版把畫面畫出來」之間沒有先後保證。最具體的一條路是——使用者在舊程序關掉
 * 之後、腳本啟動新版之前，自己搶先雙擊打開了程式。他那一份先拿到單一實例鎖，畫面
 * 早在旗標出現之前就載完了；腳本啟動的第二份被鎖擋掉、立刻 exit 0；於是旗標留在
 * 那裡沒有人刪，腳本等滿之後判定「新版起不來」，把使用者正在用的新版回滾成舊版。
 * 只要任何一個實例在窗口內看到旗標就把它刪掉，這條路就消失了。
 */
function confirmBootForSwap() {
  const exe = currentExe();
  if (!exe) return;
  const mark = exe + SWAP_MARK_SUFFIX;
  const consume = () => {
    let there = false;
    try {
      there = fs.existsSync(mark);
    } catch {}
    if (!there) return false;
    try {
      fs.rmSync(mark, { force: true });
    } catch {}
    appendSwapLog(`新版 v${app.getVersion()} 已經啟動並載入畫面，更新成功`);
    setTimeout(() => {
      cleanupLeftovers();
    }, SWAP_CLEANUP_DELAY_MS).unref?.();
    return true;
  };
  if (consume()) return;
  // 旗標還沒出現。它可能永遠不會出現（這只是一次普通的啟動），也可能晚幾秒才出現
  // （腳本還在等舊程序結束）。兩種都要顧到，所以在窗口內持續看。
  let left = Math.ceil(BOOT_CONFIRM_WINDOW_MS / BOOT_CONFIRM_POLL_MS);
  const timer = setInterval(() => {
    if (consume()) {
      clearInterval(timer);
      return;
    }
    if (--left > 0) return;
    clearInterval(timer);
    // 整個窗口都沒有旗標。若這其實是一次換檔（腳本連旗標都建不出來時就會這樣），
    // 那麼 .old / .new 到現在都沒有人清——腳本刪不掉就會留一份 90 MB 躺到下一次
    // 開機，而那正是「舊的執行檔沒有被移除」。這裡補一次；普通啟動時它什麼都不做。
    cleanupLeftovers();
  }, BOOT_CONFIRM_POLL_MS);
  timer.unref?.();
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
    const applied = readApplied();
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
      // 這個 tag 已經送出去換檔兩次、版號還是沒進步 → 不要再自動提示，免得無限重下。
      // 只試過一次就閉嘴是錯的：那一次可能只是被防毒或檔案鎖擋掉，而使用者會因此
      // 永遠收不到這個版本的提示，停在舊版還以為自己是最新的。
      staleRetry: hasUpdate && applied.tag === tag && applied.attempts >= 2,
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
 * 寫下「可以重開了」的許可檔，回傳它是否真的在磁碟上。
 *
 * 為什麼是許可（正向）而不是中止（反向）：兩種寫法都表達得出意圖，但寫失敗的後果
 * 天差地遠。反向寫法一旦「該中止卻沒寫成」，腳本就照原計畫啟動它以為的新版，
 * 而那時原路徑上可能是舊版——使用者按了更新、關掉程式、打開交手用的新版，
 * 卻看到舊版。正向寫法「該許可卻沒寫成」的後果只是「要自己再打開一次」，
 * 而檔名早就換好了，打開就是新版。所以失敗方向必須落在正向這一邊。
 *
 * 也因此有一條硬規則：只有這個函式回傳 true，才可以呼叫 app.quit()。
 */
function writeSwapGo(target) {
  const file = target + SWAP_GO_SUFFIX;
  try {
    fs.writeFileSync(file, 'go', 'utf8');
    return fs.existsSync(file);
  } catch {
    return false;
  }
}

/** 每一輪開始前先撕掉上一輪的許可證，過期的許可證比沒有許可證危險。 */
function clearSwapGo(target) {
  try {
    fs.rmSync(target + SWAP_GO_SUFFIX, { force: true });
  } catch {}
}

/**
 * 換檔腳本。它只負責「本程序結束之後」的事：啟動新版、確認起得來、刪備份，
 * 必要時回滾。換檔本身已經在 swapInProcess() 做完了（preSwapped 為 true 時），
 * 這裡的換檔分支只是備援——留著是因為 Windows 偶爾真的會拒絕改名（防毒正在掃那個
 * 90 MB 的檔案），那時候至少還有人會在程式結束後再試一次。
 *
 * 用 -Command 傳一段看得懂的腳本，而不是 -EncodedCommand（UTF-16LE base64）：
 * base64 的命令列是防毒／EDR 最典型的攔阻對象，而「powershell 被靜靜地砍掉」正是
 * 這整個機制唯一一種無聲的失敗。命令列本身是 Unicode（CreateProcessW），所以中文
 * 路徑直接放進去沒有問題——當初避開 .bat 是因為 cmd 讀檔案用 OEM 編碼，那是檔案的
 * 問題，不是命令列的問題。腳本裡因此一律不出現雙引號，避免多一層轉義。
 *
 * ErrorActionPreference 設成 Stop 而不是 SilentlyContinue：這個腳本每一步都會失敗，
 * 而失敗必須被看見、被處理，不能被吞掉繼續往下走（舊版就是這樣才會在新版沒啟動的
 * 情況下把舊檔刪掉）。
 */
function swapScript({ target, staged, expectedSize, preSwapped, logFile }) {
  const dir = path.dirname(target);
  return [
    "$ErrorActionPreference = 'Stop'",
    `$target = ${psQuote(target)}`,
    `$staged = ${psQuote(staged)}`,
    `$backup = ${psQuote(target + OLD_SUFFIX)}`,
    `$dir = ${psQuote(dir)}`,
    `$size = ${Number(expectedSize) || 0}`,
    // 換檔旗標。步驟 3 建立它，新版啟動時自己刪掉；它消失就是「新版真的跑起來了」。
    `$mark = ${psQuote(target + SWAP_MARK_SUFFIX)}`,
    // 複製的落地點。理由跟 updater.cjs 的 COPY_SUFFIX 一樣：複製不是原子的，
    // 直接複製到 $target 的話，一個被中斷的複製會在使用者天天雙擊的那個檔名底下
    // 留一個半截的 exe，而這個腳本每一個判斷用的都是 Test-Path。
    `$copy = ${psQuote(target + COPY_SUFFIX)}`,
    // 主程序的許可證。沒有它就表示主程序決定自己不關閉、這一輪由它自己收尾，
    // 這個腳本於是只做「把原路徑補回一個能執行的檔案」，其餘一律不動。
    `$go = ${psQuote(target + SWAP_GO_SUFFIX)}`,
    `$log = ${psQuote(logFile || '')}`,
    // 檔名已經在程式內換好了嗎。
    `$pre = $${preSwapped ? 'true' : 'false'}`,
    // $pid 是 PowerShell 的唯讀自動變數（它自己的行程編號），不能拿來存別人的 pid。
    `$oldPid = ${Number(process.pid) || 0}`,
    "function Note($m) { if ($log) { try { Add-Content -LiteralPath $log -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  ' + $m) -Encoding UTF8 } catch {} } }",
    // Fill 是 updater.cjs 裡 fillTarget() 的 PowerShell 版本，兩邊順序刻意一模一樣：
    // 只做一件事——原路徑空著的時候把它補上一個能執行的檔案。先還原舊版（這台機器上
    // 已經證明跑得起來），再退到新版；改名優先於複製（改名不會多留一份 90 MB），
    // 但改名需要對來源檔有 DELETE 權限而複製只要讀得到，所以最後一定要有複製這條路。
    // 回傳 'old' / 'new' 表示補上去的是哪一個，'' 表示原路徑本來就有東西（或救不回來）。
    // 複製那兩條路徑一律「先落到 $copy、比對長度、再改名頂上」：Copy-Item 被中斷
    // （斷電、磁碟滿、來源被防毒抽走）會留下半截檔案，而它一樣通得過 Test-Path，
    // 於是「原路徑上有一個能執行的檔案」這個不變式會從內部被掏空。Move 是原子的。
    'function CopyIn($src) {',
    '  try {',
    '    $want = (Get-Item -LiteralPath $src).Length',
    '    if ($want -le 0) { return $false }',
    '    Remove-Item -LiteralPath $copy -Force -ErrorAction SilentlyContinue',
    '    Copy-Item -LiteralPath $src -Destination $copy -Force',
    "    if ((Get-Item -LiteralPath $copy).Length -ne $want) { throw 'copy truncated' }",
    '    Move-Item -LiteralPath $copy -Destination $target -Force',
    '    return $true',
    '  } catch {',
    '    Remove-Item -LiteralPath $copy -Force -ErrorAction SilentlyContinue',
    '    return $false',
    '  }',
    '}',
    'function Fill {',
    "  if (Test-Path -LiteralPath $target) { return '' }",
    '  if (Test-Path -LiteralPath $backup) { try { Move-Item -LiteralPath $backup -Destination $target -Force } catch {} }',
    "  if (Test-Path -LiteralPath $target) { return 'old' }",
    '  if (Test-Path -LiteralPath $staged) { try { Move-Item -LiteralPath $staged -Destination $target -Force } catch {} }',
    "  if (Test-Path -LiteralPath $target) { return 'new' }",
    '  if (Test-Path -LiteralPath $staged) { $null = CopyIn $staged }',
    "  if (Test-Path -LiteralPath $target) { return 'new' }",
    '  if (Test-Path -LiteralPath $backup) { $null = CopyIn $backup }',
    "  if (Test-Path -LiteralPath $target) { return 'old' }",
    "  return ''",
    '}',
    // 這一行同時是「我還活著」的回報：本程序在關閉之前會等紀錄檔長出這一行。
    "Note '換檔腳本已啟動'",
    '',
    '# 1. 等舊程序真的結束。免安裝版的外層 launcher 會抱著 exe 不放，沒等到就啟動新版',
    '#    只會被單一實例鎖踢掉。等不到（app.quit 被卡住）就退而求其次：只換檔名、',
    '#    不啟動也不刪東西，使用者下一次自己打開就是新版。',
    'for ($i = 0; $i -lt 240; $i++) {',
    '  if (-not (Get-Process -Id $oldPid -ErrorAction SilentlyContinue)) { break }',
    '  Start-Sleep -Milliseconds 500',
    '}',
    'if (Get-Process -Id $oldPid -ErrorAction SilentlyContinue) {',
    "  Note '舊程式 120 秒內沒有結束'",
    '  # 但是「等不到它結束」不等於「什麼都做不了」：Windows 只禁止刪除正在執行的映像，',
    '  # 改名是准的。所以這裡照樣把檔名換好，使用者下一次打開那個檔名就是新版。',
    '  # 這裡刻意不啟動新版——舊的還在跑，單一實例鎖會立刻把新的踢掉，那正是舊版',
    '  # 「按了更新、什麼都沒發生」的成因之一；也不刪備份——映像還被對映著，刪不掉，',
    '  # 留給下一次開機的清理程式。',
    "  if ((Fill) -ne '') { Note '原路徑本來是空的，已經補回一個能執行的檔案' }",
    '  # 主程序還在跑，而它沒有留下許可證，表示它決定自己收尾（它可能已經把新版改名',
    '  # 成交手用的檔名了）。這時候動 $staged 只會跟它搶同一個檔案，所以到此為止。',
    '  if (-not (Test-Path -LiteralPath $go)) {',
    "    Note '主程式沒有留下重開許可，這一輪交還給它，腳本不再動任何檔案'",
    '    exit 1',
    '  }',
    '  if ($pre) {',
    "    Note '檔名早就在程式內換好了，使用者下次打開就是新版'",
    '  } elseif ((Test-Path -LiteralPath $target) -and (Test-Path -LiteralPath $staged)) {',
    '    if (($size -le 0) -or ((Get-Item -LiteralPath $staged).Length -eq $size)) {',
    '      try {',
    '        Move-Item -LiteralPath $target -Destination $backup -Force',
    '        Move-Item -LiteralPath $staged -Destination $target -Force',
    "        Note '已經把檔名換好，使用者下次打開就是新版'",
    '      } catch {',
    '        $null = Fill',
    "        Note '檔名也換不了，這次更新沒有生效'",
    '      }',
    '    }',
    '  }',
    '  exit 1',
    '}',
    "Note '舊程式已結束'",
    'Start-Sleep -Milliseconds 800',
    '',
    '# 2. 先把不變式修回來：原路徑上一定要有一個能執行的檔案。正常情況這裡什麼都不做，',
    '#    只有「程式內換檔換到一半、連還原都失敗」這種極端狀況才會走到。',
    '$filled = Fill',
    "if ($filled -eq 'new') {",
    "  Note '原路徑是空的，已經把新版搬上原位'",
    '  $pre = $true',
    "} elseif ($filled -eq 'old') {",
    "  Note '原路徑是空的，已經把更新前的版本搬回原位'",
    '}',
    '',
    '# 2.5 沒有許可證就到此為止。主程序沒關閉自己卻走到這裡，只可能是使用者照著畫面的',
    '#     指示自己把程式關掉了——那時候新版早就被主程序改名成交手用的檔名，這裡再往下',
    '#     走，最後那句 Start-Process 啟動的會是舊版，而且會用單一實例鎖把使用者剛剛',
    '#     打開的新版踢掉。上面那個 Fill 仍然要先做：原路徑空著的時候本程序是最後一道',
    '#     防線，而補檔案這件事在任何情況下都是對的。',
    '#     許可證看完就撕掉，它只對這一輪有效。',
    'if (-not (Test-Path -LiteralPath $go)) {',
    "  Note '主程式沒有留下重開許可（它決定自己收尾），腳本確認過原路徑有檔案就結束'",
    '  exit 1',
    '}',
    'Remove-Item -LiteralPath $go -Force -ErrorAction SilentlyContinue',
    '',
    '# 3. 備援換檔。$pre 為真表示換檔已經在程式內做完了，這裡一個檔案都不動——那是正常路徑。',
    '#    真的要換的話，新檔要還在、大小要對才動手（防毒把下載回來的檔案吃掉時就停在這裡）。',
    '#    這裡跟步驟 1 不同：舊程序已經結束了，使用者的程式剛剛在他眼前關掉，',
    '#    什麼都不做就等於「按了更新，程式消失了」，所以每一條失敗路徑都要重新啟動原檔。',
    '$swapped = $pre',
    'if (-not $swapped) {',
    '  if (-not (Test-Path -LiteralPath $staged)) {',
    "    Note '找不到新版檔案（可能被防毒移除），改回啟動原本的版本'",
    '    try { Start-Process -FilePath $target -WorkingDirectory $dir } catch {}',
    '    exit 1',
    '  }',
    '  if ($size -gt 0 -and (Get-Item -LiteralPath $staged).Length -ne $size) {',
    "    Note '新版檔案大小不對（可能被防毒動過），已丟棄，改回啟動原本的版本'",
    '    # 丟棄之前一定要先確認原路徑上有東西。原路徑空著的時候，這個大小不對的檔案',
    '    # 就是現場唯一還剩下的材料，刪掉它等於把使用者的程式刪掉。',
    '    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $staged -Force -ErrorAction SilentlyContinue }',
    '    try { Start-Process -FilePath $target -WorkingDirectory $dir } catch {}',
    '    exit 1',
    '  }',
    '  # 檔案鎖可能還沒放掉（防毒正在掃那個 90 MB 的新檔），所以要重試。',
    '  # 重試迴圈唯一要守住的不變式是：每一圈開始時 $target 一定在原地，$backup 是可丟的。',
    '  # 舊版沒守住這件事——第一圈如果「舊檔已改名、新檔還沒頂上」就失敗，',
    '  # 第二圈的 Remove-Item 會把唯一的舊 exe 刪掉，之後原路徑就永遠是空的。',
    '  for ($i = 0; $i -lt 20; $i++) {',
    '    try {',
    '      # 刪備份只是為了讓 Move 有位置放，所以原檔不在的時候絕對不能刪——那一刪',
    '      # 就等於把唯一一個能執行的檔案毀掉，而接下來那個 Move 本來也一定會失敗。',
    '      if ((Test-Path -LiteralPath $target) -and (Test-Path -LiteralPath $backup)) { Remove-Item -LiteralPath $backup -Force }',
    '      Move-Item -LiteralPath $target -Destination $backup -Force',
    '      Move-Item -LiteralPath $staged -Destination $target -Force',
    '      $swapped = $true',
    '      break',
    '    } catch {',
    '      # 失敗就先把不變式修回來，再睡一下重試。修的時候如果只剩新檔可用，',
    '      # 那就讓新檔頂上（Fill 會回 new），換檔等於已經完成。',
    "      if ((Fill) -eq 'new') { $swapped = $true; break }",
    '      Start-Sleep -Milliseconds 700',
    '    }',
    '  }',
    "  if ((-not $swapped) -and ((Fill) -eq 'new')) { $swapped = $true }",
    '  if (-not $swapped) {',
    "    Note '換檔失敗（檔案可能還被鎖住），改回啟動原本的版本'",
    '    try { Start-Process -FilePath $target -WorkingDirectory $dir } catch {}',
    '    exit 1',
    '  }',
    "  Note '換檔在腳本裡完成'",
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
    // 失敗原因要記下來再寫進紀錄檔。三種成因（新版自己結束、原路徑空了、啟動時丟例外）
    // 的處理一樣，但事後要判斷「那次到底怎麼了」只剩紀錄檔可看，寫錯比不寫更糟。
    "$reason = ''",
    'try {',
    '  $p = Start-Process -FilePath $target -WorkingDirectory $dir -PassThru',
    '  $havePid = ($p -ne $null)',
    "  Note '已經啟動新版，等它回報畫面載好了'",
    '  # 有旗標可用就等最多 120 秒（冷開機＋解壓縮 190 MB＋防毒掃描是真的會慢）；',
    '  # 沒有旗標就退回舊的判定，時間也維持原本的 6 秒。',
    '  $rounds = 240',
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
    '      # exit 0 而旗標還在：這個行程結束了，但它幾乎一定不是那個新版本身——免安裝版',
    '      # 啟動的是外層 launcher，它解壓完就把棒子交給暫存目錄裡的內層 exe；使用者也',
    '      # 可能自己先把新版打開了（他那一份拿著單一實例鎖，這裡啟動的第二份於是立刻',
    '      # exit 0）。兩種情況新版都是好的，所以絕對不能因為「它結束了」就縮短等待：',
    '      # 舊的寫法在這裡只再等 12 秒就回滾，那正好把一個好的新版靜靜地降回舊版，',
    '      # 使用者看到的就是「更新完打開還是舊版」。改成不再問這個行程、一路等旗標。',
    '      $havePid = $false',
    '    }',
    '  }',
    "  if (-not $booted -and $exited) { $failed = $true; $reason = '新版啟動後自己結束了，沒有回報畫面載入完成' }",
    "  if (-not (Test-Path -LiteralPath $target)) { $failed = $true; $reason = '原路徑上的檔案不見了' }",
    "} catch { $failed = $true; $reason = '啟動新版的時候出錯了' }",
    '',
    '# 5. 失敗就回滾。這是整段腳本存在的理由：絕對不能讓使用者落到',
    '#    「新的跑不起來、舊的也不見了」。',
    '#    舊版把三個動作寫在同一個 try 裡，所以只要備份已經被刪掉（新版開機的清理程式',
    '#    就會做這件事），第二個 Move 會丟例外，而第一個 Move 早就把新檔從原檔名搬走了',
    '#    ——原路徑於是變成空的。現在每一步各自 try，最後再強制檢查原檔名有沒有東西。',
    'if ($failed) {',
    "  Note ('新版沒有回報啟動成功（' + $reason + '），開始還原更新前的版本')",
    '  $restored = $false',
    '  if (Test-Path -LiteralPath $backup) {',
    '    try {',
    '      if (Test-Path -LiteralPath $target) {',
    '        Remove-Item -LiteralPath $staged -Force -ErrorAction SilentlyContinue',
    '        Move-Item -LiteralPath $target -Destination $staged -Force',
    '      }',
    '    } catch {}',
    '    try { Move-Item -LiteralPath $backup -Destination $target -Force; $restored = $true } catch {}',
    '  }',
    '  # 回滾成不成功是次要的，原檔名有一個能執行的東西才是必要的。備份優先，其次是新檔。',
    '  $null = Fill',
    '  Remove-Item -LiteralPath $mark -Force -ErrorAction SilentlyContinue',
    '  $back = $false',
    '  try { if (Test-Path -LiteralPath $target) { Start-Process -FilePath $target -WorkingDirectory $dir; $back = $true } } catch {}',
    "  if ($back -and $restored) { Note '已經把原路徑還原成更新前的版本並重新啟動它' } elseif ($back) { Note '沒有備份可以還原，原路徑上是剛剛下載的版本，已經重新啟動它' } else { Note '原路徑上沒有可以執行的檔案，請自己打開資料夾執行剩下的那一個' }",
    '  exit 1',
    '}',
    '',
    '# 6. 確定成功了才刪備份。旗標正常情況下已經被新版刪掉，這裡收尾以防它留著',
    '#    （留著會讓下一次開機的清理程式以為又有換檔在進行中）。',
    '#    刪備份要等：免安裝版的外層 launcher 結束時要把 190 MB 的解壓縮目錄整個砍掉，',
    '#    在那之前舊 exe 的映像還被對映著，Windows 不讓刪。20 秒是留給它的餘裕；',
    '#    真的還刪不掉也沒關係——新版啟動 15 秒後會自己再清一次（confirmBootForSwap）。',
    'Remove-Item -LiteralPath $mark -Force -ErrorAction SilentlyContinue',
    'for ($i = 0; $i -lt 20; $i++) {',
    '  Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue',
    '  if (-not (Test-Path -LiteralPath $backup)) { break }',
    '  Start-Sleep -Milliseconds 1000',
    '}',
    '# 紀錄要照實寫。走到這裡有兩種情況：旗標被刪掉了（新版親口回報畫面載好了，',
    '# 這才是真的「更新完成」），或者等滿了而新版還在執行、只是沒回報——那當成成功是',
    '# 刻意的（不跟一個正在跑的程式搶它的檔案），但不是同一件事。事後要判斷「那次到底',
    '# 成不成」只剩這份紀錄可看，把兩者寫成同一句話等於把唯一的線索丟掉。',
    '$done = $null',
    "if ($booted) { $done = '更新完成' } else { $done = '新版還在執行，但沒有回報畫面載入完成（當成成功處理，沒有回滾）' }",
    'if (Test-Path -LiteralPath $backup) {',
    "  Note ($done + '；舊版檔案還被鎖住刪不掉，交給新版稍後再清')",
    '} else {',
    "  Note ($done + '；舊版檔案已經刪掉')",
    '}',
  ].join('\n');
}

/**
 * 在本程序還活著的時候就把檔名換掉。這是這次修復的核心。
 *
 * Windows 不准刪掉一個正在執行的映像，但是准改它的名字（載入映像時是以
 * FILE_SHARE_DELETE 開檔的，改名又只是同一個磁碟區內的中繼資料操作）。
 * 既然改名不必等程式結束，換檔就不必依賴任何一個外部程序照計畫執行——
 * 這一步做完，使用者平常按的那個檔名底下就已經是驗證過的新版。後面那個
 * PowerShell 不管被防毒擋掉、被 EDR 砍掉還是根本沒被執行，最壞的情況也只是
 * 「要自己關掉再打開一次」，而不是舊版那種「更新完打開還是舊版、舊檔也還在」。
 *
 * 回傳三種狀態：
 *   'swapped'   原路徑上已經是新版（正常結果）。
 *   'unchanged' 原路徑上還是原本那個能執行的舊版、新版還在 .new，
 *               交給換檔腳本在本程序結束後重試。
 *   'broken'    原路徑上什麼都沒有。這是唯一不能接受的結果，所以要一路退到
 *               「用複製代替改名」、再隔幾百毫秒重試，才會放棄——見 fillTarget()。
 */
function swapInProcess({ target, staged, backup }) {
  // 前提是「原路徑上有一個能執行的舊版」。如果不是——上一輪換檔壞在半路、或者
  // 使用者自己把檔案搬走了——那 backup 很可能是這台機器上唯一還能執行的檔案，
  // 絕對不能先刪掉它。這種情況要做的事只有一件：把原路徑填回來。
  let haveTarget = false;
  try {
    haveTarget = fs.existsSync(target);
  } catch {}
  if (!haveTarget) return fillTarget({ target, staged, backup });
  try {
    fs.rmSync(backup, { force: true });
  } catch {}
  try {
    // 這一步失敗＝防毒／備份軟體正抱著舊 exe 不放，此時什麼都還沒變。
    fs.renameSync(target, backup);
  } catch {
    return 'unchanged';
  }
  try {
    fs.renameSync(staged, target);
    return 'swapped';
  } catch {}
  // 舊檔已經改名、新檔沒頂上：原路徑是空的。接下來唯一的目標是把它填回來。
  return fillTarget({ target, staged, backup });
}

/**
 * 把原路徑填回一個能執行的檔案。只在「原路徑是空的」時候呼叫。
 *
 * 順序是想過的：先還原舊版（那是這台機器上已經證明跑得起來的東西，而且還原之後
 * 換檔腳本會在本程序結束後再試一次，更新照樣會完成），再退到新版。改名優先於複製，
 * 因為改名不會留下第二份 90 MB。改名需要對來源檔有 DELETE 權限，複製只需要讀得到，
 * 所以「防毒抱著檔案不放」這種情況下複製往往還是成立的——90 MB 複製要一兩秒，
 * 但這條路只有在原路徑空著的時候才會走到，那個代價完全值得。
 *
 * 刻意不碰 backup 的殘骸、也不做任何刪除：這個函式被呼叫的時候，backup 可能是
 * 使用者手上唯一一個能執行的檔案。
 *
 * 複製那一段刻意不直接寫 target：copyFileSync 不是原子的，中途斷電、磁碟滿了或
 * 防毒把來源抽走，都會在使用者天天雙擊的那個檔名底下留一個半截的 exe。而這之後
 * 每一個判斷（腳本的 Test-Path、下次開機的清理、fillTarget 自己）看的都只是
 * 「檔案在不在」，於是那個半截檔會一路被當成一個能執行的程式，把「至少還有東西
 * 能跑」這個不變式從內部掏空。所以先複製到 .copy、比對大小、再改名頂上；
 * 改名在同一個磁碟區上是原子的，要嘛完整的檔案在那裡，要嘛原本的狀態沒變。
 */
function fillTarget({ target, staged, backup }) {
  for (const [source, status] of [
    [backup, 'unchanged'],
    [staged, 'swapped'],
  ]) {
    try {
      fs.renameSync(source, target);
      return status;
    } catch {}
  }
  const copy = target + COPY_SUFFIX;
  for (const [source, status] of [
    [staged, 'swapped'],
    [backup, 'unchanged'],
  ]) {
    try {
      const want = fs.statSync(source).size;
      if (want <= 0) continue;
      fs.rmSync(copy, { force: true });
      fs.copyFileSync(source, copy);
      if (fs.statSync(copy).size !== want) throw new Error('copy truncated');
      fs.renameSync(copy, target);
      return status;
    } catch {
      // 半截的複製品留在 .copy 底下沒有任何人會執行它，但還是要收掉：
      // 90 MB 的垃圾會擋住下一輪重試的磁碟空間。
      try {
        fs.rmSync(copy, { force: true });
      } catch {}
    }
  }
  return 'broken';
}

/**
 * 'broken'（原路徑上什麼都沒有）是唯一不能接受的結果，所以不要一次就放棄。
 *
 * 它最可能的成因是一個會自己消失的鎖：防毒正在掃那個剛下載完的 90 MB 檔案、
 * 或備份軟體剛好在讀舊 exe。上面那一整條鏈是連續執行的，前後差幾微秒，
 * 對「幾秒鐘的鎖」來說等於只試了一次。所以隔一段時間重試同一條鏈。
 * 代價只有在已經出事的時候才付得到，最多兩秒。
 */
async function fillTargetWithRetry(paths) {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    const status = fillTarget(paths);
    if (status !== 'broken') return status;
  }
  return 'broken';
}

/**
 * 把換檔腳本丟出去。回傳 Promise：spawn 的失敗（找不到 powershell.exe、被
 * AppLocker 擋掉）是非同步送到 'error' 事件的，舊版沒接，於是畫面收到
 * 「即將重新啟動」、800 毫秒後程式關掉，而根本沒有人會去啟動新版。
 *
 * 注意：這裡 resolve 只代表「行程被建立了」，不代表它會活著做完事——
 * 那要靠 waitForWatchdog() 等它自己回報。
 */
function spawnSwapWatchdog(script) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let child;
    try {
      child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script],
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

/**
 * 等換檔腳本自己回報「我還活著」。
 *
 * 為什麼需要這一步：spawn 成功只證明行程被建立了。防毒把它當成可疑腳本砍掉、
 * 群組原則不讓它跑、或者它一開口就出錯——這些全都發生在 spawn 之後，而舊版
 * 在這些情況下一樣會顯示「即將重新啟動」然後關掉程式，使用者看到的就是
 * 「按了更新，程式關掉，再打開還是舊版」。無聲的失敗是這個機制最糟的性質。
 *
 * 回報方式刻意選最笨的一種：腳本第一件事就是往紀錄檔追加一行，所以檔案變大
 * 就是它活著。用不著 stdout 管線（那要留著 handle，程序一關就斷）、也用不著
 * 另開一個 IPC。回傳 true＝確認活著，可以放心關掉自己。
 */
function waitForWatchdog(logFile, baseSize) {
  return new Promise((resolve) => {
    if (!logFile) {
      resolve(false);
      return;
    }
    const deadline = Date.now() + WATCHDOG_ALIVE_TIMEOUT_MS;
    const poll = () => {
      let size = -1;
      try {
        size = fs.statSync(logFile).size;
      } catch {}
      if (size > baseSize) {
        resolve(true);
        return;
      }
      if (Date.now() >= deadline) {
        resolve(false);
        return;
      }
      setTimeout(poll, WATCHDOG_POLL_MS);
    };
    poll();
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
 * 把 fs／網路的錯誤碼換成使用者自己能處理的句子。只翻譯真的會發生、而且看得懂就
 * 有辦法解決的那幾種；其餘照原文送——亂補一句「請稍後再試」會把唯一的線索藏起來。
 */
function friendlyError(err) {
  const code = String((err && err.code) || '');
  if (code === 'ENOSPC') return '磁碟空間不足，清出大約 200 MB 之後再試一次';
  if (code === 'EACCES' || code === 'EPERM') {
    return '沒有權限寫入程式所在的資料夾（可能是防毒或資料夾保護），請把程式搬到桌面或文件資料夾再試';
  }
  if (code === 'ETIMEDOUT' || code === 'ECONNRESET' || code === 'ECONNABORTED') return '網路中斷了，請再試一次';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return '連不到 GitHub（找不到主機），請檢查網路連線';
  return (err && err.message) || '下載失敗';
}

/**
 * 下載新版 exe 並換檔。刻意不接受任何參數：網址、版號、大小、雜湊值全部由主程序
 * 自己向 GitHub 問。舊版是把 downloadUrl 和 version 從畫面層經 IPC 傳進來，
 * 而這個檔案下載完會被執行、版號會被接進檔名——那是不該存在的信任關係。
 * 先寫成 .part 再改名，中途斷線不會留下一個看起來正常但其實不完整的 exe。
 */
async function downloadUpdate(sender) {
  // 這裡只是便宜的快速失敗；真正上鎖在下面「開始碰檔案」之前，因為鎖要保護的是
  // .part 檔和換檔流程，而不是前面這幾個純查詢。
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
  // 真正上鎖的位置：從這一行開始才會動到磁碟。上面那個查詢階段有兩次網路往返
  // （fetchJson、後面的 httpsGet），舊寫法要等到 createWriteStream 才記下
  // activeDownload，兩次點擊只要落在那段空窗裡就會各自開一個 write stream 寫同一個
  // .part，最後那個檔案是兩份下載交錯的內容。這裡的檢查與賦值之間沒有 await，
  // 單執行緒下就是原子的。
  if (activeDownload) return { ok: false, message: '已經在下載了' };
  activeDownload = { res: null, file: null, cancelled: false };
  // 上一輪如果留下許可證，這一輪的腳本會拿著它去啟動它以為的新版，所以每一輪
  // 開始前先撕掉。真正要用的時候才重新寫一張。
  clearSwapGo(target);
  try {
    fs.rmSync(partial, { force: true });
  } catch {}

  let file = null;
  let res = null;
  try {
    res = await httpsGet(url);
    // 取消可能落在剛才那兩次 await 之間（那時還沒有連線可以中斷），所以連線一拿到
    // 就先看一眼。不看的話使用者按了取消，90 MB 還是會照收。
    if (activeDownload && activeDownload.cancelled) throw new Error(CANCELLED);
    // content-length 可能沒有（chunked），那就退回用 GitHub 給的附件大小當分母。
    const total = Number(res.headers['content-length']) || expectedSize;
    let received = 0;
    let lastSent = 0;
    const hash = crypto.createHash('sha256');
    await new Promise((resolve, reject) => {
      file = fs.createWriteStream(partial);
      // 補上 handle 而不是換一個新物件：鎖是上面那一行拿到的，換掉它就等於把
      // 「已經有人在下載」這件事重置，也會把剛剛設好的 cancelled 旗標弄丟。
      if (activeDownload) {
        activeDownload.res = res;
        activeDownload.file = file;
      }
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

    // 先在這裡就把檔名換好。換得成的話，原路徑上從這一刻起就是新版，
    // 後面不管發生什麼事，使用者關掉再打開就是新版。
    const backup = target + OLD_SUFFIX;
    let status = swapInProcess({ target, staged, backup });
    if (status === 'broken') {
      // 原路徑空著是唯一不能接受的狀態，重試到補回來為止（最多兩秒）。
      appendSwapLog('換檔中途卡住，原路徑上暫時沒有檔案，正在設法補回去');
      status = await fillTargetWithRetry({ target, staged, backup });
    }
    const swapped = status === 'swapped';
    const sizeNote = `${written} 位元組${expectedDigest ? '，雜湊已驗證' : ''}`;
    const logFile = appendSwapLog(
      `已下載 ${tag}（${sizeNote}）。${
        swapped
          ? '檔名已經換好，原路徑上現在就是新版'
          : status === 'unchanged'
            ? '檔名還換不了（舊檔被鎖住），交給換檔腳本重試'
            : '原路徑上補不回檔案，只能請使用者手動處理'
      }`
    );
    let baseSize = 0;
    try {
      if (logFile) baseSize = fs.statSync(logFile).size;
    } catch {}

    let spawnError = null;
    // 動手之前再撕一次許可證。上面那一次在下載開始前，中間隔著可能好幾分鐘的
    // 90 MB 下載；腳本一被啟動就開始輪詢這個檔案，它看到的東西必須是這一輪自己
    // 掛上去的。把這個保證放在「緊接著 spawn 的前一行」，才不用靠一個幾十行前的
    // 呼叫加上一串「中間不可能有人寫它」的推論來成立。代價是一次 rmSync。
    clearSwapGo(target);
    try {
      await spawnSwapWatchdog(
        swapScript({ target, staged, expectedSize: written, preSwapped: swapped, logFile })
      );
    } catch (err) {
      spawnError = err;
    }
    // 只有「確認換檔腳本真的活著」才敢關掉自己。舊版是 spawn 成功就當成功，
    // 於是腳本被防毒砍掉的時候，程式關掉了而沒有任何人接手，
    // 使用者看到的就是「按了更新、程式關掉、再打開還是舊版，舊檔也還在」。
    const alive = spawnError ? false : await waitForWatchdog(logFile, baseSize);
    // 關閉自己之前的最後一個條件：許可證要真的寫進磁碟。腳本靠它分辨
    // 「主程序自己關掉了，該接手」和「主程序還在，使用者只是手動關掉它」。
    // 寫不成就不關——這是刻意的：不關的後果只是「請使用者自己重開一次」，
    // 而在沒有許可證的情況下關掉，腳本會什麼都不做，畫面卻已經說了要重開。
    const permitted = alive && status !== 'broken' ? writeSwapGo(target) : false;
    // 不關程式的分支一律不留許可證。留著它，等使用者自己把程式關掉的那一刻，
    // 那個還在等的腳本就會把它當成「可以動手了」。
    if (!permitted) clearSwapGo(target);
    // 記下這個 tag 已經處理過了。萬一 Release 的 tag 跟 exe 內建版號不一致，
    // 下次開機才不會又提示同一版、又下載 90 MB、又重開一次。
    //
    // status === 'broken' 時刻意不關程式，即使腳本活著：關掉自己唯一的理由是
    // 「讓別人有機會做我做不到的事」，而換檔腳本用的是同樣那幾個檔案操作，
    // 剛剛已經連續失敗六次又重試五輪了。此時關掉只會把畫面上那段「該怎麼救」
    // 的說明一起關掉，而使用者的原路徑上正好沒有東西可以再打開。
    if (permitted) {
      writeAppliedTag(tag);
      appendSwapLog(
        swapped ? '換檔腳本已回報，開始關閉舊版' : '換檔腳本已回報，剩下的換檔交給它，開始關閉舊版'
      );
      // 讓這次 IPC 的回應先送到畫面（顯示「即將重新啟動」），再退出。
      setTimeout(() => app.quit(), 800);
      // swapped 要送回畫面：檔名已經換好的時候「即將啟動新版」是確定的，
      // 還沒換好的時候只能說「交給更新程式接手」——換檔還可能失敗，
      // 那時腳本會啟動原本那個版本，畫面不該先把話講滿。
      return { ok: true, restarting: true, swapped, verified: Boolean(expectedDigest) };
    }

    // 以下都是「不會自動重開」的分支。共同的鐵則：不要關掉程式。
    // 關掉之後沒有人會接手，使用者看到的就是「按了更新，程式消失」——那正是舊版的病。
    if (status === 'broken') {
      // 極端狀況：改名和複製都被擋掉、隔幾百毫秒重試五輪也補不回來。
      // 唯一還值得試一次的動作是把新版改成另一個檔名：剛剛失敗的每一步目標檔名
      // 都是原本那個 exe，而資料夾保護與防毒的規則常常是綁在特定檔名上的，
      // 換一個目的地是真的有機會成功。成功的話使用者就有一個能雙擊的檔案。
      let handedBroken = '';
      const rescue = path.join(dir, localExeName(tag));
      if (!samePath(rescue, target)) {
        try {
          fs.rmSync(rescue, { force: true });
          fs.renameSync(staged, rescue);
          handedBroken = rescue;
        } catch {}
      }
      // 剩下的只能把現場說清楚，而且要照著真的還在的檔案講——
      // 叫使用者去執行一個不存在的檔案（或一個 .new，Windows 不會執行它）比不講更糟。
      let haveBackup = false;
      let haveStaged = false;
      try {
        haveBackup = fs.existsSync(backup);
      } catch {}
      try {
        haveStaged = fs.existsSync(staged);
      } catch {}
      appendSwapLog(
        `原路徑上補不回檔案（備份${haveBackup ? '還在' : '不見了'}、新版${
          handedBroken ? `已改名成 ${path.basename(handedBroken)}` : haveStaged ? '還在 .new' : '不見了'
        }），已請使用者手動處理`
      );
      // 每一條路徑都要先講「關掉這個程式」。程式有單一實例鎖：這個舊版還開著的時候
      // 雙擊新版，新版會立刻退場並把舊視窗叫到前面，使用者看到的是「照做了卻沒變」，
      // 於是把一個其實完好的檔案當成壞的。這裡不能自己關（關了就沒人接手了），
      // 所以只能把順序寫進話裡。
      const how = handedBroken
        ? `請關掉這個程式，再到「${dir}」直接執行「${path.basename(handedBroken)}」，那是已經驗證過的新版` +
          (haveBackup ? `；想回到更新前的狀態就把「${path.basename(backup)}」改名回「${path.basename(target)}」。` : '。')
        : haveBackup
          ? `請關掉這個程式，再到「${dir}」把「${path.basename(backup)}」改名回「${path.basename(target)}」` +
            (haveStaged ? `，或者把「${path.basename(staged)}」改名成同一個檔名（那是已經驗證過的新版）。` : '。')
          : haveStaged
            ? `請關掉這個程式，再到「${dir}」把「${path.basename(staged)}」改名成「${path.basename(target)}」，那是已經驗證過的新版。`
            : '請從下載頁面重新下載一份。';
      return {
        ok: false,
        message: `系統不讓我改動執行檔（可能是防毒或資料夾保護），你平常按的那個檔案暫時不在原位。${how}`,
      };
    }
    const why = spawnError
      ? `無法啟動換檔程式（${spawnError.message || 'powershell.exe'}）`
      : alive
        ? '沒辦法在程式的資料夾裡寫入重開許可檔'
        : '換檔程式沒有回應（可能被防毒擋掉）';
    if (swapped) {
      // 檔名已經換好，所以這仍然是一次成功的更新，差別只在不能自動重開。
      writeAppliedTag(tag);
      appendSwapLog(`${why}，但檔名已經換好了，改請使用者自己重開`);
      return {
        ok: true,
        restarting: false,
        verified: Boolean(expectedDigest),
        message:
          '新版已經換好了，但沒辦法自動幫你重新開啟（可能被防毒或系統原則擋掉）。' +
          '請關掉這個程式，再打開你平常用的那個檔案，那就是新版了。',
      };
    }
    // 檔名沒換成、腳本也不可靠：把新版改成一個可以直接雙擊的檔名交給使用者，
    // 而不是回一句「更新失敗」然後留一個 .new 在旁邊。
    const manual = path.join(dir, localExeName(tag));
    let handed = '';
    // manual 撞上 target 的情形是真的會發生的：使用者本來就用官方檔名跑
    // （六月幫你顧_免安裝綠色版_v1.3.1.exe），而 tag 又剛好等於那個版號。
    // 那時候這兩行會先刪掉他正在執行的那個檔案的路徑、再把新版改名頂上去——
    // 前者在 Windows 上會失敗，但不該靠「剛好失敗」來保證安全。
    if (!samePath(manual, target)) {
      try {
        fs.rmSync(manual, { force: true });
        fs.renameSync(staged, manual);
        handed = manual;
      } catch {}
    }
    // 走到這裡 status 一定是 'unchanged'，也就是原路徑上是那個能執行的舊版，
    // 所以 .old 只可能是上一輪留下的垃圾或是舊版的複本——留著它沒有任何用途，
    // 而使用者接下來按的是另一個檔名（交手用的 exe），它的清理程式看的是自己那組
    // 檔名，永遠不會來清這一個。現在不刪就等於永久留一份 90 MB。
    // 刪之前還是要親眼確認原路徑上有東西：這個判斷背後是「不變式一定成立」的推論，
    // 而備份可能是使用者手上唯一能執行的檔案，推論錯的代價太大。
    try {
      if (fs.existsSync(target)) fs.rmSync(backup, { force: true });
    } catch {}
    let stagedLeft = false;
    try {
      stagedLeft = fs.existsSync(staged);
    } catch {}
    appendSwapLog(
      `${why}，檔名也換不了。${
        handed ? `新版放在 ${path.basename(handed)}` : stagedLeft ? '新版還在 .new，已請使用者自己改名' : '新版不見了'
      }`
    );
    return {
      ok: false,
      message: handed
        ? `${why}。新版已經下載好放在：${handed}，請關掉這個程式後直接執行它。`
        : stagedLeft
          ? `${why}。新版已經下載好放在「${staged}」，請關掉這個程式後把檔名結尾的「.new」去掉，再打開它。`
          : `${why}，請改用手動下載。`,
    };
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
      message: cancelled ? '已取消下載' : friendlyError(err),
    };
  }
}

/**
 * 取消。先把連線斷掉再關檔案 handle，順序不能反：Windows 上檔案還開著就刪不掉，
 * 而連線沒斷的話 pipe 會繼續往一個正在關的 stream 寫。
 *
 * 這裡刻意不把 activeDownload 設成 null——那把鎖由下載流程自己在結束時放掉。
 * 如果取消時就把它清掉，而取消又發生在「已經上鎖、但連線還沒建立」的查詢階段
 * （按下更新到連上 GitHub 之間），下載流程醒來後會看不到自己的鎖，也就看不到
 * cancelled 旗標，於是照樣把 90 MB 收完、照樣換檔、照樣重開——使用者按了取消，
 * 程式卻自己更新完重開了。所以取消只做兩件事：立旗標、拆掉現有的 handle。
 * 換檔階段（鎖已經放掉）呼叫這個函式會回 false，那也是對的：檔名都換好了，
 * 這時候沒有「取消」可言。
 */
async function cancelDownload() {
  const current = activeDownload;
  if (!current) return false;
  current.cancelled = true;
  try {
    if (current.res) current.res.destroy(new Error(CANCELLED));
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
  // 更新紀錄。換檔的後半段發生在程式關掉之後，畫面層再也收不到任何東西，
  // 所以那段過程只存在這個純文字檔裡。開它不需要參數：路徑由主程序自己算，
  // 畫面層沒有機會指定要開哪個檔案。
  ipcMain.handle('open-update-log', async () => {
    const file = swapLogPath();
    if (!file) return false;
    try {
      if (!fs.existsSync(file)) return false;
      const err = await shell.openPath(file);
      return !err;
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
  // 匯出給測試用：換檔腳本的文字內容要能被檢查（不能有雙引號、括號要成對），
  // 換檔本身也要能在假的檔案系統上跑一遍。
  swapScript,
  swapInProcess,
  fillTarget,
  // 匯出給測試用：許可證的檔名後綴要能在模擬裡對得上。
  SWAP_GO_SUFFIX,
};
