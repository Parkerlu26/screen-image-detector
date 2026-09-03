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
  // 要重開了，但檔名還沒換好——換檔交給了外面那支更新程式。這種時候不能承諾
  // 「啟動新版」，因為它還可能換不成而把原本的版本重新啟動。
  const [swapPending, setSwapPending] = useState(false);
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
    setSwapPending(false);
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
        setSwapPending(result.swapped === false);
        return;
      }
      setProgress(null);
      if (result.ok) {
        // 檔案已經換好了，只是沒辦法自動重開——這是成功，不要用紅字嚇他。
        setHandoff(result.message || '新版已經換好了，請關掉這個程式再打開一次。');
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
    <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-slate-800 bg-slate-950 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Download className="w-5 h-5 text-cyan-400" />
            <h2 className="text-lg font-bold text-white">軟體更新</h2>
          </div>
          {!isDownloading && !restarting && (
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white transition-colors"
              aria-label="關閉"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        <div className="p-6 space-y-4">
          {isChecking && (
            <div className="flex items-center gap-3 text-slate-300">
              <RefreshCw className="w-5 h-5 animate-spin text-cyan-400" />
              正在檢查最新版本…
            </div>
          )}

          {!isChecking && info && !info.ok && (
            <div className="space-y-3">
              <div className="flex items-start gap-3 text-amber-300">
                <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">無法檢查更新</p>
                  <p className="text-sm text-slate-400">{info.message}</p>
                </div>
              </div>
              <p className="text-xs text-slate-500">目前版本 v{info.currentVersion || '?'}</p>
            </div>
          )}

          {!isChecking && info?.ok && !info.hasUpdate && (
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" />
              <div>
                <p className="font-semibold text-white">已經是最新版本</p>
                <p className="text-sm text-slate-400">
                  目前版本 v{info.currentVersion}
                  {info.latestVersion && info.latestVersion !== info.currentVersion
                    ? `（線上最新 v${info.latestVersion}）`
                    : ''}
                </p>
              </div>
            </div>
          )}

          {!isChecking && info?.ok && info.hasUpdate && (
            <div className="space-y-4">
              <div className="flex items-baseline gap-2">
                <span className="text-slate-400 text-sm">v{info.currentVersion}</span>
                <span className="text-slate-500">→</span>
                <span className="text-xl font-bold text-cyan-300">v{info.latestVersion}</span>
                {info.downloadSize ? (
                  <span className="text-xs text-slate-500">{formatSize(info.downloadSize)}</span>
                ) : null}
              </div>

              {info.notes ? (
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 max-h-48 overflow-y-auto">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                    更新內容
                  </p>
                  <pre className="text-sm text-slate-300 whitespace-pre-wrap font-sans">
                    {info.notes}
                  </pre>
                </div>
              ) : null}

              {info.staleRetry && (
                <p className="text-sm text-amber-300">
                  上一次已經下載並嘗試更新過這個版本，但重開之後版號沒有變。可能是那次換檔沒成功，
                  也可能是發布時版號沒更新。更新紀錄檔裡會寫下上次停在哪一步；可以再試一次，或先到下載頁面確認。
                </p>
              )}

              {!info.canAutoUpdate && (
                <p className="text-sm text-amber-300">
                  這個資料夾沒有寫入權限或找不到可下載的執行檔，請改用下載頁面手動更新。
                </p>
              )}

              {info.canAutoUpdate && info.verifiable === false && (
                <p className="text-xs text-slate-500">
                  這個檔案沒有附雜湊值，下載後只能靠 HTTPS 保證來源，無法再比對內容。
                </p>
              )}
            </div>
          )}

          {progress && (
            <div className="space-y-2">
              <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-cyan-500 transition-all duration-200"
                  style={{ width: `${percent ?? 0}%` }}
                />
              </div>
              <p className="text-sm text-slate-400">
                {restarting
                  ? swapPending
                    ? '下載完成，即將關閉，接著由更新程式把新版換上去並開啟…'
                    : '下載完成，即將關閉並啟動新版本…'
                  : `正在下載 ${formatSize(progress.received)}${
                      progress.total ? ` / ${formatSize(progress.total)}` : ''
                    }${percent !== null ? `（${percent}%）` : ''}`}
              </p>
            </div>
          )}

          {handoff && (
            <div className="flex items-start gap-3 text-emerald-300 bg-emerald-950/40 border border-emerald-900 rounded-xl p-4">
              <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold">更新已經完成</p>
                <p className="text-sm text-emerald-200/80">{handoff}</p>
              </div>
            </div>
          )}

          {error && <p className="text-sm text-rose-400">{error}</p>}
        </div>

        <div className="px-6 py-4 border-t border-slate-800 bg-slate-950 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {info?.pageUrl && (
              <button
                onClick={() => void updateApi()?.openReleasePage?.(info.pageUrl)}
                className="text-xs text-slate-400 hover:text-cyan-300 flex items-center gap-1 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                下載頁面
              </button>
            )}
            {!isChecking && !isDownloading && !restarting && (
              <button
                onClick={() => void check()}
                className="text-xs text-slate-400 hover:text-white flex items-center gap-1 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                重新檢查
              </button>
            )}
            {/* 換檔的後半段發生在程式關掉之後，畫面收不到任何回報，所以出問題時
                一定要給他一個入口去看那份紀錄。staleRetry 也算「出問題」：那個狀態的
                意思就是上一輪關掉之後的那一半沒有成功，而它唯一留下的證據就在那份紀錄裡。 */}
            {(error || handoff || info?.staleRetry) && updateApi()?.openUpdateLog && (
              <button
                onClick={() => void updateApi()?.openUpdateLog?.()}
                className="text-xs text-slate-400 hover:text-cyan-300 flex items-center gap-1 transition-colors"
              >
                <FileText className="w-3.5 h-3.5" />
                更新紀錄
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {isDownloading ? (
              <button
                onClick={() => void cancel()}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-slate-800 text-slate-200 hover:bg-slate-700 transition-colors"
              >
                取消下載
              </button>
            ) : restarting ? null : (
              <>
                {info?.ok && info.hasUpdate && !handoff && (
                  <button
                    onClick={skipThisVersion}
                    className="px-3 py-2 rounded-lg text-sm text-slate-400 hover:text-white transition-colors"
                  >
                    跳過此版本
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg text-sm font-semibold bg-slate-800 text-slate-200 hover:bg-slate-700 transition-colors"
                >
                  {info?.ok && info.hasUpdate && !handoff ? '稍後再說' : '關閉'}
                </button>
                {info?.ok && info.hasUpdate && info.canAutoUpdate && !handoff && (
                  <button
                    onClick={() => void startDownload()}
                    className="px-4 py-2 rounded-lg text-sm font-bold bg-cyan-600 text-white hover:bg-cyan-500 transition-colors flex items-center gap-2"
                  >
                    <Download className="w-4 h-4" />
                    立即更新
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
