// 檢查更新 / 一鍵更新。免安裝綠色版沒有安裝器，所以流程是：讀 GitHub 最新 Release
// → 比版號 → 直接下載成一個「雙擊就能跑」的正式檔名 → 驗 sha256 → 在它旁邊放一張
// 交接紙條 → 啟動它、等它回報自己活著 → 舊版才關閉自己 → 換檔的最後一哩（刪掉舊
// 執行檔、把新檔搬回使用者平常按的那個檔名）由**新版自己**在開機時完成。
//
// 為什麼是這個形狀，而不是「舊版把事情做完再關掉」：
//   1. 換檔的責任交給新版，因為只有新版能保證自己還活著。舊版能做的每一件事都在
//      它關閉的那一刻中止；任何「我關掉之後還要有人繼續動作」的設計，都把成敗押在
//      一個我們無法保證存活的行程上。2026-09-05 的實地故障就是這樣：下載完成、
//      程式自己關掉、檔名沒換、舊檔沒刪、什麼都沒發生。
//   2. 一個位元組都不碰使用者正在執行的那個 exe。Windows 允許改名正在執行的映像檔，
//      但那要 DELETE 權限——只要有任何一個 handle（防毒掃描、Explorer 縮圖、索引
//      服務）沒帶 FILE_SHARE_DELETE，改名就會被拒絕。舊機制正是踩在這一步上：
//      rename(目前exe → .old) 丟例外，於是整個換檔落到腳本身上，而腳本活不過我們。
//      新版落在一個全新的檔名上，那個檔名不可能被鎖住，所以落地幾乎不可能失敗。
//   3. 下載回來的檔案一定用正式檔名（六月幫你顧_免安裝綠色版_vX.Y.Z.exe），不用 .new。
//      這個檔案在自動流程失敗時就是使用者手上唯一的救援材料，而 Windows 不會執行
//      結尾是 .new 的東西。副檔名對了，最壞情況也只是「請你自己雙擊它」。
//   4. 「新版真的執行了」要正向證據，不是 spawn 成功。行程被建立和它真的執行了第一行
//      是兩件事（防毒砍掉、旗標讓子行程拿不到 console，spawn 都一樣回報成功）。
//      所以新版的第一個動作就是寫下 <新exe>.hello；舊版看到那個檔案才敢關閉自己。
//      看不到就**不要關**——改成把檔名告訴使用者請他自己打開。那句話一定成立，因為
//      檔案已經在那裡、大小和 sha256 都對過了。
//   5. 啟動新版走三段階梯，第一段成功就不走後面：Explorer 代開 → 工作排程器代開 →
//      自己 spawn。前兩段的用意都是「讓那個新行程不是我們的子孫」，這樣我們結束時
//      不會連坐把它帶走；第三段是最後的保險。三段全都沒回報才回頭請使用者自己開。
//   6. 檔名還是會換回原本那一個。捷徑、釘選、開機啟動項都指向那個路徑，永久改名等於
//      每次更新都把它們弄壞。差別只是「什麼時候換」：現在是新版起來、舊版退場之後，
//      由新版把舊檔刪掉、把自己改名頂上去（改名不成才複製，多出來的那一份留給下次
//      開機清）。這一步失敗也沒關係——使用者手上仍然是一個跑得起來的新版。
//   7. 不變式只有一條，但必須永遠成立：任何一步失敗之後，磁碟上都還要有一個能執行的
//      檔案，而且它的路徑要嘛是原本那一個、要嘛已經寫在畫面上告訴使用者了。
//   8. 全程寫一份純文字紀錄放在 exe 旁邊。程式關掉之後發生的事情，沒有紀錄就完全
//      看不見，只能猜。這份紀錄是唯一能事後回答「那次更新到底卡在哪一步」的東西。
//   9. 下載網址、版號、雜湊值一律由主程序自己向 GitHub 問，不接受畫面層傳進來的值。
//      這個檔案下載完會被執行，信任來源只能是 TLS 之下的 api.github.com。
//
// 舊機制（.new/.old/.updating/.relaunch＋PowerShell 換檔腳本）的**接收端**刻意留著：
// 使用者手上還有 v1.6.0／v1.7.0，他們按更新時跑的是舊版自己的程式碼，那份程式碼
// 會把新檔頂上原檔名、建立 <exe>.updating，然後等新版把它刪掉才不回滾。所以
// cleanupLeftovers() 和 confirmBootForSwap() 一步都不能拿掉，見它們各自的註解。
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
// 「我還活著」的專用回報檔。以前這件事是靠紀錄檔變大來回答的，那是一個設計缺陷：
// 同一個檔案同時當診斷紀錄和存活通道，於是「腳本根本沒被執行」和「腳本活著但寫不進
// 那個資料夾」在設計上無法分辨——而後者的寫入還包在一個無聲的 catch {} 裡。
// 拆成獨立的檔案之後，紀錄檔可以繼續是給人看的散文，存活通道則只有一個語意：
// 這個檔案出現＝PowerShell 真的執行了第一行。
const SWAP_ALIVE_SUFFIX = '.alive';
// 更新過程的純文字紀錄，放在 exe 旁邊（不是 userData）——出問題的時候使用者要找得到它、
// 打得開、寄得出來。程式關掉之後的每一步都只剩這裡看得到。
const SWAP_LOG_FILENAME = '六月幫你顧-更新紀錄.txt';
const SWAP_LOG_MAX_BYTES = 64 * 1024;
// 交接紙條。下載回來的新 exe 靠它知道兩件事：自己是更新來的、以及該搬回哪個檔名。
// 刻意放在那個 exe 旁邊而不是 userData：它要跟著那個檔案一起被找到、一起被清掉，
// 而且使用者把整個資料夾搬到別的地方也不會失效。
const TAKEOVER_SUFFIX = '.takeover';
// 新版「我真的執行了第一行」的回報檔。舊版看到它才敢關閉自己。
// 跟舊機制的 .alive 是同一個道理，差別是這次等的是新版本身，不是一段代跑的腳本。
const HELLO_SUFFIX = '.hello';
// 「改名失敗、只能用複製完成接手」時留下的清理紙條，內容是那個多出來的檔案的路徑。
// 正在執行自己的行程刪不掉自己的映像檔，所以這件事只能交給下一次開機。
const STALE_SUFFIX = '.stale';
// 請工作排程器代開新版時用的任務名稱。固定名稱＋建立時 /F，才不會累積出一堆任務。
const RELAUNCH_TASK_NAME = 'JuneWatcherRelaunch';
// 每一段啟動手法給多久回報。等的只是「新版執行了第一行」，不是「畫面載好了」，
// 但免安裝版要先把 190 MB 解壓到 %TEMP%，慢的磁碟上這一段就要好幾秒，所以給 12 秒。
const HELLO_TIMEOUT_MS = 12000;
const HELLO_POLL_MS = 150;
// 新版在取單一實例鎖之前，願意為舊版的結束等多久。舊版收到回報之後 800 毫秒就會
// app.quit()，實務上這裡只等一兩秒；上限存在只是為了不要在舊版卡死時無限等下去。
const TAKEOVER_WAIT_MS = 45000;
const TAKEOVER_WAIT_STEP_MS = 250;
// 接手換檔的重試窗口。舊程序的主行程結束之後，免安裝版的外層 launcher 還要再花一兩秒
// 砍掉那個 190 MB 的解壓目錄，在那之前舊 exe 的映像仍然被對映著、刪不掉也改不了名。
const TAKEOVER_SWAP_ROUNDS = 60;
const TAKEOVER_SWAP_STEP_MS = 500;
// 接手時「用複製頂上去」最多試幾次。改名失敗是常態（見 takeoverSwap 的註解），複製是
// 那條路真正的主線，但它要搬 90 MB：把它跟改名一樣重試 60 次，等於在已經出事的時候
// 再多寫 5 GB 到使用者的磁碟上。複製失敗的成因（磁碟滿了、資料夾不給寫）不是會自己
// 消失的那種鎖，試三次還不成就等下一次啟動，不要在這裡磨。
const TAKEOVER_COPY_TRIES = 3;
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

