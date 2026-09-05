import React, { useState, useEffect } from 'react';
import { Target, ImageComboRule, CooldownTimer, SoundType } from '../types';
import { playAlertSound, speakAlert } from '../utils/audio';
import { normalizeHotkeyName } from '../utils/hotkeys';
import {
  Sparkles,
  MousePointerClick,
  Clock,
  Plus,
  Trash2,
  Play,
  RotateCcw,
  Layers,
  ChevronRight,
  Maximize2,
  X,
  Crosshair,
  Camera,
  FolderOpen,
  Mic,
  Pencil,
  Check,
  Zap,
  Monitor,
  Target as TargetIcon,
} from 'lucide-react';

interface AutomationAndTimersProps {
  targets: Target[];
  rules: ImageComboRule[];
  onUpdateRules: (rules: ImageComboRule[]) => void;
  timers: CooldownTimer[];
  onUpdateTimers: (timers: CooldownTimer[]) => void;
  isStreamActive: boolean;
  onOpenCropForTimer: (timerId?: string, onDone?: (dataUrl: string) => void) => void;
  masterVolume: number;
  speechVolume: number;
  showFloatingWidget: boolean;
  onToggleFloatingWidget: (show: boolean) => void;
  floatingOpacity: number;
  onChangeFloatingOpacity: (opacity: number) => void;
  floatingLayout: 'horizontal' | 'vertical';
  onChangeFloatingLayout: (layout: 'horizontal' | 'vertical') => void;
  floatingIconSize?: number;
  onChangeFloatingIconSize?: (size: number) => void;
  floatingTextSize?: number;
  onChangeFloatingTextSize?: (size: number) => void;
  floatingShowName?: boolean;
  onToggleFloatingShowName?: (show: boolean) => void;
}

