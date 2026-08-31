import React from 'react';
import { MatchLogEntry } from '../types';
import { History, Trash2, Sparkles } from 'lucide-react';

interface LogHistoryProps {
  logs: MatchLogEntry[];
  onClearLogs: () => void;
  masterVolume: number;
}

export const LogHistory: React.FC<LogHistoryProps> = ({ logs, onClearLogs }) => {
  return (
    <div className="flex flex-col bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl" style={{ height: '100%', minHeight: 0 }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-950/80 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
            <History className="w-3.5 h-3.5" />
          </div>
          <div>
            <h2 className="text-xs font-bold text-white flex items-center gap-1.5">
              辨識觸發記錄
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-slate-800 text-cyan-400 border border-slate-700">
                {logs.length}
              </span>
            </h2>
          </div>
        </div>

        {logs.length > 0 && (
          <button
            type="button"
            onClick={onClearLogs}
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-rose-400 text-[11px] font-medium transition-colors border border-slate-700"
            title="清空歷史記錄"
          >
            <Trash2 className="w-3 h-3" />
            清空
          </button>
        )}
      </div>

      {/* Log Items list */}
      <div className="flex-1 p-2.5 space-y-1.5 overflow-y-auto" style={{ minHeight: 0 }}>
        {logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <div className="w-9 h-9 rounded-xl bg-slate-800/60 border border-slate-700/50 flex items-center justify-center text-slate-500 mb-1.5">
              <Sparkles className="w-4 h-4" />
            </div>
            <p className="text-xs text-slate-400">尚無偵測觸發記錄</p>
          </div>
        ) : (
          logs.map((log) => {
            const timeStr = new Date(log.timestamp).toLocaleTimeString('zh-TW', {
              hour12: false,
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              fractionalSecondDigits: 3,
            });

            return (
              <div
                key={log.id}
                className="flex items-center justify-between gap-2 p-1.5 bg-slate-950/70 border border-slate-800/80 rounded-lg hover:border-slate-700 transition-colors"
              >
                {/* Left: Thumbnail & Info */}
                <div className="flex items-center gap-2 min-w-0">
                  {log.snapshotDataUrl ? (
                    <div
                      className="w-8 h-8 rounded border flex items-center justify-center bg-slate-900 p-0.5 overflow-hidden shrink-0"
                      style={{ borderColor: log.color }}
                    >
                      <img
                        src={log.snapshotDataUrl}
                        alt="Match snapshot"
                        className="max-w-full max-h-full object-contain"
                      />
                    </div>
                  ) : (
                    <div
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: log.color }}
                    />
                  )}

                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <h4 className="text-xs font-bold text-white truncate max-w-[120px]">{log.targetName}</h4>
                      <span
                        className="text-[10px] px-1 py-0.2 rounded font-mono font-bold"
                        style={{ backgroundColor: `${log.color}25`, color: log.color }}
                      >
                        {Math.round(log.similarity * 100)}%
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono block">
                      {timeStr}
                    </span>
                  </div>
                </div>

                {/* Right: Coordinates */}
                <div className="text-right text-[10px] text-slate-400 font-mono shrink-0">
                  <span>
                    X:{Math.round(log.box.x)} Y:{Math.round(log.box.y)}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