/**
 * 接手換檔成功之後，我們的映像檔已經被改名到別的路徑上了，但 PORTABLE_EXECUTABLE_FILE
 * 是啟動時就固定下來的環境變數，它還指著那個已經不存在的舊路徑。留著這個覆寫值，
 * 這一輪執行期間後面每一個算路徑的地方（紀錄檔、清暫存檔、再一次更新）才會算對。
 */
let exePathOverride = '';

/** 目前執行中的 exe。免安裝版要用 PORTABLE_EXECUTABLE_FILE，不然會指到暫存區裡的內層 exe。 */
function currentExe() {
  if (exePathOverride) return exePathOverride;
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
 * 下載回來的新版落地時用的檔名。這是主要路徑，不是備案：新版一定先以這個名字存在，
 * 之後才由它自己改名頂上原本的檔名。用一個「使用者一眼看得懂、雙擊就能跑」的名字，
 * 是因為自動流程一旦失敗，這個檔案就是他手上唯一的救援材料。
 * 字元白名單是必要的：這個字串會被接進檔名再交給 path.join，
 * 沒過濾的話 ../.. 之類的輸入可以跳出程式所在的資料夾。
 */
function localExeName(tag) {
  const clean = String(tag || '').replace(/^v/i, '').replace(/[^0-9A-Za-z._-]/g, '');
  const safe = /^[0-9A-Za-z][0-9A-Za-z._-]*$/.test(clean) && !clean.includes('..') ? clean : 'new';
  return `六月幫你顧_免安裝綠色版_v${safe}.exe`;
}

/**
 * 新版該落在哪個完整路徑。撞到使用者正在執行的那個檔案就換一個候選——那時候
 * 先 rm 再 rename 會去動他手上唯一能跑的東西。
 * 正常情況不會撞：tag 比目前版號新，所以檔名裡的版號一定不一樣。會撞是因為使用者
 * 自己把檔案改名成剛好那個名字，而那不是我們可以賭「不會發生」的事。
 */
function handoffPath(dir, tag, target) {
  const first = path.join(dir, localExeName(tag));
  if (!samePath(first, target)) return first;
  return path.join(dir, localExeName(tag).replace(/\.exe$/i, '_更新.exe'));
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
 * 這張清單裡的 .new / .old / .relaunch / .alive 都是**舊機制**的殘骸。新機制不再產生
 * 它們，但使用者手上還有會產生它們的版本（v1.6.0、v1.7.0），所以清理的責任要留著：
 * 那一輪更新失手留下的 90 MB，只有更新之後的這一版有機會替他收乾淨。
 *
 * 但有一個例外必須先處理：如果 .updating 旗標還在，表示舊版的換檔腳本正在旁邊等我們
 * 「證明自己起得來」，而它手上還握著 .old 當回滾備份。這時候一個字都不要碰——
 * .new / .old 是別人正在用的回滾材料。等下一次開機（那時已經沒有旗標）再清。
 */
function cleanupLeftovers() {
  const exe = currentExe();
  const removed = [];
  if (!exe) return removed;
  if (fs.existsSync(exe + SWAP_MARK_SUFFIX)) return removed;
  // 先處理接手換檔留下的那張清理紙條。內容是「上一輪只能用複製完成接手，所以多出來
  // 一個檔案」——那個檔案當時正在被執行，刪不掉，只有現在刪得掉。
  // 紙條裡的路徑一定要驗過才動手：它是我們自己寫的，但它是磁碟上的資料，
  // 而這裡做的事情是刪一個 190 MB 的執行檔。限定同一個資料夾、限定 .exe。
  try {
    const note = exe + STALE_SUFFIX;
    if (fs.existsSync(note)) {
      const stale = String(fs.readFileSync(note, 'utf8')).trim();
      const sameDir = stale && path.dirname(stale) === path.dirname(exe);
      if (sameDir && /\.exe$/i.test(stale) && !samePath(stale, exe) && fs.existsSync(stale)) {
        fs.rmSync(stale, { force: true });
        if (!fs.existsSync(stale)) removed.push(path.basename(stale));
      }
      fs.rmSync(note, { force: true });
    }
  } catch {}
  // .relaunch 也在這裡清掉：它只在「那一輪主程序決定關閉」的那幾百毫秒內有意義，
  // 留到下一輪就變成一張過期的許可證，會讓舊版的換檔腳本以為可以動手。
  // .alive 同理。.hello 是新機制的回報檔，一樣不能留：一份上一輪留下來的就足以讓
  // 下一次更新在新版根本沒被執行的情況下判定它活著，然後放心關掉程式。
  // 真正的防線在啟動新版之前那一次刪除，這裡只是收尾。
  //
  // %TEMP% 那份存活回報檔刻意不放進這張清單：它的檔名只有 exe 的檔名，同一台機器上
  // 兩份同名的複本會共用它，於是「A 開機」就會刪掉「B 正在等的那份回報」。用來換的
  // 只是一個 23 位元組的殘留物，而且下一輪 spawn 前照樣會被撕掉、名字相同也不會累積。
  for (const file of [
    exe + NEW_SUFFIX + PART_SUFFIX,
    exe + NEW_SUFFIX,
    exe + OLD_SUFFIX,
    exe + COPY_SUFFIX,
    exe + SWAP_GO_SUFFIX,
    exe + SWAP_ALIVE_SUFFIX,
    exe + HELLO_SUFFIX,
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

/**
 * 同步睡覺。接手換檔的等待發生在 app.requestSingleInstanceLock() 之前，那時候還沒有
 * 事件迴圈可以用（await 會讓後面的取鎖先跑），而那段等待又必須在取鎖之前完成——
 * 舊版還握著鎖，這時候取鎖一定失敗，而取不到鎖的那一份會直接 app.quit()，
 * 於是接手永遠不會發生。所以這裡刻意用會擋住整個執行緒的睡法。
 *
 * Atomics.wait 而不是忙等：忙等會把一顆核心燒滿好幾秒，而使用者這時正在等視窗出現。
 */
function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(0, ms));
  } catch {}
}

/**
 * 那個 pid 還活著嗎。signal 0 只做「存在嗎、我有權限嗎」的檢查，不送任何訊號。
 *
 * EPERM 要當成「活著」：那表示行程存在、但我們不能對它動手（權限不同的使用者）。
 * 把它當成死掉會讓接手提早動手，那時候舊 exe 還被鎖著，刪除和改名都會失敗。
 */
function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return Boolean(err && err.code === 'EPERM');
  }
}

