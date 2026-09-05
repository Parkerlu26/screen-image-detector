/**
 * 軟體更新視窗。
 *
 * 六種狀態共用同一個外殼：正在檢查／檢查失敗／已是最新／有新版／正在下載／
 * 已換好但要自己重開。每一種都用 components.css 的 .banner（圖示＋顏色，
 * 不靠顏色單獨表意），版本說明用 .notes，下載進度用 .prog2。
 *
 * .scrim 預設就是 z-index 60，跟改版前寫死的 z-[60] 同一層：App.tsx 裡
 * 「更新視窗是 z-60、登入是 z-100，所以登入還開著就先別彈更新」那個判斷
 * 靠的就是這個數字，不要在這裡蓋掉它。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Download, X, RefreshCw, CheckCircle2, AlertTriangle, ExternalLink, FileText } from 'lucide-react';
import type { ElectronAPI, UpdateInfo } from '../electron-api';

// UpdateInfo 的定義搬到 src/electron-api.d.ts 了（那裡是整座橋的唯一描述），
// 這裡繼續往外送同一個名字，原本從這個檔案匯入它的地方不用改。
export type { UpdateInfo };

/**
 * 沒有 electronAPI（例如瀏覽器預覽）時全部功能自動退場，不會拋錯。
 *
 * 以前這裡自己寫了一份縮小版的介面再 `as unknown as` 轉型過去，於是同一座橋有兩份
 * 互不相干的描述：改了 preload 只有其中一份會跟著錯，另一份繼續說謊。
 */
export const updateApi = (): ElectronAPI | undefined => window.electronAPI;

export const SKIPPED_VERSION_KEY = 'june_skipped_update_version';