export const AutomationAndTimers: React.FC<AutomationAndTimersProps> = ({
  targets,
  rules,
  onUpdateRules,
  timers,
  onUpdateTimers,
  isStreamActive,
  onOpenCropForTimer,
  masterVolume,
  speechVolume,
  showFloatingWidget,
  onToggleFloatingWidget,
  floatingOpacity,
  onChangeFloatingOpacity,
  floatingLayout,
  onChangeFloatingLayout,
  floatingIconSize = 46,
  onChangeFloatingIconSize,
  floatingTextSize = 13,
  onChangeFloatingTextSize,
  floatingShowName = true,
  onToggleFloatingShowName,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'timers' | 'combo'>('timers');

  // Timer Form State
  const [isEditingTimer, setIsEditingTimer] = useState(false);
  const [editingTimerId, setEditingTimerId] = useState<string | null>(null);

  const [tName, setTName] = useState('魔消');
  const [tHotkey, setTHotkey] = useState('W');
  const [isRecordingHotkey, setIsRecordingHotkey] = useState(false);
  const [tMode, setTMode] = useState<'loop' | 'stop_on_zero' | 'two_phase'>('stop_on_zero');
  const [tDuration, setTDuration] = useState<number>(80.0);
  const [tDisplayMode, setTDisplayMode] = useState<'default' | 'cooldown' | 'original_only'>('default');
  const [tImageDataUrl, setTImageDataUrl] = useState<string>('');

  // Completion Notification (with independent volume)
  const [tSoundOnComplete, setTSoundOnComplete] = useState<boolean>(true);
  const [tSoundType, setTSoundType] = useState<SoundType>('double_ding');
  const [tVolume, setTVolume] = useState<number>(0.8);
  const [tSpeakOnComplete, setTSpeakOnComplete] = useState<boolean>(true);
  const [tCustomSpeakText, setTCustomSpeakText] = useState<string>('計時完成');

  // Lead Warning Notification (with independent volume)
  const [tLeadSeconds, setTLeadSeconds] = useState<number>(3);
  const [tSoundOnLead, setTSoundOnLead] = useState<boolean>(true);
  const [tLeadSoundType, setTLeadSoundType] = useState<SoundType>('beep');
  const [tLeadVolume, setTLeadVolume] = useState<number>(0.8);
  const [tSpeakOnLead, setTSpeakOnLead] = useState<boolean>(true);
  const [tCustomLeadSpeakText, setTCustomLeadSpeakText] = useState<string>('快好了');

  // Combo Rule Form State (Add / Edit)
  const [isEditingRule, setIsEditingRule] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [ruleName, setRuleName] = useState('');
  const [ruleTargetIdsA, setRuleTargetIdsA] = useState<string[]>([]);
  const [ruleTargetIdB, setRuleTargetIdB] = useState('');
  const [ruleAction, setRuleAction] = useState<'right_click_and_center' | 'left_click_and_center' | 'sound_only'>('right_click_and_center');
  const [ruleHotkey, setRuleHotkey] = useState('');
  const [isRecordingRuleHotkey, setIsRecordingRuleHotkey] = useState(false);
  const [ruleSoundType, setRuleSoundType] = useState<SoundType>('double_ding');
  const [ruleVolume, setRuleVolume] = useState<number>(0.8);
  const [ruleCooldown, setRuleCooldown] = useState(2);

  // Keyboard Hotkey Auto-Recording for Timers
  useEffect(() => {
    if (!isRecordingHotkey) return;

    const handleKeyRecord = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Escape 是「取消側錄」，所以它自己不能被錄成快捷鍵
      if (e.code === 'Escape' || e.key === 'Escape') {
        setIsRecordingHotkey(false);
        return;
      }

      // 認不出這一下是哪顆鍵（瀏覽器沒給 e.code 又被輸入法吃掉）就不要記，
      // 維持側錄狀態讓使用者再按一次 —— 存下認不出的名字等於做出一個永遠不會觸發的設定。
      const keyName = normalizeHotkeyName(e);
      if (!keyName) return;

      setTHotkey(keyName);
      setIsRecordingHotkey(false);
    };

    window.addEventListener('keydown', handleKeyRecord, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeyRecord, { capture: true });
    };
  }, [isRecordingHotkey]);

  // Keyboard Hotkey Auto-Recording for Combo Rules (Non-blocking)
  useEffect(() => {
    if (!isRecordingRuleHotkey) return;

    const handleRuleKeyRecord = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.code === 'Escape' || e.key === 'Escape') {
        setIsRecordingRuleHotkey(false);
        return;
      }

      const keyName = normalizeHotkeyName(e);
      if (!keyName) return;

      setRuleHotkey(keyName);
      setIsRecordingRuleHotkey(false);
    };

    window.addEventListener('keydown', handleRuleKeyRecord, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleRuleKeyRecord, { capture: true });
    };
  }, [isRecordingRuleHotkey]);

  // Open Timer Editor
  const handleOpenAddTimer = () => {
    setEditingTimerId(null);
    setTName(`計時 #${timers.length + 1}`);
    setTHotkey('W');
    setTMode('stop_on_zero');
    setTDuration(80.0);
    setTDisplayMode('default');
    setTImageDataUrl('');
    setTSoundOnComplete(true);
    setTSoundType('double_ding');
    setTVolume(0.8);
    setTSpeakOnComplete(true);
    setTCustomSpeakText('計時完成');
    setTLeadSeconds(3);
    setTSoundOnLead(true);
    setTLeadSoundType('beep');
    setTLeadVolume(0.8);
    setTSpeakOnLead(true);
    setTCustomLeadSpeakText('快好了');
    setIsEditingTimer(true);
  };

  const handleOpenEditTimer = (timer: CooldownTimer) => {
    setEditingTimerId(timer.id);
    setTName(timer.name);
    setTHotkey(timer.hotkey);
    setTMode(timer.mode || 'stop_on_zero');
    setTDuration(timer.durationSeconds);
    setTDisplayMode(timer.displayMode || 'default');
    setTImageDataUrl(timer.imageDataUrl || '');
    setTSoundOnComplete(timer.soundOnComplete ?? true);
    setTSoundType(timer.soundType || 'double_ding');
    setTVolume(timer.volume ?? 0.8);
    setTSpeakOnComplete(timer.speakOnComplete ?? true);
    setTCustomSpeakText(timer.customSpeakText ?? '計時完成');
    setTLeadSeconds(timer.leadSeconds ?? 3);
    setTSoundOnLead(timer.soundOnLead ?? true);
    setTLeadSoundType(timer.leadSoundType || 'beep');
    setTLeadVolume(timer.leadVolume ?? 0.8);
    setTSpeakOnLead(timer.speakOnLead ?? true);
    setTCustomLeadSpeakText(timer.customLeadSpeakText ?? '快好了');
    setIsEditingTimer(true);
  };

  const handleSaveTimer = (e: React.FormEvent) => {
    e.preventDefault();

    if (editingTimerId) {
      onUpdateTimers(
        timers.map((t) =>
          t.id === editingTimerId
            ? {
                ...t,
                name: tName.trim() || '未命名計時',
                hotkey: tHotkey.trim().toUpperCase() || 'W',
                mode: tMode,
                durationSeconds: Math.max(0.1, Number(tDuration)),
                displayMode: tDisplayMode,
                imageDataUrl: tImageDataUrl,
                soundOnComplete: tSoundOnComplete,
                soundType: tSoundType,
                volume: tVolume,
                speakOnComplete: tSpeakOnComplete,
                customSpeakText: tCustomSpeakText.trim(),
                leadSeconds: Math.max(0, Number(tLeadSeconds)),
                soundOnLead: tSoundOnLead,
                leadSoundType: tLeadSoundType,
                leadVolume: tLeadVolume,
                speakOnLead: tSpeakOnLead,
                customLeadSpeakText: tCustomLeadSpeakText.trim(),
              }
            : t
        )
      );
    } else {
      const newTimer: CooldownTimer = {
        id: `timer_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        name: tName.trim() || '未命名計時',
        hotkey: tHotkey.trim().toUpperCase() || 'W',
        mode: tMode,
        durationSeconds: Math.max(0.1, Number(tDuration)),
        remainingSeconds: Math.max(0.1, Number(tDuration)),
        isRunning: false,
        displayMode: tDisplayMode,
        imageDataUrl: tImageDataUrl,
        soundOnComplete: tSoundOnComplete,
        soundType: tSoundType,
        volume: tVolume,
        speakOnComplete: tSpeakOnComplete,
        customSpeakText: tCustomSpeakText.trim(),
        leadSeconds: Math.max(0, Number(tLeadSeconds)),
        soundOnLead: tSoundOnLead,
        leadSoundType: tLeadSoundType,
        leadVolume: tLeadVolume,
        speakOnLead: tSpeakOnLead,
        customLeadSpeakText: tCustomLeadSpeakText.trim(),
      };
      onUpdateTimers([...timers, newTimer]);
    }

    setIsEditingTimer(false);
  };

  const handleDeleteTimer = (id: string) => {
    onUpdateTimers(timers.filter((t) => t.id !== id));
  };

  const handleToggleTimerEnabled = (id: string) => {
    onUpdateTimers(
      timers.map((t) =>
        t.id === id
          ? { ...t, enabled: t.enabled === false ? true : false, isRunning: false, remainingSeconds: t.durationSeconds, startedAt: undefined, endsAt: undefined }
          : t
      )
    );
  };

  const handleStartTimer = (id: string) => {
    onUpdateTimers(
      timers.map((t) => {
        if (t.id === id) {
          return {
            ...t,
            isRunning: true,
            remainingSeconds: t.durationSeconds,
            startedAt: Date.now(),
            endsAt: Date.now() + t.durationSeconds * 1000,
            leadTriggered: false,
          };
        }
        return t;
      })
    );
  };

  const handleResetTimer = (id: string) => {
    onUpdateTimers(
      timers.map((t) => {
        if (t.id === id) {
          return {
            ...t,
            isRunning: false,
            remainingSeconds: t.durationSeconds,
            startedAt: undefined,
            endsAt: undefined,
            leadTriggered: false,
          };
        }
        return t;
      })
    );
  };

  // Combo Rules Handlers (Add / Edit / Delete / Toggle)
  const handleOpenAddRule = () => {
    setEditingRuleId(null);
    setRuleName(`條件點擊 #${rules.length + 1}`);
    setRuleTargetIdsA(targets.length > 0 ? [targets[0].id] : []);
    setRuleTargetIdB('');
    setRuleAction('right_click_and_center');
    setRuleHotkey('');
    setRuleSoundType('double_ding');
    setRuleVolume(0.8);
    setRuleCooldown(2);
    setIsEditingRule(true);
  };

  const handleOpenEditRule = (rule: ImageComboRule) => {
    setEditingRuleId(rule.id);
    setRuleName(rule.name);
    const existingA =
      rule.targetIdsA && rule.targetIdsA.length > 0
        ? rule.targetIdsA
        : rule.targetIdA
        ? [rule.targetIdA]
        : [];
    setRuleTargetIdsA(existingA);
    setRuleTargetIdB(rule.targetIdB || '');
    setRuleAction(rule.action);
    setRuleHotkey(rule.hotkey || '');
    setRuleSoundType(rule.soundType || 'double_ding');
    setRuleVolume(rule.volume ?? 0.8);
    setRuleCooldown(rule.cooldownSeconds || 2);
    setIsEditingRule(true);
  };

  const handleSaveRule = (e: React.FormEvent) => {
    e.preventDefault();
    if (ruleTargetIdsA.length === 0) {
      alert('請至少勾選一個「條件 1：當此圖片出現」的目標圖片！');
      return;
    }

    if (editingRuleId) {
      onUpdateRules(
        rules.map((r) =>
          r.id === editingRuleId
            ? {
                ...r,
                name: ruleName.trim() || '條件點擊',
                targetIdsA: ruleTargetIdsA,
                targetIdA: ruleTargetIdsA[0],
                targetIdB: ruleTargetIdB || undefined,
                action: ruleAction,
                hotkey: ruleHotkey.trim().toUpperCase(),
                soundType: ruleSoundType,
                volume: ruleVolume,
                cooldownSeconds: Math.max(1, Number(ruleCooldown)),
                returnToCenter: true,
              }
            : r
        )
      );
    } else {
      const newRule: ImageComboRule = {
        id: `rule_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        name: ruleName.trim() || `條件點擊 #${rules.length + 1}`,
        enabled: true,
        targetIdsA: ruleTargetIdsA,
        targetIdA: ruleTargetIdsA[0],
        targetIdB: ruleTargetIdB || undefined,
        action: ruleAction,
        hotkey: ruleHotkey.trim().toUpperCase(),
        soundType: ruleSoundType,
        volume: ruleVolume,
        cooldownSeconds: Math.max(1, Number(ruleCooldown)),
        returnToCenter: true,
      };
      onUpdateRules([...rules, newRule]);
    }

    setIsEditingRule(false);
    setEditingRuleId(null);
  };

  const handleDeleteRule = (id: string) => {
    onUpdateRules(rules.filter((r) => r.id !== id));
  };

  const handleToggleRule = (id: string) => {
    onUpdateRules(
      rules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r))
    );
  };

  const handleTestMouse = async () => {
    if (window.electronAPI?.performMouseAction) {
      await window.electronAPI.performMouseAction({
        action: 'right_click_and_center',
        screenX: window.screen.width / 2,
        screenY: window.screen.height / 2,
        returnToCenter: true,
      });
      playAlertSound('double_ding', masterVolume);
    } else {
      alert('滑鼠模擬動作已就緒（需在 Windows 原生執行檔環境下觸發）');
    }
  };

  return (
    <div className="page" style={{ gridTemplateColumns: 'minmax(0,1fr)' }}>
      {/* 頁首與子分頁：子分頁用的是頂列同一顆分段控制（滑塊左右滑） */}
      <div className="bar2" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <h2
            style={{
              margin: 0,
              fontSize: 'var(--fs3)',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Sparkles style={{ width: 15, height: 15, color: 'var(--acc-txt)' }} />
            進階聯動 ＆ 技能倒數計時組
          </h2>
          <p
            style={{
              margin: '3px 0 0',
              fontSize: 'var(--fs1)',
              color: 'var(--dim)',
              lineHeight: 1.5,
              maxWidth: '52ch',
            }}
          >
            配置按鍵技能倒數計時組與桌面置頂透明懸浮窗，或設定多圖命中自動右鍵點擊回中
          </p>
        </div>

        {/* Sub Navigation */}
        <div
          className="seg"
          role="tablist"
          style={{ '--n': 2, '--i': activeSubTab === 'timers' ? 0 : 1 } as React.CSSProperties}
        >
          <div className="seg-thumb" />
          <button
            type="button"
            role="tab"
            aria-selected={activeSubTab === 'timers'}
            onClick={() => setActiveSubTab('timers')}
          >
            <span className="emo">⏱️</span>
            技能計時組設定
            <span className="count">{timers.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeSubTab === 'combo'}
            onClick={() => setActiveSubTab('combo')}
          >
            <span className="emo">🖱️</span>
            條件觸發自動點擊
            <span className="count">{rules.length}</span>
          </button>
        </div>
      </div>

      {/* ── SUB-TAB 1: 技能計時組設定 ── */}
      {activeSubTab === 'timers' && (
        <div className="subgrid">
          {/* ── 計時組：卡片列表 ── */}
          <div className="full">
            <div className="bar2" style={{ justifyContent: 'space-between', marginBottom: 'var(--sp2)' }}>
              <h4 className="sect" style={{ margin: 0 }}>
                <Clock />
                計時組
              </h4>
              <button type="button" className="btn pri" onClick={handleOpenAddTimer}>
                <Plus />
                新增計時組設定
              </button>
            </div>
            {timers.length === 0 ? (
              <div className="empty">
                <Clock />
                <p style={{ color: 'var(--dim)', fontWeight: 600 }}>尚未建立任何技能計時組</p>
                <p style={{ maxWidth: 320, lineHeight: 1.65 }}>
                  點擊上方「新增計時組設定」，配置熱鍵（如 W、F1）、倒數秒數與技能圖示，懸浮窗即可即時顯示！
                </p>
              </div>
            ) : (
              <div className="cards">
                {timers.map((timer) => {
                  const isEnabled = timer.enabled !== false;
                  const isRunning = isEnabled && !!timer.isRunning;
                  const percent = isRunning
                    ? Math.max(0, Math.min(100, (timer.remainingSeconds / timer.durationSeconds) * 100))
                    : 0;

                  return (
                    <div key={timer.id} className={`tcard${isEnabled ? '' : ' off'}`}>
                      {isRunning && (
                        <div className="prog" style={{ '--w': `${percent}%` } as React.CSSProperties} />
                      )}
                      <div className="in">
                        <div className="r1">
                          <span className="ticon">
                            {timer.imageDataUrl ? (
                              <img
                                src={timer.imageDataUrl}
                                alt={timer.name}
                                style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 1 }}
                              />
                            ) : (
                              <span
                                className="num"
                                style={{
                                  fontSize: 10,
                                  lineHeight: 1.15,
                                  padding: '0 2px',
                                  textAlign: 'center',
                                  color: 'var(--warn)',
                                  fontWeight: 600,
                                }}
                              >
                                {timer.hotkey}
                              </span>
                            )}
                          </span>
                          <div className="nm">
                            <b title={timer.name}>{timer.name}</b>
                            {!isEnabled && <span className="tag">已停用</span>}
                          </div>
                          <button
                            type="button"
                            className="btn mini ico-only"
                            onClick={() => handleOpenEditTimer(timer)}
                            aria-label="修改計時設定"
                            title="修改計時設定"
                          >
                            <Pencil />
                          </button>
                          <button
                            type="button"
                            className="btn mini ico-only"
                            onClick={() => handleDeleteTimer(timer.id)}
                            aria-label="刪除計時組"
                            title="刪除計時組"
                            style={{ color: 'var(--bad)' }}
                          >
                            <Trash2 />
                          </button>
                          <button
                            type="button"
                            className="sw sm"
                            role="switch"
                            aria-checked={isEnabled}
                            onClick={() => handleToggleTimerEnabled(timer.id)}
                            aria-label={isEnabled ? '點擊停用此計時器' : '點擊啟用此計時器'}
                            title={isEnabled ? '點擊停用此計時器' : '點擊啟用此計時器'}
                          >
                            <i />
                          </button>
                        </div>
                        <div className={`bigcount${isRunning ? ' run' : ''}`}>
                          {isEnabled ? timer.remainingSeconds.toFixed(1) : '——'}
                          <small> / {timer.durationSeconds}s</small>
                        </div>
                        {timer.hotkey && (
                          <div className="fsub">
                            <span className="hk" style={{ height: 19, padding: '0 5px' }} title="快捷鍵">
                              {timer.hotkey}
                            </span>
                          </div>
                        )}
                        <div className="foot">
                          <button
                            type="button"
                            className="btn mini ico-only"
                            onClick={() => onOpenCropForTimer(timer.id)}
                            aria-label="從當前畫面截圖作為圖示"
                            title="從當前畫面截圖作為圖示"
                          >
                            <Camera />
                          </button>
                          <div style={{ flex: 1 }} />
                          <button
                            type="button"
                            className="btn mini"
                            onClick={() => isEnabled && handleStartTimer(timer.id)}
                            disabled={!isEnabled}
                          >
                            <Play />
                            觸發
                          </button>
                          <button
                            type="button"
                            className="btn mini ico-only"
                            onClick={() => isEnabled && handleResetTimer(timer.id)}
                            disabled={!isEnabled}
                            aria-label="重設計時"
                            title="重設計時"
                          >
                            <RotateCcw />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── 計時組設定：新增／修改同一份表單 ── */}
          {isEditingTimer && (
            <div className="full">
              <div className="bar2" style={{ justifyContent: 'space-between', marginBottom: 'var(--sp2)' }}>
                <h4 className="sect" style={{ margin: 0 }}>
                  <Clock />
                  計時組設定
                </h4>
                <button
                  type="button"
                  className="btn mini ico-only"
                  onClick={() => setIsEditingTimer(false)}
                  aria-label="關閉計時組設定"
                  title="關閉計時組設定"
                >
                  <X />
                </button>
              </div>
              <form onSubmit={handleSaveTimer} className="box">
                <div className="form">
                  <div className="frow">
                    <span className="fl">計時名稱</span>
                    <input
                      type="text"
                      className="field"
                      style={{ flex: 1, minWidth: 0 }}
                      value={tName}
                      onChange={(e) => setTName(e.target.value)}
                      placeholder="例如：魔消"
                      aria-label="計時名稱"
                      required
                    />
                  </div>

                  <div className="frow">
                    <span className="fl">快捷鍵</span>
                    <span
                      className={`hk${isRecordingHotkey ? ' rec' : ''}`}
                      style={
                        !isRecordingHotkey && !tHotkey
                          ? { color: 'var(--dim2)', fontWeight: 500 }
                          : undefined
                      }
                    >
                      {isRecordingHotkey ? '請在鍵盤按下按鍵…' : tHotkey || '未設定'}
                    </span>
                    <button type="button" className="btn mini" onClick={() => setIsRecordingHotkey(true)}>
                      <Zap />
                      點擊設定
                    </button>
                    <button
                      type="button"
                      className="btn mini ico-only"
                      onClick={() => setTHotkey('')}
                      aria-label="清除快捷鍵"
                      title="清除快捷鍵"
                      style={{ color: 'var(--bad)' }}
                    >
                      <X />
                    </button>
                  </div>

                  <div className="frow">
                    <span className="fl">倒數模式</span>
                    <div className="radios">
                      <label>
                        <input type="radio" name="tMode" checked={tMode === 'loop'} onChange={() => setTMode('loop')} />
                        <span>自動循環</span>
                      </label>
                      <label>
                        <input
                          type="radio"
                          name="tMode"
                          checked={tMode === 'stop_on_zero'}
                          onChange={() => setTMode('stop_on_zero')}
                        />
                        <span>倒數後停止</span>
                      </label>
                      <label>
                        <input
                          type="radio"
                          name="tMode"
                          checked={tMode === 'two_phase'}
                          onChange={() => setTMode('two_phase')}
                        />
                        <span>雙回合切換</span>
                      </label>
                    </div>
                  </div>

                  <div className="frow">
                    <span className="fl">倒數時間</span>
                    <input
                      type="number"
                      className="field num"
                      style={{ width: 66 }}
                      step="0.1"
                      min="0.1"
                      max="9999"
                      value={tDuration}
                      onChange={(e) => setTDuration(Math.max(0.1, Number(e.target.value)))}
                      aria-label="倒數時間（秒）"
                    />
                    <span className="val">秒</span>
                  </div>

                  <div className="frow">
                    <span className="fl">圖示效果</span>
                    <div className="radios">
                      <label>
                        <input
                          type="radio"
                          name="tDisplayMode"
                          checked={tDisplayMode === 'default'}
                          onChange={() => setTDisplayMode('default')}
                        />
                        <span>預設</span>
                      </label>
                      <label>
                        <input
                          type="radio"
                          name="tDisplayMode"
                          checked={tDisplayMode === 'cooldown'}
                          onChange={() => setTDisplayMode('cooldown')}
                        />
                        <span>冷卻模式</span>
                      </label>
                      <label>
                        <input
                          type="radio"
                          name="tDisplayMode"
                          checked={tDisplayMode === 'original_only'}
                          onChange={() => setTDisplayMode('original_only')}
                        />
                        <span>僅用原圖</span>
                      </label>
                    </div>
                  </div>

                  <div className="frow">
                    <span className="fl">圖片（圖示）</span>
                    <span className="ticon" style={{ width: 32, height: 32 }}>
                      {tImageDataUrl ? (
                        <img
                          src={tImageDataUrl}
                          alt="計時圖示"
                          style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 1 }}
                        />
                      ) : (
                        <span style={{ fontSize: 10, color: 'var(--dim2)' }}>無</span>
                      )}
                    </span>
                    <input
                      type="text"
                      className="field"
                      style={{ width: 150, flex: 'none' }}
                      value={tImageDataUrl ? `${tName || '未命名'}_icon.png` : '尚未設定圖示'}
                      readOnly
                      aria-label="目前的圖示來源"
                    />
                    <button
                      type="button"
                      className="btn mini"
                      onClick={() =>
                        onOpenCropForTimer(editingTimerId || undefined, (url) => setTImageDataUrl(url))
                      }
                    >
                      <Camera />
                      截圖圖示
                    </button>
                    <label className="btn mini">
                      <FolderOpen />
                      瀏覽照片
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) {
                            const reader = new FileReader();
                            reader.onload = (re) => {
                              const url = re.target?.result as string;
                              if (url) setTImageDataUrl(url);
                            };
                            reader.readAsDataURL(f);
                          }
                        }}
                        className="hide"
                      />
                    </label>
                  </div>

                </div>

                {/* ── A：倒數完成提示音效 ＆ 語音朗讀（含獨立音量） ── */}
                <h5 className="sect" style={{ margin: 'var(--sp3) 0 var(--sp2)' }}>
                  A · 倒數完成提示（結束時觸發）
                </h5>
                <div className="form">
                  <div className="frow">
                    <label className="ckl">
                      <input
                        type="checkbox"
                        checked={tSoundOnComplete}
                        onChange={(e) => setTSoundOnComplete(e.target.checked)}
                      />
                      <span>播放完成音效</span>
                    </label>
                    <select
                      className="field"
                      style={{ width: 112 }}
                      value={tSoundType}
                      disabled={!tSoundOnComplete}
                      onChange={(e) => setTSoundType(e.target.value as SoundType)}
                      aria-label="完成音效"
                    >
                      <option value="double_ding">🎯 雙音</option>
                      <option value="chime">🔔 清脆鈴聲</option>
                      <option value="beep">🚨 電子嗶嗶聲</option>
                      <option value="fanfare">🎺 勝利號角</option>
                      <option value="coin">🪙 遊戲金幣聲</option>
                      <option value="siren">⚠️ 急促警報</option>
                    </select>
                    <button
                      type="button"
                      className="btn mini"
                      onClick={() => playAlertSound(tSoundType, tVolume * masterVolume)}
                    >
                      <Play />
                      測試
                    </button>
                  </div>
                  <div className="frow">
                    <span className="fl">完成音效音量</span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      disabled={!tSoundOnComplete}
                      value={Math.round(tVolume * 100)}
                      onChange={(e) => setTVolume(Number(e.target.value) / 100)}
                      style={
                        {
                          flex: 1,
                          minWidth: 80,
                          '--p': `${Math.round(tVolume * 100)}%`,
                        } as React.CSSProperties
                      }
                      aria-label="完成音效音量"
                    />
                    <span className="val num" style={{ width: 34, textAlign: 'right' }}>
                      {Math.round(tVolume * 100)}%
                    </span>
                  </div>

                  <div className="frow">
                    <label className="ckl">
                      <input
                        type="checkbox"
                        checked={tSpeakOnComplete}
                        onChange={(e) => setTSpeakOnComplete(e.target.checked)}
                      />
                      <span>語音說出名稱</span>
                    </label>
                    <span className="fsub">後面接：</span>
                    <input
                      type="text"
                      className="field"
                      style={{ flex: 1, minWidth: 96 }}
                      disabled={!tSpeakOnComplete}
                      value={tCustomSpeakText}
                      onChange={(e) => setTCustomSpeakText(e.target.value)}
                      placeholder="例如：計時完成 / 冷卻好了"
                      aria-label="完成語音自訂文字"
                    />
                    <button
                      type="button"
                      className="btn mini"
                      onClick={() => speakAlert(`${tName} ${tCustomSpeakText}`, speechVolume)}
                    >
                      <Mic />
                      試聽語音
                    </button>
                  </div>
                </div>

                {/* ── B：提前提醒音效 ＆ 語音朗讀（含獨立音量） ── */}
                <h5 className="sect" style={{ margin: 'var(--sp3) 0 var(--sp2)' }}>
                  B · 提前提醒（0 代表不提前）
                </h5>
                <div className="form">
                  <div className="frow">
                    <span className="fl">提前幾秒</span>
                    <input
                      type="number"
                      className="field num"
                      style={{ width: 56 }}
                      min="0"
                      max="60"
                      value={tLeadSeconds}
                      onChange={(e) => setTLeadSeconds(Number(e.target.value))}
                      aria-label="提前幾秒"
                    />
                    <span className="val">秒</span>
                    <span className="fsub">設 0 則不提前提醒</span>
                  </div>

                  <div className="frow">
                    <label className="ckl">
                      <input
                        type="checkbox"
                        checked={tSoundOnLead}
                        onChange={(e) => setTSoundOnLead(e.target.checked)}
                      />
                      <span>提前提示音效</span>
                    </label>
                    <select
                      className="field"
                      style={{ width: 112 }}
                      value={tLeadSoundType}
                      disabled={!tSoundOnLead || tLeadSeconds === 0}
                      onChange={(e) => setTLeadSoundType(e.target.value as SoundType)}
                      aria-label="提前提示音效"
                    >
                      <option value="beep">🚨 電子嗶嗶聲</option>
                      <option value="chime">🔔 清脆鈴聲</option>
                      <option value="scifi">⚡ 科技脈衝</option>
                      <option value="coin">🪙 遊戲金幣聲</option>
                    </select>
                    <button
                      type="button"
                      className="btn mini"
                      onClick={() => playAlertSound(tLeadSoundType, tLeadVolume * masterVolume)}
                    >
                      <Play />
                      測試
                    </button>
                  </div>

                  <div className="frow">
                    <span className="fl">提前音效音量</span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      disabled={!tSoundOnLead || tLeadSeconds === 0}
                      value={Math.round(tLeadVolume * 100)}
                      onChange={(e) => setTLeadVolume(Number(e.target.value) / 100)}
                      style={
                        {
                          flex: 1,
                          minWidth: 80,
                          '--p': `${Math.round(tLeadVolume * 100)}%`,
                        } as React.CSSProperties
                      }
                      aria-label="提前音效音量"
                    />
                    <span className="val num" style={{ width: 34, textAlign: 'right' }}>
                      {Math.round(tLeadVolume * 100)}%
                    </span>
                  </div>

                  <div className="frow">
                    <label className="ckl">
                      <input
                        type="checkbox"
                        checked={tSpeakOnLead}
                        onChange={(e) => setTSpeakOnLead(e.target.checked)}
                      />
                      <span>提前語音說出</span>
                    </label>
                    <span className="fsub">後面接：</span>
                    <input
                      type="text"
                      className="field"
                      style={{ flex: 1, minWidth: 96 }}
                      disabled={!tSpeakOnLead || tLeadSeconds === 0}
                      value={tCustomLeadSpeakText}
                      onChange={(e) => setTCustomLeadSpeakText(e.target.value)}
                      placeholder="例如：快好了 / 還有3秒"
                      aria-label="提前語音自訂文字"
                    />
                    <button
                      type="button"
                      className="btn mini"
                      onClick={() => speakAlert(`${tName} ${tCustomLeadSpeakText}`, speechVolume)}
                    >
                      <Mic />
                      試聽語音
                    </button>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 'var(--sp2)', marginTop: 'var(--sp3)' }}>
                  <button type="submit" className="btn pri">
                    <Check />
                    儲存該計時
                  </button>
                  <button type="button" className="btn ghost" onClick={() => setIsEditingTimer(false)}>
                    取消
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* ── 置頂懸浮計時視窗：只有一顆開關，開了就變成「懸浮窗已開啟」 ── */}
          <div className="full">
            <div className="bar2" style={{ justifyContent: 'space-between', marginBottom: 'var(--sp2)' }}>
              <h4 className="sect" style={{ margin: 0 }}>
                <Monitor />
                置頂懸浮計時視窗
              </h4>
              <button
                type="button"
                className="btn"
                aria-pressed={showFloatingWidget}
                onClick={() => onToggleFloatingWidget(!showFloatingWidget)}
                style={showFloatingWidget ? { color: 'var(--acc-txt)' } : undefined}
              >
                <Maximize2 />
                {showFloatingWidget ? '懸浮窗已開啟' : '開啟獨立置頂懸浮窗'}
              </button>
            </div>
            <div className="box">
              <div className="form">
                <div className="frow">
                  <span className="fl">排版</span>
                  <div className="opts">
                    <button
                      type="button"
                      aria-pressed={floatingLayout === 'horizontal'}
                      onClick={() => onChangeFloatingLayout('horizontal')}
                      title="橫排並列模式"
                    >
                      橫排
                    </button>
                    <button
                      type="button"
                      aria-pressed={floatingLayout === 'vertical'}
                      onClick={() => onChangeFloatingLayout('vertical')}
                      title="直排清單模式"
                    >
                      直排
                    </button>
                  </div>
                </div>
                {onChangeFloatingIconSize && (
                  <div className="frow">
                    <span className="fl">圖示</span>
                    <select
                      className="field"
                      style={{ width: 130 }}
                      value={floatingIconSize}
                      onChange={(e) => onChangeFloatingIconSize(Number(e.target.value))}
                      aria-label="懸浮窗圖示大小"
                    >
                      <option value={36}>36px (小)</option>
                      <option value={46}>46px (中)</option>
                      <option value={58}>58px (大)</option>
                      <option value={72}>72px (特大)</option>
                    </select>
                  </div>
                )}
                {onChangeFloatingTextSize && (
                  <div className="frow">
                    <span className="fl">字體</span>
                    <select
                      className="field"
                      style={{ width: 130 }}
                      value={floatingTextSize}
                      onChange={(e) => onChangeFloatingTextSize(Number(e.target.value))}
                      aria-label="懸浮窗字體大小"
                    >
                      <option value={11}>11px (精簡)</option>
                      <option value={13}>13px (標準)</option>
                      <option value={16}>16px (大字)</option>
                      <option value={20}>20px (超大)</option>
                    </select>
                  </div>
                )}

                {onToggleFloatingShowName && (
                  <div className="frow">
                    <span className="fl">顯示名稱</span>
                    <button
                      type="button"
                      className="sw sm"
                      role="switch"
                      aria-checked={floatingShowName}
                      onClick={() => onToggleFloatingShowName(!floatingShowName)}
                      aria-label="切換是否顯示名稱"
                      title="切換是否顯示名稱"
                    >
                      <i />
                    </button>
                  </div>
                )}
                <div className="frow">
                  <span className="fl">透明</span>
                  <select
                    className="field"
                    style={{ width: 94 }}
                    value={floatingOpacity}
                    onChange={(e) => onChangeFloatingOpacity(Number(e.target.value))}
                    aria-label="懸浮窗透明度"
                  >
                    <option value={1.0}>100%</option>
                    <option value={0.85}>85%</option>
                    <option value={0.65}>65%</option>
                    <option value={0.4}>40%</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── SUB-TAB 2: 條件觸發自動點擊 (with multi-target A, hotkeys, & editing) ── */}
      {activeSubTab === 'combo' && (
        <div className="subgrid">
          {/* ── 條件聯動規則：清單 ── */}
          <div className="full">
            <div className="bar2" style={{ justifyContent: 'space-between', marginBottom: 'var(--sp2)' }}>
              <h4 className="sect" style={{ margin: 0 }}>
                <MousePointerClick />
                條件聯動規則
              </h4>
              <div className="bar2">
                <button
                  type="button"
                  className="btn"
                  onClick={handleTestMouse}
                  title="測試滑鼠右鍵點擊並移回螢幕正中央"
                >
                  <Crosshair />
                  測試右鍵點擊與回中
                </button>
                <button type="button" className="btn pri" onClick={handleOpenAddRule}>
                  <Plus />
                  新增條件聯動規則
                </button>
              </div>
            </div>
            <p style={{ margin: '0 0 var(--sp2)', fontSize: 'var(--fs0)', color: 'var(--dim2)', lineHeight: 1.5 }}>
              支援多選圖片 A（任一出現即觸發點擊）、自訂快捷按鍵（側錄）、多條件 AND 聯動
            </p>

          {rules.length === 0 ? (
            <div className="empty">
              <MousePointerClick />
              <p style={{ color: 'var(--dim)', fontWeight: 600 }}>尚未建立任何條件聯動規則</p>
              <p style={{ maxWidth: 340, lineHeight: 1.65 }}>
                您可以設定「若 照片A出現 且 照片B符合 → 滑鼠右鍵自動點掉並回到畫面正中間」！
              </p>
            </div>
          ) : (
            <div className="box" style={{ padding: 'var(--sp2)' }}>
              <div className="list" style={{ '--inset': '44px' } as React.CSSProperties}>
                {rules.map((rule) => {
                  const targetIds =
                    rule.targetIdsA && rule.targetIdsA.length > 0
                      ? rule.targetIdsA
                      : rule.targetIdA
                      ? [rule.targetIdA]
                      : [];
                  const matchingTargetsA = targets.filter((t) => targetIds.includes(t.id));
                  const targetB = rule.targetIdB ? targets.find((t) => t.id === rule.targetIdB) : null;
                  const isOn = !!rule.enabled;

                  return (
                    <div key={rule.id} className="row" style={{ alignItems: 'flex-start' }}>
                      <span className="lab" style={{ alignSelf: 'center' }}>
                        <MousePointerClick style={{ color: isOn ? 'var(--acc-txt)' : 'var(--dim2)' }} />
                        <b style={{ fontWeight: 600, color: isOn ? 'var(--txt)' : 'var(--dim)' }}>{rule.name}</b>
                      </span>

                      <div className="flow" style={{ flex: 1, minWidth: 0 }}>
                        {rule.hotkey && (
                          <span className="hk" style={{ height: 19, padding: '0 5px' }}>
                            {rule.hotkey}
                          </span>
                        )}
                        <span className="tag">冷卻 {rule.cooldownSeconds}s</span>
                        <span>當出現</span>
                        {matchingTargetsA.length === 0 ? (
                          <span style={{ color: 'var(--bad)', fontWeight: 600 }}>(目標已刪除)</span>
                        ) : (
                          matchingTargetsA.map((t) => (
                            <span
                              key={t.id}
                              className="cchip"
                              style={{ '--tc': `${t.color}66` } as React.CSSProperties}
                            >
                              <TargetIcon style={{ color: t.color }} />
                              {t.name}
                            </span>
                          ))
                        )}
                        {targetB && (
                          <>
                            <span>＋</span>
                            <span>且同時符合</span>
                            <span
                              className="cchip"
                              style={{ '--tc': `${targetB.color}66` } as React.CSSProperties}
                            >
                              <TargetIcon style={{ color: targetB.color }} />
                              {targetB.name}
                            </span>
                          </>
                        )}
                        <ChevronRight />
                        <span>
                          {rule.action === 'right_click_and_center' && '右鍵點掉該目標並回到螢幕中間'}
                          {rule.action === 'left_click_and_center' && '左鍵點掉該目標並回到螢幕中間'}
                          {rule.action === 'sound_only' && '僅播放警報音效'}
                        </span>
                      </div>

                      <button
                        type="button"
                        className="sw sm"
                        role="switch"
                        aria-checked={isOn}
                        aria-label={`啟用${rule.name}`}
                        onClick={() => handleToggleRule(rule.id)}
                      >
                        <i />
                      </button>
                      <button
                        type="button"
                        className="btn mini ico-only"
                        onClick={() => handleOpenEditRule(rule)}
                        aria-label="編輯規則"
                        title="編輯規則"
                      >
                        <Pencil />
                      </button>
                      <button
                        type="button"
                        className="btn mini ico-only"
                        onClick={() => handleDeleteRule(rule.id)}
                        aria-label="刪除規則"
                        title="刪除規則"
                        style={{ color: 'var(--bad)' }}
                      >
                        <Trash2 />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

          {/* ── 條件聯動規則：新增／修改同一份表單 ── */}
          {isEditingRule && (
            <div className="full">
              <div className="bar2" style={{ justifyContent: 'space-between', marginBottom: 'var(--sp2)' }}>
                <h4 className="sect" style={{ margin: 0 }}>
                  <Layers />
                  {editingRuleId ? '編輯條件自動點擊規則' : '新增條件自動點擊規則'}
                </h4>
                <button
                  type="button"
                  className="btn mini ico-only"
                  onClick={() => setIsEditingRule(false)}
                  aria-label="關閉規則設定"
                  title="關閉規則設定"
                >
                  <X />
                </button>
              </div>
              <form onSubmit={handleSaveRule} className="box">
                <div className="form">
                  <div className="frow">
                    <span className="fl">規則名稱</span>
                    <input
                      type="text"
                      className="field"
                      style={{ flex: 1, minWidth: 0, maxWidth: 320 }}
                      value={ruleName}
                      onChange={(e) => setRuleName(e.target.value)}
                      placeholder="例如：彈窗自動右鍵點掉"
                      aria-label="規則名稱"
                      required
                    />
                  </div>
                  <div className="frow">
                    <span className="fl">執行動作</span>
                    <select
                      className="field"
                      style={{ flex: 1, minWidth: 0, maxWidth: 320 }}
                      value={ruleAction}
                      onChange={(e) => setRuleAction(e.target.value as any)}
                      aria-label="執行動作"
                    >
                      <option value="right_click_and_center">🖱️ 滑鼠右鍵點擊目標 A 並回到螢幕正中央</option>
                      <option value="left_click_and_center">🖱️ 滑鼠左鍵點擊目標 A 並回到螢幕正中央</option>
                      <option value="sound_only">🔔 僅播放警報音效不點擊</option>
                    </select>
                  </div>
                  <div className="frow">
                    <span className="fl">快捷開關按鍵</span>
                    <input
                      type="text"
                      className="field num"
                      style={{ width: 96 }}
                      value={ruleHotkey}
                      onChange={(e) => setRuleHotkey(e.target.value.toUpperCase())}
                      placeholder="無（可側錄）"
                      aria-label="快捷開關按鍵"
                    />
                    <button
                      type="button"
                      className={`btn mini${isRecordingRuleHotkey ? ' pri' : ''}`}
                      onClick={() => setIsRecordingRuleHotkey(!isRecordingRuleHotkey)}
                    >
                      <Zap />
                      {isRecordingRuleHotkey ? '按下按鍵…' : '側錄'}
                    </button>
                    <span className="fsub">按下就會記錄，之後可用這顆鍵開關這條規則</span>
                  </div>
                </div>
                <h5 className="sect" style={{ margin: 'var(--sp3) 0 var(--sp2)' }}>
                  條件 1 · 當以下「目標圖片 A」出現時自動點擊該處（可多選，任一命中即點擊）
                </h5>

                {targets.length === 0 ? (
                  <div
                    className="checks"
                    style={{ display: 'block', color: 'var(--dim2)', fontSize: 'var(--fs1)' }}
                  >
                    目前尚未建立任何偵測目標，請先至「監測目標」清單新增截圖目標！
                  </div>
                ) : (
                  <div className="checks">
                    {targets.map((t) => (
                      <label key={t.id}>
                        <input
                          type="checkbox"
                          checked={ruleTargetIdsA.includes(t.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setRuleTargetIdsA([...ruleTargetIdsA, t.id]);
                            } else {
                              setRuleTargetIdsA(ruleTargetIdsA.filter((id) => id !== t.id));
                            }
                          }}
                        />
                        <span>{t.name}</span>
                      </label>
                    ))}
                  </div>
                )}
                <h5 className="sect" style={{ margin: 'var(--sp3) 0 var(--sp2)' }}>
                  條件 2（選填）· 且此圖片同時符合（AND 聯動）
                </h5>
                <div className="form">
                  <div className="frow">
                    <span className="fl">同時符合</span>
                    <select
                      className="field"
                      style={{ flex: 1, minWidth: 0, maxWidth: 340 }}
                      value={ruleTargetIdB}
                      onChange={(e) => setRuleTargetIdB(e.target.value)}
                      aria-label="條件 2 目標"
                    >
                      <option value="">無（只要符合上述目標 A 任一即觸發）</option>
                      {targets.map((t) => (
                        <option key={t.id} value={t.id}>
                          🎯 {t.name}（門檻 {Math.round(t.threshold * 100)}%）
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="frow">
                    <span className="fl">觸發提示音效</span>
                    <select
                      className="field"
                      style={{ width: 150 }}
                      value={ruleSoundType}
                      onChange={(e) => setRuleSoundType(e.target.value as SoundType)}
                      aria-label="觸發提示音效"
                    >
                      <option value="double_ding">🎯 雙音</option>
                      <option value="chime">🔔 清脆鈴聲</option>
                      <option value="beep">🚨 電子嗶嗶聲</option>
                      <option value="siren">⚠️ 急促警報</option>
                      <option value="coin">🪙 遊戲金幣聲</option>
                      <option value="fanfare">🎺 勝利號角</option>
                    </select>
                  </div>
                  <div className="frow">
                    <span className="fl">單獨提示音量</span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={Math.round(ruleVolume * 100)}
                      onChange={(e) => setRuleVolume(Number(e.target.value) / 100)}
                      style={
                        {
                          flex: 1,
                          minWidth: 120,
                          maxWidth: 240,
                          '--p': `${Math.round(ruleVolume * 100)}%`,
                        } as React.CSSProperties
                      }
                      aria-label="單獨提示音量"
                    />
                    <span className="val num" style={{ width: 34, textAlign: 'right' }}>
                      {Math.round(ruleVolume * 100)}%
                    </span>
                  </div>
                  <div className="frow">
                    <span className="fl">動作觸發冷卻</span>
                    <input
                      type="number"
                      className="field num"
                      style={{ width: 52 }}
                      min="1"
                      max="60"
                      value={ruleCooldown}
                      onChange={(e) => setRuleCooldown(Math.max(1, Number(e.target.value)))}
                      aria-label="動作觸發冷卻時間"
                    />
                    <span className="val">秒</span>
                    <span className="fsub">同一條規則在冷卻期間不會重複點擊</span>
                  </div>
                </div>
                <div
                  style={{
                    display: 'flex',
                    gap: 'var(--sp2)',
                    justifyContent: 'flex-end',
                    marginTop: 'var(--sp3)',
                  }}
                >
                  <button type="button" className="btn ghost" onClick={() => setIsEditingRule(false)}>
                    取消
                  </button>
                  <button type="submit" className="btn pri">
                    <Check />
                    {editingRuleId ? '儲存修改' : '確認建立'}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