/**
 * 交接紙條：新版靠它知道自己是更新來的、以及該搬回哪個檔名。回傳它是否真的在磁碟上。
 *
 * 寫不成就不要往下走，這是一條硬規則。沒有紙條的新版只會是一個「檔名怪怪的、
 * 但功能完全正常」的程式：使用者用得到新版，可是原本那個檔名永遠不會被換掉、
 * 舊的執行檔永遠不會被刪掉——那正是這次要修的症狀，不能用另一條路再走回去。
 */
function writeTakeoverNote(handoff, note) {
  const file = handoff + TAKEOVER_SUFFIX;
  try {
    fs.writeFileSync(file, JSON.stringify(note), 'utf8');
    return fs.existsSync(file);
  } catch {
    return false;
  }
}

/**
 * 讀交接紙條。回傳 null 表示「這一份不是更新來的」，那就是一次普通啟動。
 *
 * 每個欄位都當成外部輸入來驗：紙條是我們自己寫的，但它是磁碟上的資料，而讀完之後
 * 要做的事情是刪一個 190 MB 的執行檔、再把自己改名頂上去。target 空的就整張作廢。
 */
function readTakeoverNote(handoff) {
  try {
    const raw = fs.readFileSync(handoff + TAKEOVER_SUFFIX, 'utf8');
    const data = JSON.parse(raw);
    const target = String((data && data.target) || '');
    if (!target || !path.isAbsolute(target)) return null;
    return {
      target,
      tag: String((data && data.tag) || ''),
      pid: Number((data && data.pid) || 0) || 0,
      via: '',
    };
  } catch {
    return null;
  }
}

/**
 * 等一個檔案出現。用途只有一個：等新版寫下 .hello。
 *
 * 為什麼要等一個檔案，而不是相信 spawn 成功：行程被建立和「它真的執行了第一行」
 * 是兩件事。防毒把它砍掉、旗標讓它拿不到需要的東西（v1.6.0 那次 PowerShell 就是
 * 這樣無聲退場的），spawn 一樣會回報成功。這個檔案出現＝新版真的執行了第一行。
 */
async function waitForFile(file, timeoutMs) {
  if (!file) return false;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      if (fs.existsSync(file)) return true;
    } catch {}
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, HELLO_POLL_MS));
  }
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
 * 幫忙開新版的那兩個小工具（explorer.exe、schtasks.exe）用的旗標。
 *
 * 刻意不給 detached：這兩個都是「交代完就結束」的短命行程，而且我們會等它們結束，
 * 真正被建立出來的新版視窗不是它們的子行程（explorer 和排程服務才是那個父親）。
 * 給了 detached 反而會讓 stdio 的收尾變得沒必要地複雜。
 */
const EXEC_SPAWN = { stdio: 'ignore', windowsHide: true };

/**
 * 最後一段——自己直接開新版——用的旗標。
 *
 * windowsHide 一定是 false：藏的是主控台視窗，但這裡要開的是一個 GUI 程式，
 * 而 2026-09-03 在他機器上量到的事情是「旗標會決定子行程拿不拿得到該有的東西」，
 * 那次 PowerShell 就是因為拿不到主控台而無聲退場、exit 0 卻什麼都沒做。
 * detached 只給這一段：這個子行程要活得比我們久（我們馬上就要關掉）。
 * 那三次探測對「子行程會不會被連坐殺掉」的結論是互相矛盾的，所以整個設計不靠它，
 * 只把它當成前兩段都失敗時的最後一搏。
 */
const DIRECT_SPAWN = { stdio: 'ignore', windowsHide: false, detached: true };

/** 每一段幫忙開檔的動作最多等這麼久。schtasks 可能會停下來問密碼，不能無限等。 */
const RELAUNCH_STEP_TIMEOUT_MS = 8000;

/**
 * spawn 成功就算成功，不等它結束。用在「開一個 GUI 程式」這種呼叫上。
 *
 * 'spawn' 事件才是「行程真的被建立了」；只看 spawn() 沒丟例外是不夠的，
 * 找不到執行檔這種錯誤是非同步從 'error' 送出來的。
 */
function spawnQuiet(cmd, args, options) {
  return new Promise((resolve, reject) => {
    let settled = false;
    try {
      const child = spawn(cmd, args, options);
      child.once('error', (err) => {
        if (settled) return;
        settled = true;
        reject(err);
      });
      child.once('spawn', () => {
        if (settled) return;
        settled = true;
        try {
          child.unref();
        } catch {}
        resolve(child.pid || 0);
      });
    } catch (err) {
      if (!settled) reject(err);
    }
  });
}

