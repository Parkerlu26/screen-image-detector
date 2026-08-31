import React, { useState, useEffect } from 'react';
import { Target, ImageComboRule, CooldownTimer, SoundType } from '../types';
import { playAlertSound, speakAlert } from '../utils/audio';
import {
  Sparkles,
  MousePointerClick,
  Clock,
  Plus,
  Trash2,
  Play,
  RotateCcw,
  Volume2,
  ExternalLink,
  Layers,
  ArrowRight,
  X,
  Crosshair,
  Camera,
  Keyboard,
  Eye,
  LayoutGrid,
  LayoutList,
  FolderOpen,
  Save,
  Bell,
  Mic,
  Power,
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

      let keyName = e.key.toUpperCase();
      if (e.code.startsWith('Key')) keyName = e.code.replace('Key', '').toUpperCase();
      else if (e.code.startsWith('Digit')) keyName = e.code.replace('Digit', '');
      else if (e.code.startsWith('Numpad')) keyName = 'NUM' + e.code.replace('Numpad', '');
      else if (e.key === ' ') keyName = 'SPACE';
      else if (e.key === 'Escape') {
        setIsRecordingHotkey(false);
        return;
      }

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

      let keyName = e.key.toUpperCase();
      if (e.code.startsWith('Key')) keyName = e.code.replace('Key', '').toUpperCase();
      else if (e.code.startsWith('Digit')) keyName = e.code.replace('Digit', '');
      else if (e.code.startsWith('Numpad')) keyName = 'NUM' + e.code.replace('Numpad', '');
      else if (e.key === ' ') keyName = 'SPACE';
      else if (e.key === 'Escape') {
        setIsRecordingRuleHotkey(false);
        return;
      }

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
    <div className="flex-1 flex flex-col h-full bg-slate-950 p-4 space-y-4 overflow-y-auto min-h-0">
      {/* Top Header & Sub Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl shrink-0">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-emerald-400" />
            進階聯動 ＆ 技能倒數計時組
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            配置按鍵技能倒數計時組與桌面置頂透明懸浮窗，或設定多圖命中自動右鍵點擊回中
          </p>
        </div>

        {/* Sub Navigation */}
        <div className="flex items-center gap-2 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
          <button
            type="button"
            onClick={() => setActiveSubTab('timers')}
            className={`px-3.5 py-1.5 rounded-lg font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
              activeSubTab === 'timers'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            技能計時組設定 ({timers.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('combo')}
            className={`px-3.5 py-1.5 rounded-lg font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
              activeSubTab === 'combo'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <MousePointerClick className="w-3.5 h-3.5" />
            條件觸發自動點擊 ({rules.length})
          </button>
        </div>
      </div>

      {/* ── SUB-TAB 1: 技能計時組設定 ── */}
      {activeSubTab === 'timers' && (
        <div className="space-y-4 flex-1">
          {/* Action Toolbar with Floating Window Controls */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-slate-900/80 border border-slate-800 rounded-2xl">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleOpenAddTimer}
                className="px-3.5 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center gap-1.5 cursor-pointer shadow-rose-950/50"
              >
                <Plus className="w-4 h-4" />
                新增計時組設定
              </button>
            </div>

            {/* Floating Window Toolbar Controls */}
            <div className="flex flex-wrap items-center gap-2.5 bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800 text-xs">
              {/* Layout Switch: Horizontal / Vertical */}
              <div className="flex items-center gap-1">
                <span className="text-slate-400 text-[11px]">排版:</span>
                <button
                  type="button"
                  onClick={() => onChangeFloatingLayout('horizontal')}
                  className={`p-1 rounded-lg text-[11px] font-semibold transition-colors flex items-center gap-1 cursor-pointer ${
                    floatingLayout === 'horizontal'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title="橫排並列模式"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  橫排
                </button>
                <button
                  type="button"
                  onClick={() => onChangeFloatingLayout('vertical')}
                  className={`p-1 rounded-lg text-[11px] font-semibold transition-colors flex items-center gap-1 cursor-pointer ${
                    floatingLayout === 'vertical'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title="直排清單模式"
                >
                  <LayoutList className="w-3.5 h-3.5" />
                  直排
                </button>
              </div>

              {/* Icon Size Selector */}
              {onChangeFloatingIconSize && (
                <div className="flex items-center gap-1 pl-2 border-l border-slate-800">
                  <span className="text-slate-400 text-[11px]">圖示:</span>
                  <select
                    value={floatingIconSize}
                    onChange={(e) => onChangeFloatingIconSize(Number(e.target.value))}
                    className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-0.5 text-xs text-white focus:outline-none"
                  >
                    <option value={36}>36px (小)</option>
                    <option value={46}>46px (中)</option>
                    <option value={58}>58px (大)</option>
                    <option value={72}>72px (特大)</option>
                  </select>
                </div>
              )}

              {/* Text Size Selector */}
              {onChangeFloatingTextSize && (
                <div className="flex items-center gap-1 pl-2 border-l border-slate-800">
                  <span className="text-slate-400 text-[11px]">字體:</span>
                  <select
                    value={floatingTextSize}
                    onChange={(e) => onChangeFloatingTextSize(Number(e.target.value))}
                    className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-0.5 text-xs text-white focus:outline-none"
                  >
                    <option value={11}>11px (精簡)</option>
                    <option value={13}>13px (標準)</option>
                    <option value={16}>16px (大字)</option>
                    <option value={20}>20px (超大)</option>
                  </select>
                </div>
              )}

              {/* Show Name Toggle */}
              {onToggleFloatingShowName && (
                <div className="flex items-center gap-1 pl-2 border-l border-slate-800">
                  <button
                    type="button"
                    onClick={() => onToggleFloatingShowName(!floatingShowName)}
                    className={`px-2 py-0.5 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer ${
                      floatingShowName
                        ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/40'
                        : 'bg-slate-900 text-slate-500 border border-slate-800'
                    }`}
                    title="切換是否顯示名稱"
                  >
                    {floatingShowName ? '🏷️ 顯示名稱' : '🏷️ 隱藏名稱'}
                  </button>
                </div>
              )}

              {/* Opacity Selector */}
              <div className="flex items-center gap-1 pl-2 border-l border-slate-800">
                <Eye className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-slate-400 text-[11px]">透明:</span>
                <select
                  value={floatingOpacity}
                  onChange={(e) => onChangeFloatingOpacity(Number(e.target.value))}
                  className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-0.5 text-xs text-white focus:outline-none"
                >
                  <option value={1.0}>100%</option>
                  <option value={0.85}>85%</option>
                  <option value={0.65}>65%</option>
                  <option value={0.4}>40%</option>
                </select>
              </div>

              {/* Native Floating Window Toggle */}
              <button
                type="button"
                onClick={() => onToggleFloatingWidget(!showFloatingWidget)}
                className={`px-3 py-1 rounded-lg font-bold transition-all flex items-center gap-1.5 shadow-md cursor-pointer ml-1 ${
                  showFloatingWidget
                    ? 'bg-indigo-600 text-white shadow-indigo-950/40 border border-indigo-500/40 animate-pulse'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                }`}
              >
                <ExternalLink className="w-3.5 h-3.5" />
                {showFloatingWidget ? '🪟 懸浮窗已開啟' : '開啟獨立置頂懸浮窗'}
              </button>
            </div>
          </div>

          {/* ── PROFESSIONAL GAMING CD TIMER CONFIG PANEL (with Individual Volume Sliders) ── */}
          {isEditingTimer && (
            <form onSubmit={handleSaveTimer} className="p-6 bg-[#161a29] border border-slate-700/80 rounded-2xl space-y-4 shadow-2xl animate-in fade-in max-w-2xl mx-auto text-xs text-slate-200">
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Clock className="w-4 h-4 text-rose-400" />
                  計時組設定
                </h3>
                <button
                  type="button"
                  onClick={() => setIsEditingTimer(false)}
                  className="p-1 text-slate-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Row 1: 計時名稱 */}
              <div className="grid grid-cols-12 gap-2 items-center">
                <label className="col-span-3 font-semibold text-slate-300">
                  計時名稱：
                </label>
                <div className="col-span-9">
                  <input
                    type="text"
                    value={tName}
                    onChange={(e) => setTName(e.target.value)}
                    placeholder="例如：魔消"
                    className="w-48 bg-[#1f2438] border border-slate-700/80 rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                    required
                  />
                </div>
              </div>

              {/* Row 2: 快捷鍵 */}
              <div className="grid grid-cols-12 gap-2 items-center">
                <label className="col-span-3 font-semibold text-slate-300">
                  快捷鍵：
                </label>
                <div className="col-span-9 flex items-center gap-2">
                  <input
                    type="text"
                    value={tHotkey}
                    readOnly
                    className="w-36 bg-[#1f2438] border border-slate-700/80 rounded px-3 py-1.5 text-xs font-mono font-bold text-amber-300 text-center"
                  />
                  <button
                    type="button"
                    onClick={() => setIsRecordingHotkey(true)}
                    className={`px-3 py-1.5 rounded font-bold transition-all flex items-center gap-1 cursor-pointer ${
                      isRecordingHotkey
                        ? 'bg-amber-500 text-slate-950 shadow-lg animate-pulse'
                        : 'bg-[#2b3350] hover:bg-[#343e62] text-slate-200 border border-slate-700'
                    }`}
                  >
                    <Keyboard className="w-3.5 h-3.5" />
                    {isRecordingHotkey ? '請在鍵盤按下按鍵...' : '點擊設定'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setTHotkey('')}
                    className="px-2.5 py-1.5 bg-[#e05252] hover:bg-[#c94545] text-white rounded font-bold transition-colors cursor-pointer"
                    title="清除快捷鍵"
                  >
                    ✕
                  </button>
                </div>
              </div>

              {/* Row 3: 倒數模式 */}
              <div className="grid grid-cols-12 gap-2 items-center">
                <label className="col-span-3 font-semibold text-slate-300">
                  倒數模式：
                </label>
                <div className="col-span-9 flex items-center gap-4">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="tMode"
                      checked={tMode === 'loop'}
                      onChange={() => setTMode('loop')}
                      className="accent-indigo-500"
                    />
                    <span>自動循環</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="tMode"
                      checked={tMode === 'stop_on_zero'}
                      onChange={() => setTMode('stop_on_zero')}
                      className="accent-indigo-500"
                    />
                    <span>倒數後停止</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="tMode"
                      checked={tMode === 'two_phase'}
                      onChange={() => setTMode('two_phase')}
                      className="accent-indigo-500"
                    />
                    <span>雙回合切換</span>
                  </label>
                </div>
              </div>

              {/* Row 4: 倒數時間 (秒) */}
              <div className="grid grid-cols-12 gap-2 items-center">
                <label className="col-span-3 font-semibold text-slate-300">
                  倒數時間 (秒)：
                </label>
                <div className="col-span-9">
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    max="9999"
                    value={tDuration}
                    onChange={(e) => setTDuration(Math.max(0.1, Number(e.target.value)))}
                    className="w-28 bg-[#1f2438] border border-slate-700/80 rounded px-3 py-1.5 text-xs text-white font-mono font-bold focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              {/* Row 5: 圖示效果模式 */}
              <div className="grid grid-cols-12 gap-2 items-center">
                <label className="col-span-3 font-semibold text-slate-300">
                  圖示效果模式：
                </label>
                <div className="col-span-9 flex items-center gap-4">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="tDisplayMode"
                      checked={tDisplayMode === 'default'}
                      onChange={() => setTDisplayMode('default')}
                      className="accent-indigo-500"
                    />
                    <span>預設</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="tDisplayMode"
                      checked={tDisplayMode === 'cooldown'}
                      onChange={() => setTDisplayMode('cooldown')}
                      className="accent-indigo-500"
                    />
                    <span>冷卻模式</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="tDisplayMode"
                      checked={tDisplayMode === 'original_only'}
                      onChange={() => setTDisplayMode('original_only')}
                      className="accent-indigo-500"
                    />
                    <span>僅用原圖</span>
                  </label>
                </div>
              </div>

              {/* Row 6: 圖片 (圖示) - 僅作圖示，不作偵測 */}
              <div className="grid grid-cols-12 gap-2 items-center pt-2 border-t border-slate-800/80">
                <label className="col-span-3 font-semibold text-slate-300">
                  圖片 (圖示)：
                </label>
                <div className="col-span-9 flex items-center gap-2 flex-wrap">
                  <div className="w-8 h-8 rounded border border-slate-700 bg-slate-950 flex items-center justify-center overflow-hidden shrink-0">
                    {tImageDataUrl ? (
                      <img src={tImageDataUrl} alt="Icon" className="w-full h-full object-contain" />
                    ) : (
                      <span className="text-[10px] text-slate-500">無</span>
                    )}
                  </div>

                  <input
                    type="text"
                    value={tImageDataUrl ? `${tName}_icon.png` : '尚未設定圖示'}
                    readOnly
                    className="w-36 bg-[#1f2438] border border-slate-700/80 rounded px-2.5 py-1.5 text-[11px] text-slate-300 truncate"
                  />

                  <button
                    type="button"
                    onClick={() =>
                      onOpenCropForTimer(editingTimerId || undefined, (url) => setTImageDataUrl(url))
                    }
                    className="px-3 py-1.5 bg-[#2b3350] hover:bg-[#343e62] text-slate-200 rounded text-xs font-semibold flex items-center gap-1 border border-slate-700 cursor-pointer"
                  >
                    <Camera className="w-3.5 h-3.5 text-emerald-400" />
                    截圖圖示
                  </button>

                  <label className="px-3 py-1.5 bg-[#2b3350] hover:bg-[#343e62] text-slate-200 rounded text-xs font-semibold flex items-center gap-1 border border-slate-700 cursor-pointer">
                    <FolderOpen className="w-3.5 h-3.5 text-cyan-400" />
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
                      className="hidden"
                    />
                  </label>
                </div>
              </div>

              {/* ── Section A: 倒數計時完成提示音效 ＆ 語音朗讀 (含獨立音量) ── */}
              <div className="space-y-2.5 pt-2 border-t border-slate-800/80 bg-slate-950/40 p-3.5 rounded-xl border border-slate-800/60">
                <div className="font-bold text-emerald-400 flex items-center gap-1.5">
                  <Bell className="w-4 h-4" />
                  倒數完成提示（結束時觸發）：
                </div>

                {/* Sound Setting + Volume Slider */}
                <div className="space-y-1.5 pl-2">
                  <div className="grid grid-cols-12 gap-2 items-center">
                    <label className="col-span-3 text-slate-400 flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={tSoundOnComplete}
                        onChange={(e) => setTSoundOnComplete(e.target.checked)}
                        className="accent-emerald-500"
                      />
                      <span>播放完成音效</span>
                    </label>
                    <div className="col-span-9 flex items-center gap-2">
                      <select
                        value={tSoundType}
                        disabled={!tSoundOnComplete}
                        onChange={(e) => setTSoundType(e.target.value as SoundType)}
                        className="w-36 bg-[#1f2438] border border-slate-700/80 rounded px-2 py-1 text-xs text-white focus:outline-none disabled:opacity-50"
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
                        onClick={() => playAlertSound(tSoundType, tVolume * masterVolume)}
                        className="px-2.5 py-1 bg-[#2b3350] hover:bg-[#343e62] text-slate-200 rounded text-xs flex items-center gap-1 border border-slate-700 cursor-pointer"
                      >
                        <Play className="w-3 h-3 text-emerald-400" />
                        測試
                      </button>
                    </div>
                  </div>

                  {/* Independent Completion Volume Slider */}
                  <div className="grid grid-cols-12 gap-2 items-center pl-6">
                    <span className="col-span-3 text-[11px] text-slate-400">完成音效音量：</span>
                    <div className="col-span-9 flex items-center gap-2">
                      <input
                        type="range"
                        min="0"
                        max="100"
                        disabled={!tSoundOnComplete}
                        value={Math.round(tVolume * 100)}
                        onChange={(e) => setTVolume(Number(e.target.value) / 100)}
                        className="w-36 h-1 bg-slate-800 rounded accent-emerald-500 cursor-pointer disabled:opacity-50"
                      />
                      <span className="font-mono text-emerald-400 font-bold text-xs w-8">
                        {Math.round(tVolume * 100)}%
                      </span>
                    </div>
                  </div>
                </div>

                {/* TTS Speech Setting */}
                <div className="grid grid-cols-12 gap-2 items-center pl-2 pt-1 border-t border-slate-800/40">
                  <label className="col-span-3 text-slate-400 flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={tSpeakOnComplete}
                      onChange={(e) => setTSpeakOnComplete(e.target.checked)}
                      className="accent-emerald-500"
                    />
                    <span>語音說出名稱</span>
                  </label>
                  <div className="col-span-9 flex items-center gap-2">
                    <span className="text-[11px] text-slate-400">後面接：</span>
                    <input
                      type="text"
                      disabled={!tSpeakOnComplete}
                      value={tCustomSpeakText}
                      onChange={(e) => setTCustomSpeakText(e.target.value)}
                      placeholder="例如：計時完成 / 冷卻好了"
                      className="w-36 bg-[#1f2438] border border-slate-700/80 rounded px-2.5 py-1 text-xs text-white disabled:opacity-50"
                    />
                    <button
                      type="button"
                      onClick={() => speakAlert(`${tName} ${tCustomSpeakText}`, speechVolume)}
                      className="px-2.5 py-1 bg-[#2b3350] hover:bg-[#343e62] text-slate-200 rounded text-xs flex items-center gap-1 border border-slate-700 cursor-pointer"
                    >
                      <Mic className="w-3 h-3 text-cyan-400" />
                      試聽語音
                    </button>
                  </div>
                </div>
              </div>

              {/* ── Section B: 提前幾秒提示音效 ＆ 語音朗讀 (含獨立音量) ── */}
              <div className="space-y-2.5 pt-2 border-t border-slate-800/80 bg-slate-950/40 p-3.5 rounded-xl border border-slate-800/60">
                <div className="font-bold text-amber-400 flex items-center gap-1.5">
                  <Clock className="w-4 h-4" />
                  提前提醒（提前幾秒觸發，0 代表不提前）：
                </div>

                <div className="grid grid-cols-12 gap-2 items-center pl-2">
                  <label className="col-span-3 text-slate-400">提前幾秒：</label>
                  <div className="col-span-9 flex items-center gap-2">
                    <input
                      type="number"
                      min="0"
                      max="60"
                      value={tLeadSeconds}
                      onChange={(e) => setTLeadSeconds(Number(e.target.value))}
                      className="w-16 bg-[#1f2438] border border-slate-700/80 rounded px-2 py-1 text-xs text-white text-center font-bold font-mono"
                    />
                    <span className="text-slate-400">秒 (若設 0 則不提前提醒)</span>
                  </div>
                </div>

                {/* Lead Sound + Volume Slider */}
                <div className="space-y-1.5 pl-2">
                  <div className="grid grid-cols-12 gap-2 items-center">
                    <label className="col-span-3 text-slate-400 flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={tSoundOnLead}
                        onChange={(e) => setTSoundOnLead(e.target.checked)}
                        className="accent-amber-500"
                      />
                      <span>提前提示音效</span>
                    </label>
                    <div className="col-span-9 flex items-center gap-2">
                      <select
                        value={tLeadSoundType}
                        disabled={!tSoundOnLead || tLeadSeconds === 0}
                        onChange={(e) => setTLeadSoundType(e.target.value as SoundType)}
                        className="w-36 bg-[#1f2438] border border-slate-700/80 rounded px-2 py-1 text-xs text-white focus:outline-none disabled:opacity-50"
                      >
                        <option value="beep">🚨 電子嗶嗶聲 (Beep)</option>
                        <option value="chime">🔔 清脆鈴聲</option>
                        <option value="scifi">⚡ 科技脈衝</option>
                        <option value="coin">🪙 遊戲金幣聲</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => playAlertSound(tLeadSoundType, tLeadVolume * masterVolume)}
                        className="px-2.5 py-1 bg-[#2b3350] hover:bg-[#343e62] text-slate-200 rounded text-xs flex items-center gap-1 border border-slate-700 cursor-pointer"
                      >
                        <Play className="w-3 h-3 text-amber-400" />
                        測試
                      </button>
                    </div>
                  </div>

                  {/* Independent Lead Volume Slider */}
                  <div className="grid grid-cols-12 gap-2 items-center pl-6">
                    <span className="col-span-3 text-[11px] text-slate-400">提前音效音量：</span>
                    <div className="col-span-9 flex items-center gap-2">
                      <input
                        type="range"
                        min="0"
                        max="100"
                        disabled={!tSoundOnLead || tLeadSeconds === 0}
                        value={Math.round(tLeadVolume * 100)}
                        onChange={(e) => setTLeadVolume(Number(e.target.value) / 100)}
                        className="w-36 h-1 bg-slate-800 rounded accent-amber-500 cursor-pointer disabled:opacity-50"
                      />
                      <span className="font-mono text-amber-400 font-bold text-xs w-8">
                        {Math.round(tLeadVolume * 100)}%
                      </span>
                    </div>
                  </div>
                </div>

                {/* Lead TTS Speech */}
                <div className="grid grid-cols-12 gap-2 items-center pl-2 pt-1 border-t border-slate-800/40">
                  <label className="col-span-3 text-slate-400 flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={tSpeakOnLead}
                      onChange={(e) => setTSpeakOnLead(e.target.checked)}
                      className="accent-amber-500"
                    />
                    <span>提前語音說出</span>
                  </label>
                  <div className="col-span-9 flex items-center gap-2">
                    <span className="text-[11px] text-slate-400">後面接：</span>
                    <input
                      type="text"
                      disabled={!tSpeakOnLead || tLeadSeconds === 0}
                      value={tCustomLeadSpeakText}
                      onChange={(e) => setTCustomLeadSpeakText(e.target.value)}
                      placeholder="例如：快好了 / 還有3秒"
                      className="w-36 bg-[#1f2438] border border-slate-700/80 rounded px-2.5 py-1 text-xs text-white disabled:opacity-50"
                    />
                    <button
                      type="button"
                      onClick={() => speakAlert(`${tName} ${tCustomLeadSpeakText}`, speechVolume)}
                      className="px-2.5 py-1 bg-[#2b3350] hover:bg-[#343e62] text-slate-200 rounded text-xs flex items-center gap-1 border border-slate-700 cursor-pointer"
                    >
                      <Mic className="w-3 h-3 text-amber-400" />
                      試聽語音
                    </button>
                  </div>
                </div>
              </div>

              {/* Bottom Submit Buttons */}
              <div className="flex items-center gap-3 pt-3 border-t border-slate-800/80">
                <button
                  type="submit"
                  className="px-6 py-2.5 bg-[#e05252] hover:bg-[#c94545] text-white rounded-lg text-xs font-bold transition-all shadow-lg flex items-center gap-1.5 cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  儲存該計時
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditingTimer(false)}
                  className="px-5 py-2.5 bg-[#2b3350] hover:bg-[#343e62] text-slate-300 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                >
                  取消
                </button>
              </div>
            </form>
          )}

          {/* Timers Grid */}
          {timers.length === 0 ? (
            <div className="p-8 bg-slate-900/60 border border-slate-800 rounded-2xl text-center space-y-2">
              <Clock className="w-10 h-10 text-slate-600 mx-auto" />
              <h3 className="text-xs font-bold text-slate-300">尚未建立任何技能計時組</h3>
              <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
                點擊上方「新增計時組設定」，配置熱鍵（如 W、F1）、倒數秒數與技能圖示，懸浮窗即可即時顯示！
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {timers.map((timer) => {
                const isEnabled = timer.enabled !== false;
                const percent = isEnabled ? Math.max(0, (timer.remainingSeconds / timer.durationSeconds) * 100) : 0;

                return (
                  <div
                    key={timer.id}
                    className={`p-4 bg-slate-900 border rounded-2xl shadow-xl flex flex-col justify-between space-y-3 relative overflow-hidden transition-all duration-200 ${
                      isEnabled ? 'border-slate-800' : 'border-slate-800/40 opacity-50'
                    }`}
                  >
                    {/* Top Progress Bar */}
                    <div
                      className="absolute top-0 left-0 h-1 bg-emerald-500 transition-all duration-150"
                      style={{ width: `${percent}%` }}
                    />

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        {/* Custom Image / Icon */}
                        {timer.imageDataUrl ? (
                          <img
                            src={timer.imageDataUrl}
                            alt={timer.name}
                            className="w-10 h-10 rounded-lg border border-slate-700 object-contain bg-slate-950 p-0.5"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-lg bg-slate-950 border border-amber-500/40 flex items-center justify-center font-bold text-amber-300 font-mono text-sm">
                            {timer.hotkey}
                          </div>
                        )}
                        <div>
                          <div className="flex items-center gap-1.5">
                            <h4 className="text-xs font-bold text-white truncate max-w-[110px]">{timer.name}</h4>
                            {!isEnabled && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-700 text-slate-400 border border-slate-600">
                                已停用
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1 mt-0.5">
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                              按鍵: {timer.hotkey}
                            </span>
                            <span className="text-[10px] text-slate-400">
                              {timer.durationSeconds}s
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        {/* Enable / Disable Toggle */}
                        <button
                          type="button"
                          onClick={() => handleToggleTimerEnabled(timer.id)}
                          className={`p-1.5 rounded transition-colors cursor-pointer ${
                            isEnabled
                              ? 'text-emerald-400 hover:text-slate-400 hover:bg-slate-800'
                              : 'text-slate-600 hover:text-emerald-400 hover:bg-slate-800'
                          }`}
                          title={isEnabled ? '點擊停用此計時器' : '點擊啟用此計時器'}
                        >
                          <Power className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenEditTimer(timer)}
                          className="p-1 text-slate-400 hover:text-white rounded transition-colors cursor-pointer"
                          title="修改計時設定"
                        >
                          ✏️
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteTimer(timer.id)}
                          className="p-1 text-slate-500 hover:text-rose-400 rounded transition-colors cursor-pointer"
                          title="刪除計時組"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Big Countdown Display */}
                    <div className="text-center py-2 bg-slate-950 rounded-xl border border-slate-800/80">
                      <div className={`text-2xl font-black font-mono tracking-wider ${isEnabled ? 'text-emerald-400' : 'text-slate-600'}`}>
                        {isEnabled ? timer.remainingSeconds.toFixed(1) : '——'} <span className="text-xs font-normal text-slate-400">/ {timer.durationSeconds}s</span>
                      </div>
                    </div>

                    {/* Controls */}
                    <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-800/60">
                      <button
                        type="button"
                        onClick={() => onOpenCropForTimer(timer.id)}
                        className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-medium transition-colors flex items-center gap-1 cursor-pointer"
                        title="從當前畫面截圖作為圖示"
                      >
                        <Camera className="w-3 h-3 text-emerald-400" />
                        截圖
                      </button>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => isEnabled && handleStartTimer(timer.id)}
                          disabled={!isEnabled}
                          className={`px-3 py-1 rounded-lg text-xs font-bold transition-all shadow flex items-center gap-1 ${
                            isEnabled
                              ? 'bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer'
                              : 'bg-slate-800 text-slate-600 cursor-not-allowed'
                          }`}
                        >
                          <Play className="w-3 h-3" />
                          觸發
                        </button>
                        <button
                          type="button"
                          onClick={() => isEnabled && handleResetTimer(timer.id)}
                          disabled={!isEnabled}
                          className={`p-1.5 rounded-lg transition-colors ${
                            isEnabled
                              ? 'bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white cursor-pointer'
                              : 'bg-slate-800/50 text-slate-700 cursor-not-allowed'
                          }`}
                          title="重設計時"
                        >
                          <RotateCcw className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── SUB-TAB 2: 條件觸發自動點擊 (with multi-target A, hotkeys, & editing) ── */}
      {activeSubTab === 'combo' && (
        <div className="space-y-4 flex-1">
          {/* Action Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-slate-900/80 border border-slate-800 rounded-2xl">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleOpenAddRule}
                className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center gap-1.5 cursor-pointer shadow-emerald-950/50"
              >
                <Plus className="w-4 h-4" />
                新增條件聯動規則
              </button>
              <button
                type="button"
                onClick={handleTestMouse}
                className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold border border-slate-700 transition-colors flex items-center gap-1.5 cursor-pointer"
                title="測試滑鼠右鍵點擊並移回螢幕正中央"
              >
                <Crosshair className="w-3.5 h-3.5 text-cyan-400" />
                測試右鍵點擊與回中
              </button>
            </div>
            <div className="text-[11px] text-slate-400">
              支援多選圖片 A（任一出現即觸發點擊）、自訂快捷按鍵（側錄）、多條件 AND 聯動
            </div>
          </div>

          {/* Add / Edit Rule Modal / Form */}
          {isEditingRule && (
            <form
              onSubmit={handleSaveRule}
              className="p-4 bg-slate-900 border border-emerald-500/40 rounded-2xl space-y-4 shadow-2xl animate-in fade-in"
            >
              <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                <h3 className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                  <Layers className="w-4 h-4" />
                  {editingRuleId ? '編輯條件自動點擊規則' : '新增條件自動點擊規則'}
                </h3>
                <button
                  type="button"
                  onClick={() => setIsEditingRule(false)}
                  className="p-1 text-slate-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* Rule Name */}
                <div>
                  <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                    規則名稱
                  </label>
                  <input
                    type="text"
                    value={ruleName}
                    onChange={(e) => setRuleName(e.target.value)}
                    placeholder="例如：彈窗自動右鍵點掉"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                    required
                  />
                </div>

                {/* Execution Action */}
                <div>
                  <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                    執行動作
                  </label>
                  <select
                    value={ruleAction}
                    onChange={(e) => setRuleAction(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                  >
                    <option value="right_click_and_center">🖱️ 滑鼠右鍵點擊目標 A 並回到螢幕正中央</option>
                    <option value="left_click_and_center">🖱️ 滑鼠左鍵點擊目標 A 並回到螢幕正中央</option>
                    <option value="sound_only">🔔 僅播放警報音效不點擊</option>
                  </select>
                </div>

                {/* Hotkey Toggle */}
                <div>
                  <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                    快捷開關按鍵 (側錄)
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={ruleHotkey}
                      onChange={(e) => setRuleHotkey(e.target.value.toUpperCase())}
                      placeholder="無 (可手動或側錄)"
                      className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-amber-300 font-mono font-bold uppercase focus:outline-none focus:border-amber-500"
                    />
                    <button
                      type="button"
                      onClick={() => setIsRecordingRuleHotkey(!isRecordingRuleHotkey)}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 transition-all cursor-pointer ${
                        isRecordingRuleHotkey
                          ? 'bg-rose-600 text-white animate-pulse'
                          : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                      }`}
                    >
                      <Keyboard className="w-3.5 h-3.5 text-amber-400" />
                      {isRecordingRuleHotkey ? '按下按鍵...' : '側錄'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Conditions Selection: Multi-select Target A + Target B */}
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-emerald-400 flex items-center gap-1">
                    <span>條件 1：當以下「目標圖片 A」出現時自動點擊該處</span>
                    <span className="text-rose-400 text-xs">* (可多選，任一命中即點擊)</span>
                  </label>

                  {targets.length === 0 ? (
                    <div className="p-3 bg-slate-900 rounded-lg text-slate-500 text-xs">
                      目前尚未建立任何偵測目標，請先至「監測目標」清單新增截圖目標！
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-44 overflow-y-auto p-2 bg-slate-900 rounded-xl border border-slate-800">
                      {targets.map((t) => {
                        const isChecked = ruleTargetIdsA.includes(t.id);
                        return (
                          <label
                            key={t.id}
                            className={`flex items-center gap-2 p-2 rounded-lg border text-xs cursor-pointer transition-all ${
                              isChecked
                                ? 'bg-emerald-950/40 border-emerald-500/60 text-white shadow-sm'
                                : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setRuleTargetIdsA([...ruleTargetIdsA, t.id]);
                                } else {
                                  setRuleTargetIdsA(ruleTargetIdsA.filter((id) => id !== t.id));
                                }
                              }}
                              className="accent-emerald-500 w-3.5 h-3.5"
                            />
                            {t.imageDataUrl ? (
                              <img
                                src={t.imageDataUrl}
                                alt={t.name}
                                className="w-5 h-5 rounded object-contain bg-slate-900 border shrink-0"
                                style={{ borderColor: t.color }}
                              />
                            ) : (
                              <span
                                className="w-2.5 h-2.5 rounded-full shrink-0"
                                style={{ backgroundColor: t.color }}
                              />
                            )}
                            <span className="truncate font-medium">{t.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Condition B (Optional AND Link) */}
                <div className="pt-2 border-t border-slate-800/80">
                  <label className="text-[11px] font-bold text-cyan-400 block mb-1">
                    條件 2 (選填)：且此圖片同時符合 (AND 聯動條件)
                  </label>
                  <select
                    value={ruleTargetIdB}
                    onChange={(e) => setRuleTargetIdB(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                  >
                    <option value="">-- 無 (單純只要符合上述目標 A 任一即觸發) --</option>
                    {targets.map((t) => (
                      <option key={t.id} value={t.id}>
                        🎯 {t.name} (門檻: {Math.round(t.threshold * 100)}%)
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Sound & Volume & Cooldown */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3 bg-slate-950 rounded-xl border border-slate-800 items-center">
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">觸發提示音效：</label>
                  <select
                    value={ruleSoundType}
                    onChange={(e) => setRuleSoundType(e.target.value as SoundType)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white"
                  >
                    <option value="double_ding">🎯 雙音</option>
                    <option value="chime">🔔 清脆鈴聲</option>
                    <option value="beep">🚨 電子嗶嗶聲</option>
                    <option value="siren">⚠️ 急促警報</option>
                    <option value="coin">🪙 遊戲金幣聲</option>
                    <option value="fanfare">🎺 勝利號角</option>
                  </select>
                </div>

                <div>
                  <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                    <span>單獨提示音量：</span>
                    <span className="font-mono text-emerald-400 font-bold">{Math.round(ruleVolume * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={Math.round(ruleVolume * 100)}
                    onChange={(e) => setRuleVolume(Number(e.target.value) / 100)}
                    className="w-full h-1.5 bg-slate-800 rounded accent-emerald-500 cursor-pointer mt-1"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                    <span>動作觸發冷卻時間：</span>
                    <span className="font-mono text-cyan-400 font-bold">{ruleCooldown} 秒</span>
                  </div>
                  <input
                    type="number"
                    min="1"
                    max="60"
                    value={ruleCooldown}
                    onChange={(e) => setRuleCooldown(Math.max(1, Number(e.target.value)))}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white font-bold text-center"
                  />
                </div>
              </div>

              {/* Form Buttons */}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsEditingRule(false)}
                  className="px-4 py-2 bg-slate-800 text-slate-300 rounded-xl text-xs font-semibold hover:bg-slate-700 transition-colors cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-emerald-950/50 transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <Save className="w-3.5 h-3.5" />
                  {editingRuleId ? '儲存修改' : '確認建立'}
                </button>
              </div>
            </form>
          )}

          {/* Rules List */}
          {rules.length === 0 ? (
            <div className="p-8 bg-slate-900/60 border border-slate-800 rounded-2xl text-center space-y-2">
              <MousePointerClick className="w-10 h-10 text-slate-600 mx-auto" />
              <h3 className="text-xs font-bold text-slate-300">尚未建立任何條件聯動規則</h3>
              <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
                您可以設定「若 照片A出現 且 照片B符合 → 滑鼠右鍵自動點掉並回到畫面正中間」！
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {rules.map((rule) => {
                const targetIds =
                  rule.targetIdsA && rule.targetIdsA.length > 0
                    ? rule.targetIdsA
                    : rule.targetIdA
                    ? [rule.targetIdA]
                    : [];
                const matchingTargetsA = targets.filter((t) => targetIds.includes(t.id));
                const targetB = rule.targetIdB ? targets.find((t) => t.id === rule.targetIdB) : null;

                return (
                  <div
                    key={rule.id}
                    className={`p-4 bg-slate-900 border rounded-2xl transition-all flex flex-wrap items-center justify-between gap-3 shadow-xl ${
                      rule.enabled
                        ? 'border-slate-700 shadow-slate-950/50'
                        : 'border-slate-800/60 opacity-60'
                    }`}
                  >
                    <div className="space-y-1.5 flex-1 min-w-[280px]">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`w-2.5 h-2.5 rounded-full ${rule.enabled ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                        <h4 className="text-xs font-bold text-white">{rule.name}</h4>
                        {rule.hotkey && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                            快捷鍵: {rule.hotkey}
                          </span>
                        )}
                        <span className="px-2 py-0.5 rounded text-[10px] bg-slate-800 text-slate-400 border border-slate-700">
                          冷卻 {rule.cooldownSeconds}s
                        </span>
                      </div>

                      {/* Rule Logic Flow Display */}
                      <div className="flex items-center gap-2 text-xs text-slate-300 flex-wrap">
                        <div className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800 flex-wrap">
                          <span className="text-[10px] text-slate-500">當出現:</span>
                          {matchingTargetsA.length === 0 ? (
                            <span className="text-rose-400 font-bold">(目標已刪除)</span>
                          ) : (
                            matchingTargetsA.map((t) => (
                              <span
                                key={t.id}
                                className="font-bold px-1.5 py-0.2 rounded text-[11px] border"
                                style={{
                                  backgroundColor: `${t.color}20`,
                                  borderColor: `${t.color}60`,
                                  color: t.color,
                                }}
                              >
                                {t.name}
                              </span>
                            ))
                          )}
                        </div>

                        {targetB && (
                          <>
                            <span className="text-cyan-400 font-bold text-xs">＋</span>
                            <div className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800">
                              <span className="text-[10px] text-slate-500">且同時符合:</span>
                              <span className="font-bold text-cyan-400">{targetB.name}</span>
                            </div>
                          </>
                        )}

                        <ArrowRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />

                        <div className="flex items-center gap-1.5 bg-indigo-950/50 px-2.5 py-1 rounded-lg border border-indigo-800/40 text-indigo-300 font-medium text-[11px]">
                          {rule.action === 'right_click_and_center' && '🖱️ 右鍵點掉該目標並回到螢幕中間'}
                          {rule.action === 'left_click_and_center' && '🖱️ 左鍵點掉該目標並回到螢幕中間'}
                          {rule.action === 'sound_only' && '🔔 僅播放警報音效'}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleToggleRule(rule.id)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                          rule.enabled
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30'
                            : 'bg-slate-800 text-slate-500 border border-slate-700 hover:text-slate-300'
                        }`}
                      >
                        {rule.enabled ? '已啟用' : '已停用'}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleOpenEditRule(rule)}
                        className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                        title="編輯規則"
                      >
                        ✏️
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeleteRule(rule.id)}
                        className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                        title="刪除規則"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
