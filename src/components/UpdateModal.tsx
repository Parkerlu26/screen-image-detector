import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Download, X, RefreshCw, CheckCircle2, AlertTriangle, ExternalLink } from 'lucide-react';

/** main process 回傳的檢查結果。刻意沒有 downloadUrl：畫面層不需要知道，也不該
 *  有機會影響下載來源——那個檔案下載完會被當成程式本身執行。 */
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

interface UpdateApi {
  checkForUpdate?: () => Promise<UpdateInfo>;
  downloadUpdate?: () => Promise<{
    ok: boolean;
    message?: string;
    cancelled?: boolean;
    restarting?: boolean;
  }>;
  cancelUpdateDownload?: () => Promise<boolean>;
  openReleasePage?: (url?: string) => Promise<boolean>;
  onUpdateDownloadProgress?: (
    cb: (data: { received: number; total: number }) => void
  ) => () => void;
}

/** 沒有 electronAPI（例如瀏覽器預覽）時全部功能自動退場，不會拋錯。 */
export const updateApi = (): UpdateApi | undefined =>
  (window as unknown as { electronAPI?: UpdateApi }).electronAPI;

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
    setError('');
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
    setProgress({ received: 0, total: info.downloadSize || 0 });
    try {
      const result = await api.downloadUpdate();
      if (result.ok) {
        // main process 會在幾百毫秒後關掉程式，這裡只要讓畫面說清楚就好。
        setRestarting(true);
        return;
      }
      setProgress(null);
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
    await updateApi()?.cancelUpdateDownload?.();
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
                  上一次已經下載並嘗試更新過這個版本，但重開之後版號沒有變。可能是那次換檔沒成功
                  （檔案被佔用或被防毒擋掉），也可能是發布時版號沒更新。可以再試一次，或先到下載頁面確認。
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
                  ? '下載完成，即將關閉並啟動新版本…'
                  : `正在下載 ${formatSize(progress.received)}${
                      progress.total ? ` / ${formatSize(progress.total)}` : ''
                    }${percent !== null ? `（${percent}%）` : ''}`}
              </p>
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
                {info?.ok && info.hasUpdate && (
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
                  {info?.ok && info.hasUpdate ? '稍後再說' : '關閉'}
                </button>
                {info?.ok && info.hasUpdate && info.canAutoUpdate && (
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