/**
 * 等一個命令列工具跑完，回傳它的結束代碼；逾時回傳 null。
 *
 * stdio 全部 ignore 有一個目的不只是安靜：schtasks 在某些設定下會要求輸入密碼，
 * 而 stdin 指向空的時候它會立刻讀到 EOF 而失敗，不會把我們卡在那裡。
 * 逾時是第二層保險，逾時就把它殺掉——這條路失敗只是換下一段手法，不影響換檔正確性。
 */
function runToEnd(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(code);
    };
    let child = null;
    const timer = setTimeout(() => {
      try {
        if (child) child.kill();
      } catch {}
      finish(null);
    }, timeoutMs);
    try {
      child = spawn(cmd, args, EXEC_SPAWN);
    } catch {
      finish(null);
      return;
    }
    child.once('error', () => finish(null));
    child.once('close', (code) => finish(typeof code === 'number' ? code : null));
  });
}

/**
 * 第一段：請檔案總管代開。
 *
 * 這一段排在最前面是有理由的。行程是 explorer.exe 建立的，所以新版天生就在
 * 我們的行程樹和 job object 之外，也天生就在使用者那個互動工作階段裡——
 * 「開起來卻看不到視窗」這種失敗方式在這條路上不存在。而且它就是使用者雙擊時
 * 走的同一條路，防毒的行為評分對它最寬容。
 *
 * explorer.exe 會立刻結束（它只是把請求丟給已經在跑的殼層），所以退出碼沒有意義，
 * 我們也不看：這一段成不成，只由新版有沒有寫下 .hello 來回答。
 */
function relaunchViaExplorer(exe) {
  return spawnQuiet('explorer.exe', [exe], EXEC_SPAWN);
}

/**
 * 第二段：借工作排程器的手。行程由排程服務建立，同樣完全脫離我們的行程樹。
 *
 * /RU＋/IT 不能省。少了它，工作可能被建成「不管使用者有沒有登入都執行」，
 * 那是非互動工作階段，程式會在使用者看不到的地方開起來——比失敗更糟，因為
 * 使用者會以為更新沒反應，而磁碟上其實有一個看不見的實例握著單一實例鎖。
 *
 * /ST 給的是五分鐘後：這個時間其實用不到（建好馬上 /Run），但 /SC ONCE 必須有它。
 * 之所以不填一個很遠的時間——萬一後面的刪除失敗，這張工作單就會在那個時間點自己
 * 觸發一次。五分鐘後它指的檔案通常已經改名了，觸發只會靜靜地失敗；填成明天反而是
 * 給使用者留一顆不知道什麼時候會響的鈴。
 */
async function relaunchViaSchtasks(exe, onCreated) {
  const when = new Date(Date.now() + 5 * 60 * 1000);
  const hh = String(when.getHours()).padStart(2, '0');
  const mm = String(when.getMinutes()).padStart(2, '0');
  const domain = String(process.env.USERDOMAIN || '');
  const name = String(process.env.USERNAME || '');
  const user = name ? (domain ? `${domain}\\${name}` : name) : '';
  // 路徑一律原樣丟進參數陣列，不要自己補引號：Node 會照 Windows 的規則替我們加，
  // 自己補的那一對會被再轉義一次，變成路徑的一部分而讓工作單指向一個不存在的檔案。
  const create = ['/Create', '/TN', RELAUNCH_TASK_NAME, '/TR', exe, '/SC', 'ONCE', '/ST', `${hh}:${mm}`, '/F'];
  if (user) create.push('/RU', user, '/IT');
  const made = await runToEnd('schtasks.exe', create, RELAUNCH_STEP_TIMEOUT_MS);
  if (made !== 0) throw new Error(`建不出工作單（${made === null ? '逾時' : `代碼 ${made}`}）`);
  // 先記下「已經建出來了」，再去 /Run。順序反了的話，/Run 失敗就會留下一張沒人收的工作單。
  if (onCreated) onCreated();
  const ran = await runToEnd('schtasks.exe', ['/Run', '/TN', RELAUNCH_TASK_NAME], RELAUNCH_STEP_TIMEOUT_MS);
  if (ran !== 0) throw new Error(`工作單建好了但叫不動（${ran === null ? '逾時' : `代碼 ${ran}`}）`);
}

/**
 * 把那張工作單收掉。一定要等它做完才可以關程式：沒收掉的話，五分鐘後排程會再開一次，
 * 使用者會莫名其妙看到程式自己跳出來。
 */
function deleteRelaunchTask() {
  return runToEnd('schtasks.exe', ['/Delete', '/TN', RELAUNCH_TASK_NAME, '/F'], RELAUNCH_STEP_TIMEOUT_MS);
}

/**
 * 三段手法依序試著把新版開起來，每一段都用 .hello 驗收。回傳 { via, tried }。
 *
 * via 空字串＝三段都沒成功，這時候呼叫方絕對不可以關掉程式。舊機制的病根就在這裡：
 * 它把「腳本被建立了」當成「腳本會完成工作」，然後放心地 app.quit()，於是使用者
 * 看到的是視窗自己關掉、什麼都沒發生。現在只有新版親手寫下 .hello 才算成功，
 * 而那個檔案代表的是「新版真的執行了第一行程式碼」。
 *
 * 每一段都等滿 HELLO_TIMEOUT_MS 才換下一段：這裡最壞的情況是等 36 秒，
 * 而畫面上那條進度條會一直說「下載完成」。比起省時間，更重要的是不要在新版其實
 * 已經在啟動（Electron 冷啟動本來就要好幾秒）的時候就判它死刑，然後又開第二次。
 */
async function relaunchNewVersion({ exe, hello }) {
  const tried = [];
  let taskMade = false;
  const rungs = [
    { via: '檔案總管', run: () => relaunchViaExplorer(exe) },
    { via: '工作排程器', run: () => relaunchViaSchtasks(exe, () => { taskMade = true; }) },
    { via: '直接啟動', run: () => spawnQuiet(exe, [], DIRECT_SPAWN) },
  ];
  try {
    for (const rung of rungs) {
      try {
        await rung.run();
      } catch (err) {
        tried.push(`${rung.via}：${(err && err.message) || '叫不動'}`);
        continue;
      }
      if (await waitForFile(hello, HELLO_TIMEOUT_MS)) return { via: rung.via, tried };
      tried.push(`${rung.via}：叫得動，但新版沒有回報`);
    }
  } finally {
    // 不管走到哪一段、成功還是失敗，工作單都要收掉，而且要等它收完。
    if (taskMade) await deleteRelaunchTask();
  }
  return { via: '', tried };
}

