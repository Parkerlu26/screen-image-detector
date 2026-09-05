import React from 'react';
import { Target, SoundType } from '../types';
import { playAlertSound, speakAlert } from '../utils/audio';
import {
  Volume2,
  Trash2,
  RotateCcw,
  Clock,
  Sliders,
  Mic,
  Bell,
  Monitor,
  Check,
  X,
  Layers,
} from 'lucide-react';

interface GroupBulkEditPanelProps {
  /** Every target currently inside this 子目錄. */
  items: Target[];
  onBulkUpdateTargets: (targetIds: string[], patch: Partial<Target>) => void;
  onDeleteTargets: (targetIds: string[]) => void;
  masterVolume: number;
}

/** 滑桿軌道的填色量。min/max 不是 0/100 的滑桿要先換算成百分比。 */
const fillPercent = (value: number, min: number, max: number) =>
  `${((value - min) / (max - min)) * 100}%`;

/**
 * 批次編輯 panel for one 子目錄.
 *
 * Every control writes the same patch to all targets in the group. A control
 * whose value differs across the group shows 混合 rather than pretending one of
 * the values is "the" value — but moving it still assigns that one value to
 * everything, which is the whole point of a bulk edit.
 */
export const GroupBulkEditPanel: React.FC<GroupBulkEditPanelProps> = ({
  items,
  onBulkUpdateTargets,
  onDeleteTargets,
  masterVolume,
}) => {
  const ids = items.map((t) => t.id);

  /** The shared value of a field, or null when the group disagrees. */
  function common<T>(pick: (t: Target) => T): T | null {
    if (items.length === 0) return null;
    const first = pick(items[0]);
    return items.every((t) => pick(t) === first) ? first : null;
  }

  const apply = (patch: Partial<Target>) => onBulkUpdateTargets(ids, patch);

  const commonThreshold = common((t) => Math.round(t.threshold * 100));
  const commonCooldown = common((t) => t.cooldownSeconds);
  const commonSound = common((t) => t.soundType);
  const commonVolume = common((t) => Math.round((t.volume ?? 0.8) * 100));
  const commonSpeech = common((t) => t.speakName);
  const commonSpeechVolume = common((t) => Math.round((t.speechVolume ?? 1) * 100));
  const roiCount = items.filter((t) => !!t.normalizedRoi).length;

  const mixed = <span className="tag warn">混合</span>;

  if (items.length === 0) {
    return (
      <div className="bulk" style={{ fontSize: 'var(--fs1)', color: 'var(--dim2)' }}>
        這個子目錄還沒有目標，先把卡片拖進來就能一次設定。
      </div>
    );
  }

  return (
    <div className="bulk">
      <header>
        <Layers style={{ width: 14, height: 14, color: 'var(--acc-txt)' }} />
        <b>批次設定：一次套用到這個子目錄的 {items.length} 個目標</b>
      </header>

      <div style={{ display: 'flex', gap: 'var(--sp2)' }}>
        <button
          type="button"
          onClick={() => apply({ enabled: true })}
          className="btn mini"
          style={{ flex: 1, justifyContent: 'center', color: 'var(--ok)' }}
        >
          <Check />
          全部啟用
        </button>
        <button
          type="button"
          onClick={() => apply({ enabled: false })}
          className="btn mini"
          style={{ flex: 1, justifyContent: 'center' }}
        >
          <X />
          全部停用
        </button>
      </div>

      <div className="list">
        <div className="row stack">
          <div className="head">
            <span className="lab">
              <Sliders />
              相似度門檻
            </span>
            {commonThreshold === null ? (
              mixed
            ) : (
              <span className="val num">
                <b>{commonThreshold}%</b>
              </span>
            )}
          </div>
          <input
            type="range"
            min="50"
            max="99"
            value={commonThreshold ?? 80}
            onChange={(e) => apply({ threshold: Number(e.target.value) / 100 })}
            style={{ '--p': fillPercent(commonThreshold ?? 80, 50, 99) } as React.CSSProperties}
            aria-label="批次相似度門檻"
          />
        </div>

        <div className="row">
          <span className="lab">
            <Clock />
            冷卻
          </span>
          {commonCooldown === null && mixed}
          <input
            type="number"
            min="1"
            max="60"
            value={commonCooldown ?? ''}
            placeholder="—"
            onChange={(e) => apply({ cooldownSeconds: Math.max(1, Number(e.target.value)) })}
            className="field num"
            style={{ width: 46 }}
            aria-label="批次冷卻秒數"
          />
          <span className="val">秒</span>
        </div>

        {/* 批次框選需要當下的影格，所以這裡只提供「全部改回全畫面」 */}
        <div className="row">
          <span className="lab">
            <Monitor />
            區域 {roiCount}/{items.length}
          </span>
          <button
            type="button"
            onClick={() => apply({ normalizedRoi: null })}
            disabled={roiCount === 0}
            className="btn mini"
            title="把這個子目錄的目標全部改回全畫面偵測"
          >
            <RotateCcw />
            全改全螢幕
          </button>
        </div>

        <div className="row">
          <span className="lab">
            <Bell />
            提示音
          </span>
          <select
            value={commonSound ?? ''}
            onChange={(e) => apply({ soundType: e.target.value as SoundType })}
            className="field"
            style={{ width: 96 }}
            aria-label="批次提示音"
          >
            {commonSound === null && <option value="">（混合音效）</option>}
            <option value="double_ding">🎯 雙音</option>
            <option value="chime">🔔 鈴聲</option>
            <option value="beep">🚨 嗶聲</option>
            <option value="siren">⚠️ 警報</option>
            <option value="coin">🪙 金幣</option>
            <option value="scifi">⚡ 科技</option>
            <option value="fanfare">🎺 號角</option>
          </select>
          <button
            type="button"
            onClick={() =>
              playAlertSound(commonSound ?? 'chime', ((commonVolume ?? 80) / 100) * masterVolume)
            }
            className="btn mini ico-only"
            aria-label="試聽音效"
            title="試聽音效"
          >
            <Volume2 />
          </button>
          <button
            type="button"
            onClick={() => apply({ speakName: true })}
            aria-pressed={commonSpeech === true}
            className="btn mini"
            style={commonSpeech === true ? { color: 'var(--warn)' } : undefined}
            title="全部開啟語音朗讀"
          >
            <Mic />
            朗讀開
          </button>
          <button
            type="button"
            onClick={() => apply({ speakName: false })}
            aria-pressed={commonSpeech === false}
            className="btn mini"
            title="全部關閉語音朗讀"
          >
            朗讀關
          </button>
        </div>
        <div className="row">
          <span className="lab">
            <Volume2 />
            提示音量
          </span>
          <input
            type="range"
            min="0"
            max="100"
            value={commonVolume ?? 80}
            onChange={(e) => apply({ volume: Number(e.target.value) / 100 })}
            style={{ '--p': fillPercent(commonVolume ?? 80, 0, 100) } as React.CSSProperties}
            aria-label="批次提示音量"
          />
          {commonVolume === null ? (
            mixed
          ) : (
            <span className="val num" style={{ width: 34, textAlign: 'right' }}>
              {commonVolume}%
            </span>
          )}
        </div>

        <div className="row">
          <span className="lab">
            <Mic />
            語音音量
          </span>
          <input
            type="range"
            min="0"
            max="100"
            value={commonSpeechVolume ?? 100}
            onChange={(e) => apply({ speechVolume: Number(e.target.value) / 100 })}
            style={
              { '--p': fillPercent(commonSpeechVolume ?? 100, 0, 100) } as React.CSSProperties
            }
            aria-label="批次語音音量"
          />
          {commonSpeechVolume === null ? (
            mixed
          ) : (
            <span className="val num" style={{ width: 34, textAlign: 'right' }}>
              {commonSpeechVolume}%
            </span>
          )}
          <button
            type="button"
            onClick={() => speakAlert('批次語音測試', (commonSpeechVolume ?? 100) / 100)}
            className="btn mini ico-only"
            aria-label="試聽語音"
            title="試聽語音"
          >
            <Mic />
          </button>
        </div>
      </div>

      {/* 破壞性操作放最後，跟上面的設定隔開，顏色也講清楚 */}
      <button
        type="button"
        onClick={() => {
          if (window.confirm(`確定要刪除這個子目錄裡的 ${items.length} 個目標嗎？此動作無法復原。`)) {
            onDeleteTargets(ids);
          }
        }}
        className="btn mini"
        style={{ justifyContent: 'center', color: 'var(--bad)' }}
      >
        <Trash2 />
        刪除子目錄內所有目標
      </button>
    </div>
  );
};
