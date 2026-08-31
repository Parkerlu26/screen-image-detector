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
  Crosshair,
  CheckCircle2,
  XCircle,
  Layers,
} from 'lucide-react';

interface GroupBulkEditPanelProps {
  /** Every target currently inside this 子目錄. */
  items: Target[];
  onBulkUpdateTargets: (targetIds: string[], patch: Partial<Target>) => void;
  onDeleteTargets: (targetIds: string[]) => void;
  masterVolume: number;
}

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

  const mixed = (
    <span className="text-[9px] px-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-semibold">
      混合
    </span>
  );

  if (items.length === 0) {
    return (
      <div className="px-2.5 py-2 text-[11px] text-slate-500 bg-slate-950/70 border-t border-slate-800">
        這個子目錄還沒有目標，先把卡片拖進來就能一次設定。
      </div>
    );
  }

  return (
    <div className="p-2.5 space-y-2 bg-slate-950/80 border-t border-slate-800">
      <div className="flex items-center gap-1.5 text-[11px] text-indigo-200 font-bold">
        <Layers className="w-3 h-3" />
        批次設定：一次套用到這個子目錄的 {items.length} 個目標
      </div>

      {/* Enable / disable everything */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => apply({ enabled: true })}
          className="flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold bg-emerald-600/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-600/30 transition-colors cursor-pointer"
        >
          <CheckCircle2 className="w-3 h-3" />
          全部啟用
        </button>
        <button
          type="button"
          onClick={() => apply({ enabled: false })}
          className="flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 transition-colors cursor-pointer"
        >
          <XCircle className="w-3 h-3" />
          全部停用
        </button>
      </div>

      {/* Threshold */}
      <div className="space-y-1 bg-slate-900/70 p-2 rounded-lg border border-slate-800">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-slate-300 font-medium flex items-center gap-1">
            <Sliders className="w-3 h-3 text-slate-400" />
            相似度門檻
          </span>
          {commonThreshold === null ? (
            mixed
          ) : (
            <strong className="text-emerald-400 font-mono">{commonThreshold}%</strong>
          )}
        </div>
        <input
          type="range"
          min="50"
          max="99"
          value={commonThreshold ?? 80}
          onChange={(e) => apply({ threshold: Number(e.target.value) / 100 })}
          className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        {/* Cooldown */}
        <div className="flex items-center justify-between bg-slate-900/70 px-2.5 py-1.5 rounded-lg border border-slate-800 text-[11px]">
          <span className="text-slate-400 flex items-center gap-1">
            <Clock className="w-3 h-3 text-cyan-400" />
            冷卻:
          </span>
          <div className="flex items-center gap-1">
            <input
              type="number"
              min="1"
              max="60"
              value={commonCooldown ?? ''}
              placeholder="—"
              onChange={(e) => apply({ cooldownSeconds: Math.max(1, Number(e.target.value)) })}
              className="w-11 bg-slate-950 border border-slate-700 rounded px-1 py-0.5 text-center text-white font-bold text-[11px]"
            />
            <span className="text-slate-400">秒</span>
          </div>
        </div>

        {/* ROI clearing (bulk framing needs the live frame, so only clearing is offered) */}
        <div className="flex items-center justify-between bg-slate-900/70 px-2.5 py-1.5 rounded-lg border border-slate-800 text-[11px]">
          <span className="text-slate-400 flex items-center gap-1">
            <Crosshair className="w-3 h-3 text-indigo-400" />
            區域: {roiCount}/{items.length}
          </span>
          <button
            type="button"
            onClick={() => apply({ normalizedRoi: null })}
            disabled={roiCount === 0}
            className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-[10px] font-semibold transition-colors disabled:opacity-40 cursor-pointer"
            title="把這個子目錄的目標全部改回全畫面偵測"
          >
            <RotateCcw className="w-2.5 h-2.5" />
            全改全螢幕
          </button>
        </div>
      </div>

      {/* Sound + speech toggle */}
      <div className="flex items-center gap-2 text-[11px]">
        <div className="flex items-center gap-1 flex-1">
          <select
            value={commonSound ?? ''}
            onChange={(e) => apply({ soundType: e.target.value as SoundType })}
            className="bg-slate-950 border border-slate-800 rounded-md px-1.5 py-0.5 text-[11px] text-slate-300 focus:outline-none focus:border-emerald-500 flex-1 cursor-pointer"
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
            className="p-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
            title="試聽音效"
          >
            <Volume2 className="w-3 h-3 text-emerald-400" />
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => apply({ speakName: true })}
            className={`px-2 py-0.5 rounded-md text-[10px] font-medium border transition-colors cursor-pointer ${
              commonSpeech === true
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-300'
            }`}
            title="全部開啟語音朗讀"
          >
            <Mic className="w-2.5 h-2.5 inline mr-0.5" />
            朗讀開
          </button>
          <button
            type="button"
            onClick={() => apply({ speakName: false })}
            className={`px-2 py-0.5 rounded-md text-[10px] font-medium border transition-colors cursor-pointer ${
              commonSpeech === false
                ? 'bg-slate-700 text-slate-200 border-slate-600'
                : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-300'
            }`}
            title="全部關閉語音朗讀"
          >
            朗讀關
          </button>
        </div>
      </div>

      {/* Alert volume */}
      <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-900/70 rounded-lg border border-slate-800 text-[10px]">
        <Volume2 className="w-3 h-3 text-slate-400" />
        <span className="text-slate-400">提示音量:</span>
        <input
          type="range"
          min="0"
          max="100"
          value={commonVolume ?? 80}
          onChange={(e) => apply({ volume: Number(e.target.value) / 100 })}
          className="flex-1 h-1 bg-slate-800 rounded accent-emerald-500 cursor-pointer"
        />
        {commonVolume === null ? (
          mixed
        ) : (
          <span className="font-mono text-emerald-400 w-7 text-right font-bold">{commonVolume}%</span>
        )}
      </div>

      {/* Speech volume */}
      <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-900/70 rounded-lg border border-slate-800 text-[10px]">
        <Mic className="w-3 h-3 text-slate-400" />
        <span className="text-slate-400">語音音量:</span>
        <input
          type="range"
          min="0"
          max="100"
          value={commonSpeechVolume ?? 100}
          onChange={(e) => apply({ speechVolume: Number(e.target.value) / 100 })}
          className="flex-1 h-1 bg-slate-800 rounded accent-amber-500 cursor-pointer"
        />
        {commonSpeechVolume === null ? (
          mixed
        ) : (
          <span className="font-mono text-amber-400 w-7 text-right font-bold">
            {commonSpeechVolume}%
          </span>
        )}
        <button
          type="button"
          onClick={() => speakAlert('批次語音測試', (commonSpeechVolume ?? 100) / 100)}
          className="p-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
          title="試聽語音"
        >
          <Mic className="w-3 h-3 text-amber-400" />
        </button>
      </div>

      {/* Destructive: delete every target in the group */}
      <button
        type="button"
        onClick={() => {
          if (window.confirm(`確定要刪除這個子目錄裡的 ${items.length} 個目標嗎？此動作無法復原。`)) {
            onDeleteTargets(ids);
          }
        }}
        className="w-full flex items-center justify-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold bg-rose-950/40 text-rose-300 border border-rose-900/60 hover:bg-rose-900/40 transition-colors cursor-pointer"
      >
        <Trash2 className="w-3 h-3" />
        刪除子目錄內所有目標
      </button>
    </div>
  );
};