/**
 * 開機時的第一個問題：這一份是更新來的嗎？如果是，先回報，再等舊版死掉。
 *
 * 呼叫點必須在 requestSingleInstanceLock() 之前，而且整段必須是同步的。理由是
 * 那把鎖現在還在舊版手上：我們一去搶就會輸，而輸掉的那一方的標準反應是 app.quit()。
 * 所以順序只能是「先回報 → 舊版看到回報才退場 → 鎖放開了 → 我們再去搶」。
 * 這也是 sleepSync 存在的唯一理由：這裡不能把控制權交回事件迴圈。
 *
 * 寫 .hello 是這個函式的第一件事，早於任何檢查與紀錄。舊版只等 12 秒，晚一步它就會
 * 判定這條路沒用而改用下一種手法，同一支程式於是被開第二次。
 *
 * 回傳 null 的兩種情況都不是錯誤：不是更新來的（普通啟動），或者舊版遲遲不結束
 * （那就照常開起來，紙條留在原地，換檔留到下一次啟動再收）。
 */
function takeOverIfPending() {
  const self = currentExe();
  if (!self) return null;
  const note = readTakeoverNote(self);
  if (!note) return null;
  try {
    fs.writeFileSync(self + HELLO_SUFFIX, String(process.pid), 'utf8');
  } catch {}
  // 紙條要求搬到的位置必須跟自己在同一個資料夾、必須是 .exe，而且不能是自己。
  // 這裡接下來要做的事情是刪掉一個 190 MB 的執行檔再把自己頂上去，所以寧可作廢整張。
  // 資料夾要正規化再比：Windows 不分大小寫，而 target 是上一個行程寫進紙條的字串，
  // 大小寫和分隔符不保證跟我們現在拿到的一模一樣。
  const target = note.target;
  const sameDir = samePath(path.dirname(target), path.dirname(self));
  const sane = sameDir && /\.exe$/i.test(target) && !samePath(target, self);
  if (!sane) {
    appendSwapLog(`交接紙條指向的位置不合理（${target}），這一輪不接手`);
    try {
      fs.rmSync(self + TAKEOVER_SUFFIX, { force: true });
    } catch {}
    return null;
  }
  appendSwapLog(
    `新版 ${app.getVersion()} 已啟動並回報，準備接手把檔名換回 ${path.basename(target)}`
  );
  if (!note.pid || note.pid === process.pid) return note;
  let waited = 0;
  while (waited < TAKEOVER_WAIT_MS && pidAlive(note.pid)) {
    sleepSync(TAKEOVER_WAIT_STEP_MS);
    waited += TAKEOVER_WAIT_STEP_MS;
  }
  const seconds = Math.round(waited / 100) / 10;
  if (pidAlive(note.pid)) {
    appendSwapLog(`等了 ${seconds} 秒，舊版（pid ${note.pid}）還沒結束，先照常開起來，換檔留到下次啟動`);
    return null;
  }
  appendSwapLog(`舊版（pid ${note.pid}）已經結束（等了 ${seconds} 秒），開始換檔`);
  return note;
}

/**
 * 接手時的換檔鏈。跟 swapInProcess 只差一件事，而那件事決定了整條路走不走得通：
 * 這裡「正在執行」的是新版（staged），不是舊版。
 *
 * 於是兩邊的優先順序剛好相反：
 *   - swapInProcess 的世界裡，staged 是一個還沒在這台機器上跑過的下載檔，backup 是
 *     使用者剛剛還在用的版本，所以出事的時候要先還原 backup。
 *   - 這裡的 staged 已經開起來、畫出視窗、寫過 hello 了，它比 backup 更值得留在正式
 *     檔名底下；而 backup 只是一個確定沒人在跑的舊檔案，挪得開。
 *
 * 更重要的是：`renameSync(staged, target)` 在正式的免安裝版上永遠會失敗。
 * electron-builder 的 portable 目標是一個 NSIS 外殼（樣板裡是 ExecWait，外殼要等內層
 * 結束才刪那個 190 MB 的暫存目錄），所以外殼行程活著；而它開自己那個 exe 的時候只給了
 * FILE_SHARE_READ，沒給 FILE_SHARE_DELETE——改名需要 DELETE 權限，複製只要讀得到。
 * 2026-09-05 的實測正是這樣：`rename(target → .old)` 成功、`rename(staged → target)`
 * 連續 61 次失敗、然後舊檔又被還原回去，於是每一輪都回報 'unchanged'（測試沒抓到是因為
 * 它把「改名到 target」整條都擋掉了，真機只擋來源是 staged 的那一條）。
 *
 * 所以複製才是這條路的主線。改名仍然先試一次：那只花幾微秒，而且萬一哪天不是 portable
 * 打包，就省掉一次 90 MB 的複製。複製留下的那份重複檔案由 .stale 紙條負責，下一次啟動
 * （那時它已經沒在跑了）才刪得掉。
 *
 * 最後的退路永遠是把舊版放回正式檔名底下：不變式是「原路徑上永遠要有一個能執行的檔案」。
 */
