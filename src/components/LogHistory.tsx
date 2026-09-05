import React from 'react';
import { MatchLogEntry } from '../types';
import { Trash2, Sparkles } from 'lucide-react';

interface LogHistoryProps {
  logs: MatchLogEntry[];
  onClearLogs: () => void;
  masterVolume: number;
}

export const LogHistory: React.FC<LogHistoryProps> = ({ logs, onClearLogs }) => {
  return (
    <section className="panel logs">
      <header>
        <h3>辨識觸發記錄</h3>
        <span className="count">{logs.length}</span>
        <div style={{ flex: 1 }} />
        {logs.length > 0 && (
          <button type="button" onClick={onClearLogs} className="btn mini" title="清空歷史記錄">
            <Trash2 />
            清空
          </button>
        )}
      </header>

      <div className="body" style={{ padding: 5 }}>
        {logs.length === 0 ? (
          <div className="empty">
            <Sparkles />
            <p>尚無偵測觸發記錄</p>
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
              <div key={log.id} className="logrow">
                {/* 縮圖有就放縮圖，沒有就只留左邊那條目標色——顏色一定要看得到 */}
                <div className="chip" style={{ '--tc': log.color } as React.CSSProperties}>
                  {log.snapshotDataUrl && <img src={log.snapshotDataUrl} alt="Match snapshot" />}
                  <i />
                </div>

                <div className="t">
                  <b>{log.targetName}</b>
                  <span className="num">
                    X:{Math.round(log.box.x)} Y:{Math.round(log.box.y)}
                  </span>
                </div>

                <div className="r">
                  <span
                    className="tag"
                    style={{
                      height: 17,
                      background: `${log.color}25`,
                      borderColor: `${log.color}40`,
                      color: log.color,
                    }}
                  >
                    <span className="num">{Math.round(log.similarity * 100)}%</span>
                  </span>
                  <div className="num" style={{ marginTop: 2 }}>
                    {timeStr}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
};