function formatSize(bytes: number): string {
  if (!bytes) return '';
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface UpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 開機自動檢查時已經抓過一次，直接沿用，不用再打一次 GitHub。 */
  presetInfo?: UpdateInfo | null;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({ isOpen, onClose, presetInfo }) => {
  const [info, setInfo] = useState<UpdateInfo | null>(presetInfo ?? null);
  const [isChecking, setIsChecking] = useState(false);
  const [progress, setProgress] = useState<{ received: number; total: number } | null>(null);
  const [error, setError] = useState('');
  const [restarting, setRestarting] = useState(false);
  // 「換好了，但要你自己重開」。這不是錯誤，所以跟 error 分開，用不同顏色講。
  const [handoff, setHandoff] = useState('');
  const isDownloading = progress !== null && !restarting;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // 同一次開啟裡只允許一個下載在跑；主程序也會擋，這裡是為了不讓畫面出現兩條進度。
  const busyRef = useRef(false);

  const check = useCallback(async () => {
    const api = updateApi();
    if (!api?.checkForUpdate) {
      setInfo({ ok: false, currentVersion: '', message: '這個版本不支援檢查更新' });
      return;
    }
    setIsChecking(true);
    // 上一輪的結果全部清掉。只清 error 是不夠的：使用者按過「立即更新」失敗、
    // 再按「重新檢查」的時候，殘留的 progress 會讓進度條掛在那裡，殘留的 handoff
    // 會用綠字說「更新已經完成」，而 restarting 還會把所有按鈕藏起來——畫面於是
    // 停在一個沒有出口的狀態，講的還是上一輪的事。
    setError('');
    setHandoff('');
    setProgress(null);
    setRestarting(false);
    try {
      setInfo(await api.checkForUpdate());
    } finally {
      setIsChecking(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    if (presetInfo) {
      setInfo(presetInfo);
      return;
    }
    void check();
  }, [isOpen, presetInfo, check]);

  // 下載進度是 main process 主動推的，開著就聽。
  useEffect(() => {
    const api = updateApi();
    if (!isOpen || !api?.onUpdateDownloadProgress) return;
    return api.onUpdateDownloadProgress((data) => setProgress(data));
  }, [isOpen]);

  const startDownload = async () => {
    const api = updateApi();
    // 條件是「主程序說可以自動更新」，不是「畫面上有網址」。要下載什麼由主程序決定。
    if (!api?.downloadUpdate || !info?.canAutoUpdate || busyRef.current) return;
    busyRef.current = true;
    setError('');
    setHandoff('');
    setProgress({ received: 0, total: info.downloadSize || 0 });
    try {
      const result = await api.downloadUpdate();
      // 只有主程序明確說「我要重新啟動了」才顯示那句話。舊版是「ok 就當成要重開」，
      // 於是換檔腳本被防毒擋掉的時候，畫面會永遠停在「即將關閉並啟動新版本…」。
      if (result.ok && result.restarting === true) {
        // main process 會在幾百毫秒後關掉程式，這裡只要讓畫面說清楚就好。
        setRestarting(true);
        return;
      }
      setProgress(null);
      if (result.ok) {
        // 檔案已經驗證過、就在那裡，只是沒辦法自動幫他開起來——這是成功，
        // 不要用紅字嚇他。訊息裡會有完整路徑，所以這裡的預設字串只是保險。
        setHandoff(result.message || '新版已經下載好了，請關掉這個程式，再打開那個新檔案。');
        return;
      }
      // 自己按取消的不算錯誤，不用再嚇他一次。
      if (!result.cancelled) setError(result.message || '更新失敗');
    } catch (err) {
      // invoke 本身失敗（主程序丟例外）也要收，不然進度條會永遠停在 0%。
      setProgress(null);
      setError(err instanceof Error ? err.message : '更新失敗');
    } finally {
      busyRef.current = false;
    }
  };

  const cancel = async () => {
    // 回傳 false＝主程序手上沒有正在進行的下載（已經下載完、正在換檔了）。
    // 那時候把進度清掉是錯的：畫面會變成一個沒有進度、也沒有任何按鈕的空對話框，
    // 而換檔其實還在跑。只有真的取消掉才收掉進度條。
    const stopped = await updateApi()?.cancelUpdateDownload?.();
    if (stopped === false) return;
    setProgress(null);
  };

  const skipThisVersion = () => {
    if (info?.latestVersion) {
      try {
        localStorage.setItem(SKIPPED_VERSION_KEY, info.latestVersion);
      } catch {}
    }
    closeRef.current();
  };

  if (!isOpen) return null;

  const percent =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.received / progress.total) * 100))
      : null;

  return (
    <div className="scrim">
      <div
        className="modal"
        style={{ '--mw': '512px' } as React.CSSProperties}
        role="dialog"
        aria-modal="true"
        aria-labelledby="upd-title"
      >
        <header>
          <div className="mtile">
            <Download />
          </div>
          <div className="htxt">
            <div className="ttl">
              <h3 id="upd-title">軟體更新</h3>
            </div>
          </div>

          {/* 下載中／即將重開的時候不給關：關掉視窗並不會停下換檔，
              但畫面消失會讓人以為沒事了，接著程式自己關掉。 */}
          {!isDownloading && !restarting && (
            <div className="hact">
              <button
                type="button"
                className="btn ghost ico-only"
                onClick={onClose}
                title="關閉"
                aria-label="關閉"
              >
                <X />
              </button>
            </div>
          )}
        </header>

        {/* 內容高度隨狀態差很多（只有一條橫幅／整段版本說明＋三張提醒），
            格線列不能被拉伸，所以 alignContent 要 start。 */}
        <div className="body" style={{ alignContent: 'start' }}>
          {isChecking && (
            <div className="banner">
              <RefreshCw className="animate-spin" />
              <p>正在檢查最新版本…</p>
            </div>
          )}

          {!isChecking && info && !info.ok && (
            <div style={{ display: 'grid', gap: 'var(--sp2)' }}>
              <div className="banner warn">
                <AlertTriangle />
                <p>
                  <b>無法檢查更新</b>
                  <br />
                  {info.message}
                </p>
              </div>
              <p className="hint" style={{ margin: 0 }}>
                目前版本 v{info.currentVersion || '?'}
              </p>
            </div>
          )}

          {!isChecking && info?.ok && !info.hasUpdate && (
            <div className="banner ok">
              <CheckCircle2 />
              <p>
                <b>已經是最新版本</b>
                <br />
                目前版本 v{info.currentVersion}
                {info.latestVersion && info.latestVersion !== info.currentVersion
                  ? `（線上最新 v${info.latestVersion}）`
                  : ''}
              </p>
            </div>
          )}

          {!isChecking && info?.ok && info.hasUpdate && (
            <div style={{ display: 'grid', gap: 'var(--sp3)' }}>
              {/* 版號跳躍：新版號是這一格的主角，用強調色與最大的字級；
                  舊版號、箭頭、檔案大小都退到 dim。 */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  flexWrap: 'wrap',
                  gap: 'var(--sp2)',
                }}
              >
                <span style={{ fontSize: 'var(--fs1)', color: 'var(--dim)' }}>
                  v{info.currentVersion}
                </span>
                <span style={{ fontSize: 'var(--fs1)', color: 'var(--dim2)' }}>→</span>
                <span
                  style={{
                    fontSize: 'var(--fs4)',
                    fontWeight: 600,
                    letterSpacing: '-0.01em',
                    color: 'var(--acc-txt)',
                  }}
                >
                  v{info.latestVersion}
                </span>
                {info.downloadSize ? (
                  <span className="hint" style={{ margin: 0 }}>
                    {formatSize(info.downloadSize)}
                  </span>
                ) : null}
              </div>

              {info.notes ? (
                <div style={{ display: 'grid', gap: '6px' }}>
                  <span className="hint" style={{ margin: 0, color: 'var(--dim)', fontWeight: 600 }}>
                    更新內容
                  </span>
                  {/* .notes 自己帶底色、外框、內距、190px 上限與 pre-wrap，而且明寫
                      回代幣字體堆疊——那一條就是這裡原本掛著 font-sans 的根因修法。 */}
                  <pre className="notes">{info.notes}</pre>
                </div>
              ) : null}

              {info.staleRetry && (
                <div className="banner warn">
                  <AlertTriangle />
                  <p>
                    上一次已經下載並嘗試更新過這個版本，但重開之後版號沒有變。可能是那次換檔沒成功，
                    也可能是發布時版號沒更新。更新紀錄檔裡會寫下上次停在哪一步；可以再試一次，或先到下載頁面確認。
                  </p>
                </div>
              )}

              {!info.canAutoUpdate && (
                <div className="banner warn">
                  <AlertTriangle />
                  <p>這個資料夾沒有寫入權限或找不到可下載的執行檔，請改用下載頁面手動更新。</p>
                </div>
              )}

              {info.canAutoUpdate && info.verifiable === false && (
                <p className="hint" style={{ margin: 0 }}>
                  這個檔案沒有附雜湊值，下載後只能靠 HTTPS 保證來源，無法再比對內容。
                </p>
              )}
            </div>
          )}

          {progress && (
            <div style={{ display: 'grid', gap: 'var(--sp2)' }}>
              <div className="prog2">
                <i style={{ width: `${percent ?? 0}%` }} />
              </div>
              <p className="hint" style={{ margin: 0 }}>
                {/* restarting 只在主程序收到新版親手寫下的「我活起來了」之後才是 true，
                    所以這句話是可以保證的事實，不是承諾。檔名還沒換回來，那一步要等
                    這個舊行程結束才做得到，所以刻意不說「已經完成更新」。 */}
                {restarting
                  ? '新版已經開起來了，正在關掉這個舊視窗——剩下的檔名整理由新版自己完成。'
                  : `正在下載 ${formatSize(progress.received)}${
                      progress.total ? ` / ${formatSize(progress.total)}` : ''
                    }${percent !== null ? `（${percent}%）` : ''}`}
              </p>
            </div>
          )}

          {handoff && (
            <div className="banner ok">
              <CheckCircle2 />
              <p>
                {/* 綠色是對的：檔案已經下載完、大小和雜湊都驗過了，這是成功。
                    但標題不能寫「更新已經完成」——還差使用者自己開一次，
                    而那一步沒做，檔名和舊檔就都還在原地。 */}
                <b>新版已經準備好了，還差最後一步</b>
                <br />
                {handoff}
              </p>
            </div>
          )}

          {error && (
            <div className="banner bad">
              <AlertTriangle />
              <p>{error}</p>
            </div>
          )}
        </div>

        <footer>
          {/* 左邊三個都是「去別的地方看」的輔助入口，用 .btn mini（23px、更輕），
              才不會跟右邊真正的決定同一個重量。 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--sp1)',
              marginRight: 'auto',
            }}
          >
            {info?.pageUrl && (
              <button
                type="button"
                className="btn mini"
                onClick={() => void updateApi()?.openReleasePage?.(info.pageUrl)}
              >
                <ExternalLink />
                下載頁面
              </button>
            )}
            {!isChecking && !isDownloading && !restarting && (
              <button type="button" className="btn mini" onClick={() => void check()}>
                <RefreshCw />
                重新檢查
              </button>
            )}
            {/* 換檔的後半段發生在程式關掉之後，畫面收不到任何回報，所以出問題時
                一定要給他一個入口去看那份紀錄。staleRetry 也算「出問題」：那個狀態的
                意思就是上一輪關掉之後的那一半沒有成功，而它唯一留下的證據就在那份紀錄裡。 */}
            {(error || handoff || info?.staleRetry) && updateApi()?.openUpdateLog && (
              <button
                type="button"
                className="btn mini"
                onClick={() => void updateApi()?.openUpdateLog?.()}
              >
                <FileText />
                更新紀錄
              </button>
            )}
          </div>

          {isDownloading ? (
            <button type="button" className="btn" onClick={() => void cancel()}>
              取消下載
            </button>
          ) : restarting ? null : (
            <>
              {info?.ok && info.hasUpdate && !handoff && (
                <button type="button" className="btn ghost" onClick={skipThisVersion}>
                  跳過此版本
                </button>
              )}
              <button type="button" className="btn" onClick={onClose}>
                {info?.ok && info.hasUpdate && !handoff ? '稍後再說' : '關閉'}
              </button>
              {info?.ok && info.hasUpdate && info.canAutoUpdate && !handoff && (
                <button type="button" className="btn pri" onClick={() => void startDownload()}>
                  <Download />
                  立即更新
                </button>
              )}
            </>
          )}
        </footer>
      </div>
    </div>
  );
};