function takeoverSwap({ target, staged, backup, allowCopy = true }) {
  // 三個錯誤碼分開記：卡在「舊檔挪不開」和卡在「新版放不上去」是完全不同的兩件事，
  // 而後者又要分得出來是改名不成還是複製不成——把它們擠進同一個欄位，最後寫進紀錄檔的
  // 就只會是最後一步的那個碼，真正的原因會被蓋掉。
  const out = { status: 'broken', via: '', blocked: '', oldCode: '', newCode: '', copyCode: '', copied: false };
  let haveTarget = false;
  try {
    haveTarget = fs.existsSync(target);
  } catch {}
  if (haveTarget) {
    try {
      fs.rmSync(backup, { force: true });
    } catch {}
    try {
      // 這一步失敗＝有人抱著舊 exe 不放（防毒正在掃、備份軟體正在讀），此時什麼都還沒變。
      fs.renameSync(target, backup);
    } catch (err) {
      out.status = 'unchanged';
      out.blocked = 'old';
      out.oldCode = String((err && err.code) || '');
      return out;
    }
  }
  try {
    fs.renameSync(staged, target);
    out.status = 'swapped';
    out.via = 'rename';
    return out;
  } catch (err) {
    out.blocked = 'new';
    out.newCode = String((err && err.code) || '');
  }
  if (allowCopy) {
    // 複製刻意不直接寫 target：copyFileSync 不是原子的，中途斷電、磁碟滿了或來源被抽走，
    // 都會在使用者天天雙擊的那個檔名底下留一個半截的 exe，而之後每一個判斷（清理、下一輪
    // 重試）看的都只是「檔案在不在」。所以先落地 .copy、比大小、再原子改名頂上。
    const copy = target + COPY_SUFFIX;
    out.copied = true;
    try {
      const want = fs.statSync(staged).size;
      if (want <= 0) throw new Error('staged is empty');
      fs.rmSync(copy, { force: true });
      fs.copyFileSync(staged, copy);
      if (fs.statSync(copy).size !== want) throw new Error('copy truncated');
      fs.renameSync(copy, target);
      out.status = 'swapped';
      out.via = 'copy';
      return out;
    } catch (err) {
      out.blocked = 'copy';
      out.copyCode = String((err && err.code) || (err && err.message) || 'copy');
      // 半截的複製品沒有人會執行它，但還是要收掉：90 MB 的垃圾會擋住下一輪的磁碟空間。
      try {
        fs.rmSync(copy, { force: true });
      } catch {}
    }
  }
  // 兩條路都不通。正式檔名此刻是空的，唯一該做的事是把舊版放回去（它是這台機器上已經
  // 證明跑得起來的東西），然後回報 'unchanged' 讓下一輪、或下一次啟動再試。
  if (haveTarget) {
    try {
      fs.renameSync(backup, target);
      out.status = 'unchanged';
      return out;
    } catch {}
  }
  out.status = 'broken';
  return out;
}

/**
 * 接手的下半段：把自己頂到使用者平常按的那個檔名上，並刪掉舊的執行檔。
 *
 * 這裡是整個新機制的重點：做這件事的人是「已經在跑的新版」，而不是一個被 spawn 出來
 * 之後要活過父行程死亡的腳本。所以它不會無聲失敗——它就是使用者眼前這個視窗。
 *
 * 一個 Windows 的事實讓這件事成立、另一個讓它必須繞路：
 *   1. 舊的執行檔此刻已經沒有在跑（takeOverIfPending 等到它的 pid 消失才回傳），
 *      所以它可以被改名、被刪掉——這正是舊機制永遠做不到的那一步。
 *   2. 但「把自己改名頂上去」在免安裝版上永遠不會成立：外層 portable 外殼整個執行期間
 *      一直開著自己那個 exe，而且沒給 FILE_SHARE_DELETE，所以那個檔案讀得到、改不動。
 *      2026-09-05 的實測就是卡在這一步（61 次全滅）。詳見 takeoverSwap 的註解。
 *
 * 不是 await 在啟動流程上：它最多要花 30 秒（防毒掃 190 MB 的時候鎖會持續幾秒到幾十秒），
 * 而使用者此刻要的是看到視窗。失敗也不擋任何功能，最壞的情況只是檔名沒換、舊檔還在，
 * 下一次啟動會再試一次。
 */
