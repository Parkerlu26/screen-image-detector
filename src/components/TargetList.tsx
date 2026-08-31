import React, { useState } from 'react';
import { Target, TargetGroup, SoundType } from '../types';
import { playAlertSound, speakAlert } from '../utils/audio';
import { GroupBulkEditPanel } from './GroupBulkEditPanel';
import {
  Volume2,
  Target as TargetIcon,
  Trash2,
  Edit2,
  Copy,
  RotateCcw,
  Crosshair,
  CheckCircle2,
  Clock,
  Sliders,
  Mic,
  Camera,
  Pencil,
  Check,
  ChevronDown,
  ChevronUp,
  GripVertical,
  FolderPlus,
  Folder,
  FolderOpen,
  Layers,
} from 'lucide-react';

/**
 * Custom drag MIME types. Cards and 子目錄 headers are both drop targets, so the
 * type is what tells them apart — a group header must not swallow a card drop as
 * a reorder, and vice versa.
 */
const TARGET_MIME = 'application/x-june-target';
const GROUP_MIME = 'application/x-june-group';

interface TargetListProps {
  targets: Target[];
  groups: TargetGroup[];
  onUpdateTarget: (target: Target) => void;
  onDeleteTarget: (targetId: string) => void;
  onDuplicateTarget: (target: Target) => void;
  /** Replace the whole array — ordering inside a 子目錄 is array order. */
  onReorderTargets: (targets: Target[]) => void;
  onUpdateGroups: (groups: TargetGroup[]) => void;
  onAddGroup: () => void;
  onDeleteGroup: (groupId: string) => void;
  onBulkUpdateTargets: (targetIds: string[], patch: Partial<Target>) => void;
  onDeleteTargets: (targetIds: string[]) => void;
  onOpenRoiModal: (target: Target) => void;
  onEditTarget: (target: Target) => void;
  onOpenNewCrop: () => void;
  isStreamActive: boolean;
  masterVolume: number;
}

