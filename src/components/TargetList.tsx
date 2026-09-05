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
  Clock,
  Sliders,
  Mic,
  Camera,
  Pencil,
  Check,
  Play,
  Bell,
  Monitor,
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

/** 滑桿軌道的填色量。min/max 不是 0/100 的滑桿要先換算成百分比。 */
const fillPercent = (value: number, min: number, max: number) =>
  `${((value - min) / (max - min)) * 100}%`;

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

    // 分數藥丸：命中＝綠、接近門檻＝琥珀、其餘＝灰。沒開或沒串流時不給假數字。
    const isLive = target.enabled && isStreamActive;
    const scoreTone = !isLive
      ? ''
      : currentScore >= thresholdPercent
      ? ' on'
      : currentScore >= thresholdPercent * 0.7
      ? ' near'
      : '';
    const volumePercent = Math.round((target.volume ?? 0.8) * 100);
    const speechPercent = Math.round((target.speechVolume ?? 1) * 100);

    return (
      <article
        key={target.id}
        onDragOver={(e) => onCardDragOver(e, target)}
        onDrop={(e) => onCardDrop(e, target)}
        className={`card${isHit ? ' hit' : ''}${target.enabled ? '' : ' off'}${
          isDragging ? ' dragging' : ''
        }${hintBefore ? ' insert' : ''}`}
        /* .insert 只畫上緣那條線；落在下緣時同一條線要移到底部，所以走 inline。 */
        style={hintAfter ? { boxShadow: '0 2px 0 0 var(--acc-txt)' } : undefined}
      >
        <div className="top">
          {/* 只有把手可拖，卡片裡的滑桿與輸入框才不會被拖曳搶走 */}
          <span
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(TARGET_MIME, target.id);
              e.dataTransfer.effectAllowed = 'move';
              setDragTargetId(target.id);
            }}
            onDragEnd={clearDragState}
            className="grip"
            title="拖曳可調整順序，或拖到其他子目錄"
          >
            <GripVertical />
          </span>

          {/* 縮圖。左邊那條 3px 是目標色，滑到卡片上才浮出「重新截圖」 */}
          <div className="pic" style={{ '--tc': target.color } as React.CSSProperties}>
            <i className="swb" />
            <img src={target.imageDataUrl} alt={target.name} />
            <button
              type="button"
              onClick={() => onEditTarget(target)}
              className="ov"
              aria-label="重新截圖/編輯區域"
              title="重新截圖/編輯區域"
            >
              <Edit2 />
            </button>
          </div>

          <div className="meta">
            <div className="name">
              {isEditingThisName ? (
                <>
                  <input
                    type="text"
                    value={tempName}
                    onChange={(e) => setTempName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveRename(target);
                      if (e.key === 'Escape') setEditingNameId(null);
                    }}
                    onBlur={() => handleSaveRename(target)}
                    className="rename"
                    style={{ width: 130 }}
                    aria-label="目標名稱"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => handleSaveRename(target)}
                    className="btn mini ico-only"
                    style={{ color: 'var(--acc-txt)' }}
                    aria-label="完成改名"
                    title="完成改名"
                  >
                    <Check />
                  </button>
                </>
              ) : (
                <>
                  <b onClick={() => handleStartRename(target)} title="點擊直接修改名稱" style={{ cursor: 'pointer' }}>
                    {target.name}
                  </b>
                  <button
                    type="button"
                    onClick={() => handleStartRename(target)}
                    className="btn mini ico-only hoveronly"
                    aria-label="修改名稱"
                    title="點擊修改名稱"
                  >
                    <Pencil />
                  </button>
                  <span className={`score num${scoreTone}`}>{isLive ? `${currentScore}%` : '—'}</span>
                  {!target.enabled && <span className="tag">已停用</span>}
                </>
              )}
            </div>

            <div className="sub">
              <span>
                {target.imageWidth}×{target.imageHeight}
              </span>
              <span className="s" />
              <span>{hasRoi ? '指定區域' : '全螢幕'}</span>
              <span className="d1">
                <span className="s" />
                <span className="num">門檻 {thresholdPercent}%</span>
              </span>
            </div>
          </div>

          <div className="acts">
            <button
              type="button"
              onClick={() => onDuplicateTarget(target)}
              className="btn mini ico-only hoveronly"
              aria-label="複製目標"
              title="複製目標"
            >
              <Copy />
            </button>
            <button
              type="button"
              onClick={() => onEditTarget(target)}
              className="btn mini ico-only hoveronly"
              aria-label="重新截圖/編輯區域"
              title="重新截圖/編輯區域"
            >
              <Edit2 />
            </button>
            <button
              type="button"
              onClick={() => onDeleteTarget(target.id)}
              className="btn mini ico-only hoveronly"
              style={{ color: 'var(--bad)' }}
              aria-label="刪除目標"
              title="刪除目標"
            >
              <Trash2 />
            </button>
            <button
              type="button"
              onClick={() => toggleExpand(target.id)}
              className="btn mini ico-only"
              style={isExpanded ? { color: 'var(--acc-txt)' } : undefined}
              aria-expanded={isExpanded}
              aria-label={isExpanded ? '收合詳細設定' : '展開詳細設定'}
              title={isExpanded ? '收合詳細設定' : '展開調整相似度門檻、冷卻時間與區域'}
            >
              {isExpanded ? <ChevronUp /> : <ChevronDown />}
            </button>
            {/* 啟用開關：旋鈕位置本身就是狀態，不需要再寫「啟用／停用」四個字 */}
            <button
              type="button"
              role="switch"
              aria-checked={target.enabled}
              onClick={() => handleToggleEnabled(target)}
              className="sw"
              aria-label="啟用此目標"
              title={target.enabled ? '已啟用（點擊停用）' : '已停用（點擊啟用）'}
            >
              <i />
            </button>
          </div>
        </div>

        {isExpanded && (
          <div className="expand">
            <div className="list">
              <div className="row stack">
                <div className="head">
                  <span className="lab">
                    <Sliders />
                    相似度門檻
                  </span>
                  <span className="val num">
                    <b>{thresholdPercent}%</b>
                    <span className="s" />
                    即時{' '}
                    <b
                      style={{
                        color:
                          scoreTone === ' on'
                            ? 'var(--ok)'
                            : scoreTone === ' near'
                            ? 'var(--warn)'
                            : undefined,
                      }}
                    >
                      {isLive ? `${currentScore}%` : '--'}
                    </b>
                  </span>
                </div>
                <input
                  type="range"
                  min="50"
                  max="99"
                  value={thresholdPercent}
                  onChange={(e) => handleThresholdChange(target, Number(e.target.value))}
                  style={{ '--p': fillPercent(thresholdPercent, 50, 99) } as React.CSSProperties}
                  aria-label="相似度門檻"
                />
              </div>

              <div className="row">
                <span className="lab">
                  <Clock />
                  冷卻
                </span>
                <input
                  type="number"
                  min="1"
                  max="60"
                  value={target.cooldownSeconds}
                  onChange={(e) => handleCooldownChange(target, Math.max(1, Number(e.target.value)))}
                  className="field num"
                  style={{ width: 52 }}
                  aria-label="冷卻秒數"
                />
                <span className="val">秒</span>
                {isCoolingDown && (
                  <span className="tag ok" title="冷卻中，剩餘秒數">
                    {cooldownRemaining}s
                  </span>
                )}
              </div>

              <div className="row">
                <span className="lab">
                  <Monitor />
                  區域
                </span>
                <button
                  type="button"
                  onClick={() => onOpenRoiModal(target)}
                  disabled={!isStreamActive}
                  className="btn mini"
                  title={isStreamActive ? '在畫面上框選只偵測的區域' : '要先開始擷取畫面才能框選區域'}
                >
                  {hasRoi ? '重設' : '框選'}
                </button>
                {hasRoi && (
                  <button
                    type="button"
                    onClick={() => handleClearRoi(target)}
                    className="btn mini ico-only"
                    aria-label="清除自訂區域（改為全畫面）"
                    title="清除自訂區域 (改為全畫面)"
                  >
                    <RotateCcw />
                  </button>
                )}
              </div>

              <div className="row">
                <span className="lab">
                  <Bell />
                  提示音
                </span>
                <select
                  value={target.soundType}
                  onChange={(e) => handleSoundChange(target, e.target.value as SoundType)}
                  className="field"
                  style={{ width: 104 }}
                  aria-label="提示音"
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
                  className="btn mini"
                  title="試聽音效"
                >
                  <Play />
                  試聽
                </button>
              </div>

              <div className="row stack">
                <div className="head">
                  <span className="lab">
                    <Mic />
                    語音朗讀
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={!!target.speakName}
                    onClick={() => handleSpeechToggle(target)}
                    className="sw sm"
                    aria-label="語音朗讀"
                    title="偵測到時朗讀目標名稱"
                  >
                    <i />
                  </button>
                </div>
                <div className="grid2" style={{ alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <Volume2 style={{ width: 13, height: 13, color: 'var(--dim2)', flex: 'none' }} />
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={volumePercent}
                      onChange={(e) =>
                        onUpdateTarget({ ...target, volume: Number(e.target.value) / 100 })
                      }
                      style={{ '--p': `${volumePercent}%` } as React.CSSProperties}
                      aria-label="提示音量"
                      title="這個目標的提示音量"
                    />
                    <span className="val num" style={{ width: 34, textAlign: 'right' }}>
                      {volumePercent}%
                    </span>
                  </div>
                  {/* 語音音量：沒開朗讀時整組淡化，但不停用——他可能想先調好再開 */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 7,
                      opacity: target.speakName ? 1 : 0.5,
                    }}
                  >
                    <Mic style={{ width: 13, height: 13, color: 'var(--dim2)', flex: 'none' }} />
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={speechPercent}
                      onChange={(e) =>
                        onUpdateTarget({ ...target, speechVolume: Number(e.target.value) / 100 })
                      }
                      style={{ '--p': `${speechPercent}%` } as React.CSSProperties}
                      aria-label="語音音量"
                      title={
                        target.speakName
                          ? '這個目標朗讀名稱時的音量'
                          : '先開啟「語音朗讀」才會用到這個音量'
                      }
                    />
                    <span className="val num" style={{ width: 34, textAlign: 'right' }}>
                      {speechPercent}%
                    </span>
                    <button
                      type="button"
                      onClick={() => speakAlert(`偵測到 ${target.name}`, target.speechVolume ?? 1)}
                      className="btn mini ico-only"
                      aria-label="試聽語音"
                      title="試聽語音"
                    >
                      <Mic />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </article>
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
        className="tgroup"
        style={isDropping ? { borderColor: 'var(--acc)' } : undefined}
      >
        <div className="ghead">
          {group ? (
            <span
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(GROUP_MIME, group.id);
                e.dataTransfer.effectAllowed = 'move';
                setDragGroupId(group.id);
              }}
              onDragEnd={clearDragState}
              className="grip"
              title="拖曳可調整子目錄順序"
            >
              <GripVertical />
            </span>
          ) : (
            /* 未分類沒有把手，但要留同寬的位置，兩個群組列的字才對得齊 */
            <span style={{ width: 14, flex: 'none' }} />
          )}

          <button
            type="button"
            onClick={() => group && toggleGroupCollapsed(group)}
            disabled={!group}
            className="btn mini ico-only"
            style={{ color: 'var(--warn)' }}
            aria-expanded={!collapsed}
            aria-label={collapsed ? '展開子目錄' : '收合子目錄'}
            title={collapsed ? '展開子目錄' : '收合子目錄'}
          >
            {group && collapsed ? <Folder /> : <FolderOpen />}
          </button>

          <span className="gname">
            {isRenaming ? (
              <>
                <input
                  type="text"
                  value={tempGroupName}
                  onChange={(e) => setTempGroupName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveGroupRename(group!);
                    if (e.key === 'Escape') setEditingGroupId(null);
                  }}
                  onBlur={() => handleSaveGroupRename(group!)}
                  className="rename"
                  aria-label="子目錄名稱"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => handleSaveGroupRename(group!)}
                  className="btn mini ico-only"
                  style={{ color: 'var(--acc-txt)' }}
                  aria-label="完成改名"
                  title="完成改名"
                >
                  <Check />
                </button>
              </>
            ) : (
              <b
                onClick={() => {
                  if (!group) return;
                  setEditingGroupId(group.id);
                  setTempGroupName(group.name);
                }}
                style={group ? { cursor: 'pointer' } : { color: 'var(--dim)' }}
                title={group ? '點擊修改子目錄名稱' : '不屬於任何子目錄的目標'}
              >
                {group ? group.name : '未分類'}
              </b>
            )}
            <span className="count" title="啟用數／總數">
              {enabledCount}/{items.length}
            </span>
          </span>

          {group && (
            <>
              <button
                type="button"
                onClick={() => setBulkGroupId(isBulkOpen ? null : group.id)}
                className="btn mini"
                aria-pressed={!!isBulkOpen}
                style={isBulkOpen ? { color: 'var(--acc-txt)' } : undefined}
                title="一次編輯這個子目錄裡的所有目標"
              >
                <Layers />
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
                className="btn mini ico-only hoveronly"
                style={{ color: 'var(--bad)' }}
                aria-label="刪除子目錄"
                title="刪除子目錄（目標會移到未分類）"
              >
                <Trash2 />
              </button>
            </>
          )}
        </div>

        {/* 收合時卡片收起來，但批次面板還是要看得到（他可能只是想少看幾張卡） */}
        {(!collapsed || isBulkOpen) && (
          <div className="gbody">
            {!collapsed &&
              (items.length === 0 ? (
                <div className={`dropzone${isDropping ? ' on' : ''}`}>把目標卡片拖到這裡</div>
              ) : (
                items.map((t) => renderCard(t))
              ))}

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
          </div>
        )}
      </div>
    );
  };

  const hasGroups = groups.length > 0;

  return (
    <section className="panel targets">
      <header>
        <h3>偵測目標清單</h3>
        <span className="count">{targets.length}</span>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={onAddGroup}
          className="btn mini"
          title="新增一個子目錄，之後把卡片拖進去"
        >
          <FolderPlus />
          子目錄
        </button>
        <button
          type="button"
          onClick={onOpenNewCrop}
          className="btn pri"
          style={{ height: 24, padding: '0 8px', fontSize: 'var(--fs0)' }}
          title="從畫面截圖新增偵測目標"
        >
          <Camera style={{ width: 13, height: 13 }} />
          截圖新增
        </button>
      </header>

      {/* 捲動區——目標數量不設上限就是靠這裡 */}
      <div className="body">
        {targets.length === 0 && !hasGroups ? (
          <div className="empty">
            <TargetIcon />
            <p style={{ color: 'var(--dim)', fontWeight: 600 }}>還沒有偵測目標</p>
            <p style={{ maxWidth: 220, lineHeight: 1.65 }}>
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
    </section>
  );
};