async function finishTakeover(note) {
  if (!note) return 'skipped';
  const self = currentExe();
  const target = note.target;
  if (!self || !target || samePath(self, target)) return 'skipped';
  const backup = target + OLD_SUFFIX;
  // 先讓啟動流程把視窗開出來。第一輪就可能要複製 90 MB，那是零點幾到兩秒的同步 I/O，
  // 卡在這裡等於讓使用者多看零點幾秒的空白桌面。重試預算從第一次真的動手才開始算。
  await new Promise((resolve) => setTimeout(resolve, TAKEOVER_SWAP_STEP_MS));
  const deadline = Date.now() + TAKEOVER_SWAP_ROUNDS * TAKEOVER_SWAP_STEP_MS;
  let status = 'broken';
  let rounds = 0;
  let copyTries = 0;
  let last = { via: '', blocked: '' };
  // 跨輪次累積：最後一輪只會看到「改名又失敗了」，而真正值得寫進紀錄檔的是複製為什麼不成，
  // 那件事發生在前面某一輪。
  const codes = { old: '', new: '', copy: '' };
  for (;;) {
    rounds += 1;
    last = takeoverSwap({ target, staged: self, backup, allowCopy: copyTries < TAKEOVER_COPY_TRIES });
    if (last.copied) copyTries += 1;
    if (last.oldCode) codes.old = last.oldCode;
    if (last.newCode) codes.new = last.newCode;
    if (last.copyCode) codes.copy = last.copyCode;
    status = last.status;
    if (status === 'broken') status = await fillTargetWithRetry({ target, staged: self, backup });
    if (status === 'swapped') break;
    if (Date.now() >= deadline) break;
    // 'unchanged'＝舊 exe 還被別人抱著（最可能是防毒正在掃那個剛落地的檔案）。
    // 那種鎖會自己消失，所以隔一段時間重試同一條鏈，而不是換手法。
    await new Promise((resolve) => setTimeout(resolve, TAKEOVER_SWAP_STEP_MS));
  }

  if (status !== 'swapped') {
    // 紙條刻意留在原地：下一次啟動這個檔案的時候會從頭再試一次，狀態會自己收斂。
    // 訊息要說出「卡在哪一步」：舊檔挪不開和新版放不上去是兩件完全不同的事，
    // 2026-09-05 那次的紀錄就是因為一律怪防毒抱著舊檔，把真正的那一步藏了起來。
    const brackets = (code) => (code ? `（${code}）` : '');
    appendSwapLog(
      status !== 'unchanged'
        ? `換檔失敗：${path.basename(target)} 現在是空的，新版跑在 ${path.basename(self)} 底下，下次啟動會再試`
        : last.blocked === 'old'
          ? `試了 ${rounds} 次都改不動舊的 ${path.basename(target)}${brackets(codes.old)}，` +
            `可能是防毒或備份軟體正抱著它，新版目前跑在 ${path.basename(self)} 底下，下次啟動會再試`
          : `試了 ${rounds} 次都沒辦法把新版放到 ${path.basename(target)} 底下` +
            `（改名不成${brackets(codes.new)}，複製也不成${brackets(codes.copy)}），` +
            `舊版還在原位可以照常使用，新版目前跑在 ${path.basename(self)} 底下，下次啟動會再試`
    );
    return status;
  }

  // 從這一刻起，使用者平常按的那個檔名底下已經是新版。之後所有跟 exe 有關的路徑
  // 都要指向那裡，不然紀錄檔和清理都會寫到一個馬上就不存在的檔名旁邊。
  exePathOverride = target;
  let backupGone = false;
  for (let i = 0; i < 6; i++) {
    try {
      fs.rmSync(backup, { force: true });
      backupGone = !fs.existsSync(backup);
    } catch {}
    if (backupGone) break;
    await new Promise((resolve) => setTimeout(resolve, TAKEOVER_SWAP_STEP_MS));
  }
  // 這一輪不可能有人在等 .updating（那是舊版換檔腳本的協定，而這條路上沒有腳本），
  // 所以看到它就是上一輪留下的過期旗標。它會讓 cleanupLeftovers() 整個罷工，先收掉。
  try {
    if (fs.existsSync(target + SWAP_MARK_SUFFIX)) fs.rmSync(target + SWAP_MARK_SUFFIX, { force: true });
  } catch {}
  // 正式檔名旁邊的舊殘骸交給既有的清理函式，不要在這裡再抄一份清單：那條路上還躺著
  // 上一輪失敗留下的 .new 和 .relaunch（他這次遇到的就是這個），一併收掉。
  cleanupLeftovers();
  // 自己這一份的紙條與回報檔是掛在交接檔名下的，清理函式看不到，要手動收。
  for (const file of [self + TAKEOVER_SUFFIX, self + HELLO_SUFFIX]) {
    try {
      fs.rmSync(file, { force: true });
    } catch {}
  }
  // 只有「用複製完成」的時候自己這一份還留著，而正在執行的映像刪不掉。留一張紙條，
  // 下一次啟動（那時它已經不在執行了）由 cleanupLeftovers() 收掉。
  // 順序很重要：一定要在 cleanupLeftovers() 之後才寫，不然它會讀到紙條、刪不掉檔案，
  // 卻把紙條刪了，於是那 190 MB 永遠沒有人負責。
  let duplicate = '';
  try {
    if (fs.existsSync(self)) {
      duplicate = self;
      fs.writeFileSync(target + STALE_SUFFIX, self, 'utf8');
    }
  } catch {}
  appendSwapLog(
    `換檔完成：${path.basename(target)} 現在是 ${app.getVersion()}` +
      `（${last.via === 'copy' ? '用複製頂上去' : last.via === 'rename' ? '用改名頂上去' : '從備份救回原位'}，` +
      `試了 ${rounds} 次，舊檔${backupGone ? '已刪掉' : '刪不掉、下次啟動再清'}` +
      `${duplicate ? `，另外多出一份 ${path.basename(duplicate)} 留到下次啟動清掉` : ''}）`
  );
  // 那張工作單通常在舊版關掉之前就收掉了；萬一舊版是被強制結束的，這裡是最後一道保險。
  try {
    await deleteRelaunchTask();
  } catch {}
  return 'swapped';
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
  // 下載中的暫存檔名刻意還是 <目前exe>.new.part，即使新版最後不會落在 <目前exe>.new。
  // 理由只有一個：cleanupLeftovers() 認得的就是這個名字。改成 <新檔名>.part 之後，
  // 一次中斷的下載會留下一個沒有任何人負責清掉的 190 MB 檔案。
  const staged = target + NEW_SUFFIX;
  const partial = staged + PART_SUFFIX;
  // 真正上鎖的位置：從這一行開始才會動到磁碟。上面那個查詢階段有兩次網路往返
  // （fetchJson、後面的 httpsGet），舊寫法要等到 createWriteStream 才記下
  // activeDownload，兩次點擊只要落在那段空窗裡就會各自開一個 write stream 寫同一個
  // .part，最後那個檔案是兩份下載交錯的內容。這裡的檢查與賦值之間沒有 await，
  // 單執行緒下就是原子的。
  if (activeDownload) return { ok: false, message: '已經在下載了' };
  activeDownload = { res: null, file: null, cancelled: false };
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
    // 下載完成。從這裡開始一個位元組都不碰使用者正在執行的那個 exe——那正是舊機制
    // 失手的地方：rename(目前exe → .old) 需要 DELETE 權限，只要有任何一個 handle
    // 沒帶 FILE_SHARE_DELETE（防毒掃描、Explorer 縮圖、索引服務）就會被拒絕，
    // 而那一步一失敗，整個換檔就落到一段活不過我們自己結束的腳本身上。
    // 新版落在一個全新的檔名上，那個檔名不可能被任何人鎖住。
    const handoff = handoffPath(dir, tag, target);
    try {
      fs.rmSync(handoff, { force: true });
    } catch {}
    let landed = false;
    try {
      fs.renameSync(partial, handoff);
      landed = true;
    } catch {}
    sendProgress(sender, { received: written, total: written });
    if (!landed) {
      // 連「把下載好的檔案改成正式檔名」都失敗，那是資料夾層級的問題（權限、
      // 受控資料夾存取），不是執行檔被鎖住的問題。這時候唯一還成立的話，
      // 是把那個檔案現在的位置照實講出來。
      appendSwapLog(`下載完成，但改不了檔名（${path.basename(partial)} → ${path.basename(handoff)}）`);
      return {
        ok: false,
        message:
          `新版已經下載好了，但系統不讓我把它改成正式檔名（可能是防毒或資料夾保護）。檔案在「${partial}」，` +
          '請關掉這個程式，把檔名結尾的「.new.part」刪掉（讓它以 .exe 結尾）再打開它。',
      };
    }
    const sizeNote = `${written} 位元組${expectedDigest ? '，雜湊已驗證' : ''}`;
    appendSwapLog(`已下載 ${tag}（${sizeNote}），落地成 ${path.basename(handoff)}，接下來由新版自己接手換檔`);
    // 交接紙條。寫不成就不要啟動新版：沒有紙條的新版會是一個「功能完全正常、但檔名
    // 怪怪的」程式，原本那個檔名永遠不會被換掉、舊的執行檔永遠不會被刪掉——
    // 那正是這次要修的症狀，不能用另一條路再走回去。
    const noted = writeTakeoverNote(handoff, {
      target,
      tag,
      pid: process.pid,
      from: app.getVersion(),
      at: Date.now(),
    });
    // 回報檔要緊貼在啟動之前撕掉。它存在就等於「新版真的執行了第一行」，而我們看到它
    // 就會關掉自己；一份上一輪留下來的，足以讓我們在新版根本沒被執行的情況下關機。
    const hello = handoff + HELLO_SUFFIX;
    try {
      fs.rmSync(hello, { force: true });
    } catch {}
    let helloClear = false;
    try {
      helloClear = !fs.existsSync(hello);
    } catch {}
    // 刪不掉就不能拿它當通道：待會兒 existsSync 為真的時候，「新版剛剛寫的」和
    // 「上一輪留下來的」分不出來，而分不出來就等於沒有證據。少一個通道最壞的後果是
    // 請他自己打開一次（那句話永遠成立），信一個假通道的後果是程式默默關掉、沒人接手。
    const relaunch =
      noted && helloClear
        ? await relaunchNewVersion({ exe: handoff, hello })
        : { via: '', tried: [noted ? '回報檔清不掉' : '寫不出交接紙條'] };
    try {
      fs.rmSync(hello, { force: true });
    } catch {}
    // 記下這個 tag 已經處理過了。萬一 Release 的 tag 跟 exe 內建版號不一致，
    // 沒有這筆紀錄就會每次開機都提示更新、又下載一次、又重開一次，永遠停不下來。
    writeAppliedTag(tag);
    if (relaunch.via) {
      appendSwapLog(`新版已經啟動並回報（${relaunch.via}），開始關閉舊版，剩下的換檔交給新版完成`);
      // 讓這次 IPC 的回應先送到畫面，再退出。
      setTimeout(() => app.quit(), 800);
      // swapped 一律回 false，因為此刻檔名確實還沒換——那一步要等我們死掉才做得到。
      // 報 true 的話畫面會說「即將啟動新版本」，而使用者下一秒看到的是一個檔名不一樣
      // 的視窗。話要跟磁碟上的事實對得起來，這是這一版整體的修法方向。
      return { ok: true, restarting: true, swapped: false, verified: Boolean(expectedDigest) };
    }

    // 三段啟動手法都沒有回報。絕對不要關掉程式——關掉就沒有人接手了，那正是舊機制的
    // 病（下載完、視窗關掉、什麼都沒發生）。改成把現場講清楚：檔案已經在那裡、
    // 大小和雜湊都對過了、雙擊它就是新版，而它開起來之後會自己把後面的事做完。
    //
    // 「先關掉這個程式」這句話不能省：程式有單一實例鎖，這個舊版還開著的時候雙擊新版，
    // 新版會立刻退場並把舊視窗叫到前面，使用者看到的是「照做了卻沒變」，
    // 於是把一個其實完好的檔案當成壞的。
    appendSwapLog(
      `沒辦法自動啟動新版（${relaunch.tried.join('；')}），已請使用者自己打開 ${path.basename(handoff)}`
    );
    // 把紙條裡的 pid 改成 0，這一步不能省。接下來是使用者自己雙擊那個檔案，而紙條上
    // 如果還寫著我們的 pid，新版開機時就會為了等一個「已經不必等」的行程停在那裡不畫
    // 視窗——最長 45 秒。使用者會以為那個檔案是壞的。pid 0 表示「沒有人要等」。
    writeTakeoverNote(handoff, { target, tag, pid: 0, from: app.getVersion(), at: Date.now() });
    return {
      ok: true,
      restarting: false,
      verified: Boolean(expectedDigest),
      message:
        `新版已經下載好，大小和雜湊都驗證過了，放在「${handoff}」。` +
        '但系統不讓我自動幫你重新開啟：請先關掉這個程式，再打開上面那個檔案——' +
        '它開起來之後會自己把檔名換回你平常按的那一個，並刪掉舊的執行檔。',
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
  // 接手換檔的兩半。takeOverIfPending 必須在 requestSingleInstanceLock() 之前呼叫，
  // finishTakeover 必須在 app.whenReady() 之後——這個順序是協定的一部分，見兩者的註解。
  takeOverIfPending,
  finishTakeover,
  // 匯出給測試用：版號比較是整個更新流程的判斷核心。
  parseVersion,
  isNewer,
  hostAllowed,
  releasePageAllowed,
  pickExeAsset,
  // 匯出給測試用：換檔本身要能在假的檔案系統上跑一遍。
  swapInProcess,
  fillTarget,
  // 匯出給測試用：接手那條路的換檔鏈跟 swapInProcess 的優先順序是相反的（正在跑的是
  // 新版），而且它必須在「改名永遠失敗」的前提下還能完成——那正是 2026-09-05 的實測。
  takeoverSwap,
  // 匯出給測試用：交接紙條是新舊兩個行程之間唯一的約定，寫和讀要對得起來，
  // 而且讀那一邊要能擋掉亂寫的內容（它會決定我們去刪哪一個 190 MB 的檔案）。
  handoffPath,
  writeTakeoverNote,
  readTakeoverNote,
  // 匯出給測試用：檔名後綴要能在模擬裡對得上。
  TAKEOVER_SUFFIX,
  HELLO_SUFFIX,
  STALE_SUFFIX,
  SWAP_GO_SUFFIX,
  SWAP_ALIVE_SUFFIX,
  // 匯出給測試用：spawn 的條件是這整個機制唯一一個「錯了就完全無聲」的地方
  // （v1.6.0 那次 detached:true 讓 powershell 拿不到 console，於是它結束碼 0、
  // 一句話都不執行）。匯出真正會被交給 spawn 的那兩個物件，驗證程式才能對著它下斷言，
  // 而不是去 grep 原始碼。relaunchNewVersion 也要匯出：常數是對的但函式沒有用它，
  // 是這種驗證最典型的漏法。
  EXEC_SPAWN,
  DIRECT_SPAWN,
  relaunchNewVersion,
  // 匯出給測試用：等待與存活判斷是接手能不能動手的前提。
  sleepSync,
  pidAlive,
  waitForFile,
};