export const TargetList: React.FC<TargetListProps> = ({
  targets,
  groups,
  onUpdateTarget,
  onDeleteTarget,
  onDuplicateTarget,
  onReorderTargets,
  onUpdateGroups,
  onAddGroup,
  onDeleteGroup,
  onBulkUpdateTargets,
  onDeleteTargets,
  onOpenRoiModal,
  onEditTarget,
  onOpenNewCrop,
  isStreamActive,
  masterVolume,
}) => {
  // Which target cards have their 參數 accordion open
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Inline renaming state
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [tempName, setTempName] = useState<string>('');

  // 子目錄 state: inline rename + which group's 批次設定 panel is open
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [tempGroupName, setTempGroupName] = useState<string>('');
  const [bulkGroupId, setBulkGroupId] = useState<string | null>(null);

  // Drag state. `dropHint` is the insertion line between cards; `dropGroupKey`
  // highlights a 子目錄 that is about to receive the drag.
  const [dragTargetId, setDragTargetId] = useState<string | null>(null);
  const [dragGroupId, setDragGroupId] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<{ id: string; pos: 'before' | 'after' } | null>(null);
  const [dropGroupKey, setDropGroupKey] = useState<string | null>(null);

  const knownGroupIds = new Set(groups.map((g) => g.id));
  /** Group a target actually belongs to; a dangling groupId falls back to 未分類. */
  const groupKeyOf = (t: Target): string | null =>
    t.groupId && knownGroupIds.has(t.groupId) ? t.groupId : null;

  const itemsOf = (key: string | null) => targets.filter((t) => groupKeyOf(t) === key);

  const clearDragState = () => {
    setDragTargetId(null);
    setDragGroupId(null);
    setDropHint(null);
    setDropGroupKey(null);
  };

  /**
   * Move a dragged card. `refId` is the card it was dropped on (null = dropped on
   * a 子目錄 header, meaning "append to that group"). Only the array order and the
   * card's groupId change.
   */
  const moveTarget = (
    dragId: string,
    destKey: string | null,
    refId: string | null,
    pos: 'before' | 'after'
  ) => {
    const dragged = targets.find((t) => t.id === dragId);
    if (!dragged) return;
    const rest = targets.filter((t) => t.id !== dragId);
    const moved: Target = { ...dragged, groupId: destKey };

    let index = rest.length;
    if (refId) {
      const i = rest.findIndex((t) => t.id === refId);
      if (i >= 0) index = pos === 'before' ? i : i + 1;
    } else {
      // Land after the group's current last member so the visual order matches.
      let last = -1;
      rest.forEach((t, i) => {
        if (groupKeyOf(t) === destKey) last = i;
      });
      index = last >= 0 ? last + 1 : rest.length;
    }
    onReorderTargets([...rest.slice(0, index), moved, ...rest.slice(index)]);
  };

  const reorderGroups = (dragId: string, overId: string) => {
    const from = groups.findIndex((g) => g.id === dragId);
    const to = groups.findIndex((g) => g.id === overId);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...groups];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onUpdateGroups(next);
  };

  const dragTypes = (e: React.DragEvent) => Array.from(e.dataTransfer.types);

  const onCardDragOver = (e: React.DragEvent, target: Target) => {
    if (!dragTypes(e).includes(TARGET_MIME)) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const pos: 'before' | 'after' = e.clientY - rect.top < rect.height / 2 ? 'before' : 'after';
    setDropGroupKey(groupKeyOf(target));
    setDropHint((prev) =>
      prev && prev.id === target.id && prev.pos === pos ? prev : { id: target.id, pos }
    );
  };

  const onCardDrop = (e: React.DragEvent, target: Target) => {
    if (!dragTypes(e).includes(TARGET_MIME)) return;
    e.preventDefault();
    e.stopPropagation();
    const dragId = e.dataTransfer.getData(TARGET_MIME) || dragTargetId;
    const pos = dropHint && dropHint.id === target.id ? dropHint.pos : 'before';
    clearDragState();
    if (!dragId || dragId === target.id) return;
    moveTarget(dragId, groupKeyOf(target), target.id, pos);
  };

  const onGroupDragOver = (e: React.DragEvent, key: string | null) => {
    const types = dragTypes(e);
    if (types.includes(TARGET_MIME) || (types.includes(GROUP_MIME) && key)) {
      e.preventDefault();
      setDropHint(null);
      setDropGroupKey(key);
    }
  };

  const onGroupDrop = (e: React.DragEvent, key: string | null) => {
    const types = dragTypes(e);
    if (!types.includes(TARGET_MIME) && !types.includes(GROUP_MIME)) return;
    e.preventDefault();
    e.stopPropagation();
    if (types.includes(TARGET_MIME)) {
      const dragId = e.dataTransfer.getData(TARGET_MIME) || dragTargetId;
      clearDragState();
      if (dragId) moveTarget(dragId, key, null, 'after');
      return;
    }
    const gid = e.dataTransfer.getData(GROUP_MIME) || dragGroupId;
    clearDragState();
    if (gid && key) reorderGroups(gid, key);
  };

  const toggleExpand = (targetId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(targetId)) next.delete(targetId);
      else next.add(targetId);
      return next;
    });
  };

  const handleStartRename = (target: Target) => {
    setEditingNameId(target.id);
    setTempName(target.name);
  };

  const handleSaveRename = (target: Target) => {
    const trimmed = tempName.trim();
    if (trimmed && trimmed !== target.name) {
      onUpdateTarget({ ...target, name: trimmed });
    }
    setEditingNameId(null);
  };

  const handleToggleEnabled = (target: Target) => {
    onUpdateTarget({ ...target, enabled: !target.enabled });
  };

  const handleThresholdChange = (target: Target, value: number) => {
    onUpdateTarget({ ...target, threshold: value / 100 });
  };

  const handleCooldownChange = (target: Target, value: number) => {
    onUpdateTarget({ ...target, cooldownSeconds: value });
  };

  const handleSoundChange = (target: Target, soundType: SoundType) => {
    onUpdateTarget({ ...target, soundType });
  };

  const handleSpeechToggle = (target: Target) => {
    onUpdateTarget({ ...target, speakName: !target.speakName });
  };

  const handleClearRoi = (target: Target) => {
    onUpdateTarget({ ...target, normalizedRoi: null });
  };

  const handleSaveGroupRename = (group: TargetGroup) => {
    const trimmed = tempGroupName.trim();
    if (trimmed && trimmed !== group.name) {
      onUpdateGroups(groups.map((g) => (g.id === group.id ? { ...g, name: trimmed } : g)));
    }
    setEditingGroupId(null);
  };

  const toggleGroupCollapsed = (group: TargetGroup) => {
    onUpdateGroups(groups.map((g) => (g.id === group.id ? { ...g, collapsed: !g.collapsed } : g)));
  };

  const renderCard = (target: Target) => {
    const isExpanded = expandedIds.has(target.id);
    const currentScore =
      target.currentSimilarity !== undefined ? Math.round(target.currentSimilarity * 100) : 0;
    const thresholdPercent = Math.round(target.threshold * 100);
    const isHit = currentScore >= thresholdPercent && target.enabled;
    const hasRoi = !!target.normalizedRoi;
    const isEditingThisName = editingNameId === target.id;
    const isDragging = dragTargetId === target.id;
    const hintBefore = dropHint?.id === target.id && dropHint.pos === 'before';
    const hintAfter = dropHint?.id === target.id && dropHint.pos === 'after';

    const now = Date.now();
    const timeSinceTrigger = target.lastTriggeredAt ? (now - target.lastTriggeredAt) / 1000 : 999;
    const isCoolingDown = timeSinceTrigger < target.cooldownSeconds;
    const cooldownRemaining = Math.max(0, Math.ceil(target.cooldownSeconds - timeSinceTrigger));

    return (
      <div
        key={target.id}
        onDragOver={(e) => onCardDragOver(e, target)}
        onDrop={(e) => onCardDrop(e, target)}
        className={`relative rounded-xl border transition-all duration-200 overflow-hidden ${
          isDragging ? 'opacity-40' : ''
        } ${hintBefore ? 'border-t-2 border-t-emerald-400' : ''} ${
          hintAfter ? 'border-b-2 border-b-emerald-400' : ''
        } ${
          target.enabled
            ? isHit
              ? 'bg-slate-900 border-emerald-500 shadow-lg shadow-emerald-950/40 ring-1 ring-emerald-500/50'
              : 'bg-slate-900/90 border-slate-700/80 hover:border-slate-600'
            : 'bg-slate-950/60 border-slate-800/80 opacity-60'
        }`}
      >
        <div className="h-1 w-full" style={{ backgroundColor: target.enabled ? target.color : '#475569' }} />

        <div className="p-3 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              {/* Only the handle is draggable, so the sliders and inputs inside the
                  card keep working normally. */}
              <div
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(TARGET_MIME, target.id);
                  e.dataTransfer.effectAllowed = 'move';
                  setDragTargetId(target.id);
                }}
                onDragEnd={clearDragState}
                className="shrink-0 -ml-1.5 py-2 text-slate-500 hover:text-emerald-400 cursor-grab active:cursor-grabbing"
                title="拖曳可調整順序，或拖到其他子目錄"
              >
                <GripVertical className="w-3 h-3" />
              </div>

              {/* Thumbnail (hover to re-crop) */}
              <div
                className="relative w-11 h-11 rounded-lg bg-slate-950 border-2 flex items-center justify-center p-0.5 shrink-0 group overflow-hidden"
                style={{ borderColor: target.color }}
              >
                <img
                  src={target.imageDataUrl}
                  alt={target.name}
                  className="max-w-full max-h-full object-contain"
                />
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <button
                    type="button"
                    onClick={() => onEditTarget(target)}
                    className="p-1 rounded text-white hover:text-emerald-400"
                    title="重新截圖/編輯區域"
                  >
                    <Edit2 className="w-3 h-3" />
                  </button>
                </div>
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: target.color }}
                  />
                  {isEditingThisName ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        value={tempName}
                        onChange={(e) => setTempName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveRename(target);
                          if (e.key === 'Escape') setEditingNameId(null);
                        }}
                        onBlur={() => handleSaveRename(target)}
                        className="bg-slate-950 border border-emerald-500 rounded px-1.5 py-0.5 text-xs text-white font-bold w-[110px] focus:outline-none"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => handleSaveRename(target)}
                        className="p-0.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded cursor-pointer"
                      >
                        <Check className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 group/name">
                      <h3
                        onClick={() => handleStartRename(target)}
                        className="text-xs font-bold text-white truncate max-w-[120px] cursor-pointer hover:text-emerald-400 hover:underline transition-colors"
                        title="點擊直接修改名稱"
                      >
                        {target.name}
                      </h3>
                      <button
                        type="button"
                        onClick={() => handleStartRename(target)}
                        className="opacity-0 group-hover/name:opacity-100 p-0.5 text-slate-400 hover:text-white transition-opacity cursor-pointer"
                        title="點擊修改名稱"
                      >
                        <Pencil className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-slate-400">
                  <span>
                    {target.imageWidth}×{target.imageHeight}
                  </span>
                  <span>•</span>
                  {hasRoi ? (
                    <span className="text-cyan-400 font-semibold flex items-center gap-0.5">
                      <Crosshair className="w-2.5 h-2.5" />
                      指定區域
                    </span>
                  ) : (
                    <span className="text-slate-500">全螢幕</span>
                  )}
                  <span>•</span>
                  <span className="text-emerald-400 font-mono font-bold">門檻 {thresholdPercent}%</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => handleToggleEnabled(target)}
                className={`px-2 py-1 rounded-lg text-[11px] font-semibold transition-colors flex items-center gap-1 cursor-pointer ${
                  target.enabled
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'bg-slate-800 text-slate-400 border border-slate-700'
                }`}
              >
                <CheckCircle2
                  className={`w-3 h-3 ${target.enabled ? 'text-emerald-400' : 'text-slate-500'}`}
                />
                {target.enabled ? '啟用' : '停用'}
              </button>
              <button
                type="button"
                onClick={() => toggleExpand(target.id)}
                className={`flex items-center gap-0.5 px-2 py-1 rounded-lg text-[11px] font-medium border transition-colors cursor-pointer ${
                  isExpanded
                    ? 'bg-indigo-600/30 border-indigo-500/50 text-indigo-200'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                }`}
                title={isExpanded ? '收合詳細設定' : '展開調整相似度門檻、冷卻時間與區域'}
              >
                <span>參數</span>
                {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
              <button
                type="button"
                onClick={() => onDuplicateTarget(target)}
                className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                title="複製目標"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onEditTarget(target)}
                className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                title="重新截圖/編輯區域"
              >
                <Edit2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onDeleteTarget(target.id)}
                className="p-1 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                title="刪除目標"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {isExpanded && (
            <div className="pt-2 border-t border-slate-800/80 space-y-2.5">
              {/* Threshold + live score */}
              <div className="space-y-1 bg-slate-950/70 p-2 rounded-lg border border-slate-800/90">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-300 font-medium flex items-center gap-1">
                    <Sliders className="w-3 h-3 text-slate-400" />
                    相似度門檻:{' '}
                    <strong className="text-emerald-400 font-mono">{thresholdPercent}%</strong>
                  </span>
                  <div className="flex items-center gap-1">
                    <span className="text-slate-400 text-[10px]">即時:</span>
                    <span
                      className={`text-[11px] font-bold px-1.5 py-0.5 rounded ${
                        currentScore >= thresholdPercent
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                          : currentScore >= thresholdPercent * 0.7
                          ? 'bg-amber-500/10 text-amber-300'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {target.enabled && isStreamActive ? `${currentScore}%` : '--'}
                    </span>
                  </div>
                </div>
                <input
                  type="range"
                  min="50"
                  max="99"
                  value={thresholdPercent}
                  onChange={(e) => handleThresholdChange(target, Number(e.target.value))}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                />
              </div>

              {/* Cooldown + ROI */}
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center justify-between bg-slate-950/60 px-2.5 py-1.5 rounded-lg border border-slate-800 text-[11px]">
                  <span className="text-slate-400 flex items-center gap-1">
                    <Clock className="w-3 h-3 text-cyan-400" />
                    冷卻:
                  </span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min="1"
                      max="60"
                      value={target.cooldownSeconds}
                      onChange={(e) => handleCooldownChange(target, Math.max(1, Number(e.target.value)))}
                      className="w-10 bg-slate-900 border border-slate-700 rounded px-1 text-center text-white font-bold text-[11px]"
                    />
                    <span className="text-slate-400">秒</span>
                    {isCoolingDown && (
                      <span className="px-1 rounded bg-cyan-500/20 text-cyan-300 font-bold animate-pulse text-[9px]">
                        {cooldownRemaining}s
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between bg-slate-950/60 px-2.5 py-1.5 rounded-lg border border-slate-800 text-[11px]">
                  <span className="text-slate-400 flex items-center gap-1">
                    <Crosshair className="w-3 h-3 text-indigo-400" />
                    區域:
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onOpenRoiModal(target)}
                      disabled={!isStreamActive}
                      className="px-1.5 py-0.5 rounded bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-200 border border-indigo-500/30 text-[10px] font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      {hasRoi ? '重設' : '框選'}
                    </button>
                    {hasRoi && (
                      <button
                        type="button"
                        onClick={() => handleClearRoi(target)}
                        className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                        title="清除自訂區域 (改為全畫面)"
                      >
                        <RotateCcw className="w-2.5 h-2.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Sound + speech toggle */}
              <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-800/50 text-[11px]">
                <div className="flex items-center gap-1 flex-1">
                  <select
                    value={target.soundType}
                    onChange={(e) => handleSoundChange(target, e.target.value as SoundType)}
                    className="bg-slate-950 border border-slate-800 rounded-md px-1.5 py-0.5 text-[11px] text-slate-300 focus:outline-none focus:border-emerald-500 flex-1 cursor-pointer"
                  >
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
                    onClick={() => playAlertSound(target.soundType, (target.volume ?? 0.8) * masterVolume)}
                    className="p-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
                    title="試聽音效"
                  >
                    <Volume2 className="w-3 h-3 text-emerald-400" />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => handleSpeechToggle(target)}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium transition-colors border cursor-pointer ${
                    target.speakName
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                      : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-300'
                  }`}
                  title="偵測到時朗讀目標名稱"
                >
                  <Mic className="w-2.5 h-2.5" />
                  語音朗讀
                </button>
              </div>

              {/* Per-target alert volume */}
              <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-950/60 rounded-lg border border-slate-800 text-[10px]">
                <Volume2 className="w-3 h-3 text-slate-400" />
                <span className="text-slate-400">提示音量:</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={Math.round((target.volume ?? 0.8) * 100)}
                  onChange={(e) => onUpdateTarget({ ...target, volume: Number(e.target.value) / 100 })}
                  className="flex-1 h-1 bg-slate-800 rounded accent-emerald-500 cursor-pointer"
                />
                <span className="font-mono text-emerald-400 w-7 text-right font-bold">
                  {Math.round((target.volume ?? 0.8) * 100)}%
                </span>
              </div>

              {/* Per-target speech volume */}
              <div
                className={`flex items-center gap-1.5 px-2 py-1 bg-slate-950/60 rounded-lg border border-slate-800 text-[10px] ${
                  target.speakName ? '' : 'opacity-50'
                }`}
              >
                <Mic className="w-3 h-3 text-slate-400" />
                <span className="text-slate-400">語音音量:</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={Math.round((target.speechVolume ?? 1) * 100)}
                  onChange={(e) =>
                    onUpdateTarget({ ...target, speechVolume: Number(e.target.value) / 100 })
                  }
                  className="flex-1 h-1 bg-slate-800 rounded accent-amber-500 cursor-pointer"
                  title={
                    target.speakName
                      ? '這個目標朗讀名稱時的音量'
                      : '先開啟「語音朗讀」才會用到這個音量'
                  }
                />
                <span className="font-mono text-amber-400 w-7 text-right font-bold">
                  {Math.round((target.speechVolume ?? 1) * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() => speakAlert(`偵測到 ${target.name}`, target.speechVolume ?? 1)}
                  className="p-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
                  title="試聽語音"
                >
                  <Mic className="w-3 h-3 text-amber-400" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  /**
   * One 子目錄 block (or the 未分類 block when `group` is null).
   * Padding is kept to a minimum so the cards inside stay the same width as the
   * ungrouped cards and never push past the panel.
   */
  const renderSection = (group: TargetGroup | null) => {
    const key = group ? group.id : null;
    const items = itemsOf(key);
    const enabledCount = items.filter((t) => t.enabled).length;
    const collapsed = group ? !!group.collapsed : false;
    const isRenaming = group && editingGroupId === group.id;
    const isBulkOpen = group && bulkGroupId === group.id;
    const isDropping = dropGroupKey === key && (dragTargetId !== null || dragGroupId !== null);

    return (
      <div
        key={group ? group.id : '__ungrouped__'}
        onDragOver={(e) => onGroupDragOver(e, key)}
        onDrop={(e) => onGroupDrop(e, key)}
        className={`rounded-xl border transition-colors ${
          isDropping
            ? 'border-emerald-500/70 bg-emerald-950/20'
            : 'border-slate-800/70 bg-slate-950/30'
        }`}
      >
        {/* Header */}
        <div className="flex items-center gap-1.5 px-1.5 py-1.5">
          {group ? (
            <div
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(GROUP_MIME, group.id);
                e.dataTransfer.effectAllowed = 'move';
                setDragGroupId(group.id);
              }}
              onDragEnd={clearDragState}
              className="shrink-0 text-slate-500 hover:text-emerald-400 cursor-grab active:cursor-grabbing"
              title="拖曳可調整子目錄順序"
            >
              <GripVertical className="w-3 h-3" />
            </div>
          ) : (
            <span className="w-3 shrink-0" />
          )}

          <button
            type="button"
            onClick={() => group && toggleGroupCollapsed(group)}
            disabled={!group}
            className="shrink-0 text-slate-400 hover:text-white transition-colors cursor-pointer disabled:cursor-default"
            title={collapsed ? '展開子目錄' : '收合子目錄'}
          >
            {group && collapsed ? (
              <Folder className="w-3.5 h-3.5 text-amber-400" />
            ) : (
              <FolderOpen className="w-3.5 h-3.5 text-amber-400" />
            )}
          </button>
          {isRenaming ? (
            <input
              type="text"
              value={tempGroupName}
              onChange={(e) => setTempGroupName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveGroupRename(group!);
                if (e.key === 'Escape') setEditingGroupId(null);
              }}
              onBlur={() => handleSaveGroupRename(group!)}
              className="bg-slate-950 border border-emerald-500 rounded px-1.5 py-0.5 text-[11px] text-white font-bold w-[120px] focus:outline-none"
              autoFocus
            />
          ) : (
            <span
              onClick={() => {
                if (!group) return;
                setEditingGroupId(group.id);
                setTempGroupName(group.name);
              }}
              className={`text-[11px] font-bold truncate ${
                group ? 'text-white cursor-pointer hover:text-emerald-400' : 'text-slate-400'
              }`}
              title={group ? '點擊修改子目錄名稱' : '不屬於任何子目錄的目標'}
            >
              {group ? group.name : '未分類'}
            </span>
          )}

          <span className="px-1.5 rounded-full text-[9px] font-bold bg-slate-800 text-emerald-400 border border-slate-700 shrink-0">
            {enabledCount}/{items.length}
          </span>

          <div className="flex-1" />

          {group && (
            <>
              <button
                type="button"
                onClick={() => setBulkGroupId(isBulkOpen ? null : group.id)}
                className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-semibold border transition-colors cursor-pointer ${
                  isBulkOpen
                    ? 'bg-indigo-600/30 text-indigo-200 border-indigo-500/50'
                    : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                }`}
                title="一次編輯這個子目錄裡的所有目標"
              >
                <Layers className="w-2.5 h-2.5" />
                批次
              </button>
              <button
                type="button"
                onClick={() => {
                  if (
                    items.length === 0 ||
                    window.confirm(
                      `刪除子目錄「${group.name}」？裡面的 ${items.length} 個目標會移到未分類，不會被刪除。`
                    )
                  ) {
                    if (bulkGroupId === group.id) setBulkGroupId(null);
                    onDeleteGroup(group.id);
                  }
                }}
                className="p-0.5 text-slate-500 hover:text-rose-400 transition-colors cursor-pointer"
                title="刪除子目錄（目標會移到未分類）"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </>
          )}
        </div>

        {/* Bulk edit panel */}
        {group && isBulkOpen && (
          <GroupBulkEditPanel
            items={items}
            onBulkUpdateTargets={onBulkUpdateTargets}
            onDeleteTargets={(ids) => {
              setBulkGroupId(null);
              onDeleteTargets(ids);
            }}
            masterVolume={masterVolume}
          />
        )}

        {/* Cards */}
        {!collapsed && (
          <div className="px-1.5 pb-1.5 space-y-2">
            {items.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-700 py-2 text-center text-[10px] text-slate-500">
                把目標卡片拖到這裡
              </div>
            ) : (
              items.map((t) => renderCard(t))
            )}
          </div>
        )}
      </div>
    );
  };
  const hasGroups = groups.length > 0;

  return (
    <div className="flex flex-col h-full w-full bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl min-h-0">
      {/* Fixed header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-950/80 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center shrink-0">
            <TargetIcon className="w-4 h-4 text-emerald-400" />
          </div>
          <h2 className="text-xs font-bold text-white flex items-center gap-1.5">
            偵測目標清單
            <span className="px-1.5 rounded-full text-[10px] font-bold bg-slate-800 text-emerald-400 border border-slate-700">
              {targets.length}
            </span>
          </h2>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onAddGroup}
            className="flex items-center gap-1 px-2 py-1.5 rounded-xl text-[11px] font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer"
            title="新增一個子目錄，之後把卡片拖進去"
          >
            <FolderPlus className="w-3.5 h-3.5 text-amber-400" />
            子目錄
          </button>
          <button
            type="button"
            onClick={onOpenNewCrop}
            className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-950/40 transition-colors cursor-pointer"
            title="從畫面截圖新增偵測目標"
          >
            <Camera className="w-3.5 h-3.5" />
            截圖新增
          </button>
        </div>
      </div>
      {/* Scrolling body — this is what makes the number of targets unlimited. */}
      <div className="flex-1 p-3 space-y-2.5 overflow-y-auto min-h-0">
        {targets.length === 0 && !hasGroups ? (
          <div className="h-full flex flex-col items-center justify-center text-center gap-2 py-8">
            <div className="w-12 h-12 rounded-2xl bg-slate-800/60 border border-slate-700 flex items-center justify-center">
              <TargetIcon className="w-6 h-6 text-slate-500" />
            </div>
            <p className="text-xs text-slate-400 font-semibold">還沒有偵測目標</p>
            <p className="text-[11px] text-slate-500 leading-relaxed max-w-[220px]">
              先在上方選擇要監看的畫面，然後按「截圖新增」框選要偵測的圖片。
            </p>
          </div>
        ) : hasGroups ? (
          <>
            {groups.map((g) => renderSection(g))}
            {renderSection(null)}
          </>
        ) : (
          targets.map((t) => renderCard(t))
        )}
      </div>
    </div>
  );
};
