import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Target, TargetGroup, MatchResult, MatchLogEntry, GlobalSettings, AppConfig, UserAccount, ImageComboRule, CooldownTimer, Rect } from './types';
import { Navbar } from './components/Navbar';
import { LiveStreamViewer } from './components/LiveStreamViewer';
import { TargetList } from './components/TargetList';
import { LogHistory } from './components/LogHistory';
import { CropModal } from './components/CropModal';
import { RoiModal } from './components/RoiModal';
import { SettingsModal } from './components/SettingsModal';
import { SourcePickerModal, DesktopSource } from './components/SourcePickerModal';
import { AuthModal } from './components/AuthModal';
import { UserManagementModal } from './components/UserManagementModal';
import {
  UpdateModal,
  UpdateInfo,
  updateApi,
  SKIPPED_VERSION_KEY,
} from './components/UpdateModal';
import { AutomationAndTimers } from './components/AutomationAndTimers';
import { FloatingTimerOverlay } from './components/FloatingTimerOverlay';
import {
  loadConfigFromStorage,
  saveConfigToStorage,
  exportConfigAsJson,
  importConfigFromJson,
  DEFAULT_SETTINGS,
} from './utils/storage';
import {
  cropImageFromSource,
  clearTemplateCache,
} from './utils/imageMatching';
import { playAlertSound, speakAlert, triggerBrowserNotification } from './utils/audio';
import {
  loadCachedSession,
  clearCurrentSession,
  clearLegacyLocalData,
  logoutUser,
  revalidateSession,
  adminListUsers,
} from './utils/auth';
import confetti from 'canvas-confetti';

const RULES_STORAGE_KEY = 'screen_detector_combo_rules_v1';
const TIMERS_STORAGE_KEY = 'screen_detector_cooldown_timers_v1';
const FLOATING_WIDGET_KEY = 'screen_detector_floating_widget_v1';
const FLOATING_OPACITY_KEY = 'screen_detector_floating_opacity_v1';
const FLOATING_LAYOUT_KEY = 'screen_detector_floating_layout_v1';

export default function App() {
  // If window was opened as independent Floating Window in Electron (#floating)
  const isNativeFloatingWindow = window.location.hash === '#floating';

  // Authentication & User Session State
  // 先用本機快取讓畫面能立刻顯示，接著在下方的 effect 跟後端確認一次；
  // 停用或到期的帳號會在那一刻被踢出來。
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(() => loadCachedSession());
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(() => !loadCachedSession() && !isNativeFloatingWindow);
  const [isUserManagementOpen, setIsUserManagementOpen] = useState(false);
  const [pendingUsersCount, setPendingUsersCount] = useState(0);
  const [sessionNotice, setSessionNotice] = useState<string>('');

  // App Navigation Tab
  const [activeTab, setActiveTab] = useState<'detect' | 'automation'>('detect');

  // App Configuration
  const [config, setConfig] = useState<AppConfig>(() => loadConfigFromStorage());
  const targets = config.targets;
  const groups = config.groups || [];
  const settings = config.settings;

  // Automation Rules & Cooldown Timers State
  const [rules, setRules] = useState<ImageComboRule[]>(() => {
    try {
      const raw = localStorage.getItem(RULES_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const [timers, setTimers] = useState<CooldownTimer[]>(() => {
    try {
      const raw = localStorage.getItem(TIMERS_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const [showFloatingWidget, setShowFloatingWidget] = useState<boolean>(() => {
    try {
      return localStorage.getItem(FLOATING_WIDGET_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const [floatingOpacity, setFloatingOpacity] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(FLOATING_OPACITY_KEY);
      return raw ? Number(raw) : 0.85;
    } catch {
      return 0.85;
    }
  });

  const [floatingLayout, setFloatingLayout] = useState<'horizontal' | 'vertical'>(() => {
    try {
      const raw = localStorage.getItem(FLOATING_LAYOUT_KEY);
      return raw === 'vertical' ? 'vertical' : 'horizontal';
    } catch {
      return 'horizontal';
    }
  });

  // Stream States
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [isStreamActive, setIsStreamActive] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [sourceWidth, setSourceWidth] = useState(1280);
  const [sourceHeight, setSourceHeight] = useState(720);

  // Performance telemetry
  const [fps, setFps] = useState(0);
  const [latencyMs, setLatencyMs] = useState(0);
  const frameCountRef = useRef(0);
  const lastFpsCalcRef = useRef(Date.now());
  const lastTelemetryUpdateRef = useRef(0);

  // ── Detection backend ──
  //
  // 'probing' until we know whether this machine has a usable WebGPU adapter.
  // 'gpu' runs the candidate sweep on the graphics card inside a single worker;
  // 'cpu' is the original multi-worker pool. The GPU worker downgrades itself to
  // 'cpu' if its startup self-test fails or the device is lost, so a driver
  // problem costs a frame, not the feature.
  const [gpuMode, setGpuMode] = useState<'probing' | 'gpu' | 'cpu'>('probing');
  const [gpuActive, setGpuActive] = useState(false);
  const gpuAvailableRef = useRef(false);
  // A short A/B trial: the pool runs first and its median frame time becomes the
  // baseline, then the GPU path runs and has to beat it. A weak integrated GPU
  // that turns out slower than the cores it replaced is sent back to the pool, so
  // switching backends can only reduce latency, never add it.
  const backendTrialRef = useRef<{
    targets: number;
    verdict: 'unknown' | 'ok' | 'slow' | 'cpu-only';
    cpuMedian: number | null;
    samples: number[];
  }>({ targets: 0, verdict: 'unknown', cpuMedian: null, samples: [] });

  // Matches & Logs
  const [latestMatches, setLatestMatches] = useState<MatchResult[]>([]);
  const latestMatchesRef = useRef<MatchResult[]>([]);
  // Automation rules are read inside the detection callback; a ref keeps that
  // callback stable so the scan loop is not torn down on unrelated edits.
  const rulesRef = useRef<ImageComboRule[]>([]);
  const [logs, setLogs] = useState<MatchLogEntry[]>([]);
  const [screenFlash, setScreenFlash] = useState<string | null>(null);

  // Active Modals
  const [isCropModalOpen, setIsCropModalOpen] = useState(false);
  const [editingTarget, setEditingTarget] = useState<Target | null>(null);
  const [cropSourceImage, setCropSourceImage] = useState<string>('');
  const [timerCropTargetId, setTimerCropTargetId] = useState<string | null>(null);
  const [timerCropCallback, setTimerCropCallback] = useState<((url: string) => void) | null>(null);

  const [isRoiModalOpen, setIsRoiModalOpen] = useState(false);
  const [roiTarget, setRoiTarget] = useState<Target | null>(null);

  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isSourcePickerOpen, setIsSourcePickerOpen] = useState(false);

  // 軟體更新。開機自動檢查一次，有新版才跳出來；presetInfo 是那次檢查的結果，
  // 手動從設定裡打開時傳 null，讓對話框自己重新查一次。
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [autoUpdateInfo, setAutoUpdateInfo] = useState<UpdateInfo | null>(null);

  // Browser Notification Status
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  );

  // Save rules and timers to storage & sync to other windows
  const handleUpdateRules = (newRules: ImageComboRule[]) => {
    setRules(newRules);
    try {
      localStorage.setItem(RULES_STORAGE_KEY, JSON.stringify(newRules));
    } catch {}
  };

  const handleUpdateTimers = (newTimers: CooldownTimer[]) => {
    setTimers(newTimers);
    try {
      localStorage.setItem(TIMERS_STORAGE_KEY, JSON.stringify(newTimers));
      window.electronAPI?.syncTimersData?.({ timers: newTimers });
    } catch {}
  };

  const [floatingIconSize, setFloatingIconSize] = useState<number>(() => {
    try {
      const raw = localStorage.getItem('screen_detector_floating_icon_size_v1');
      return raw ? Number(raw) : 46;
    } catch {
      return 46;
    }
  });

  const [floatingTextSize, setFloatingTextSize] = useState<number>(() => {
    try {
      const raw = localStorage.getItem('screen_detector_floating_text_size_v1');
      return raw ? Number(raw) : 13;
    } catch {
      return 13;
    }
  });

  const [floatingShowName, setFloatingShowName] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem('screen_detector_floating_show_name_v1');
      return raw !== null ? raw === 'true' : true;
    } catch {
      return true;
    }
  });

  const handleChangeFloatingOpacity = (op: number) => {
    setFloatingOpacity(op);
    try {
      localStorage.setItem(FLOATING_OPACITY_KEY, String(op));
      window.electronAPI?.syncTimersData?.({ opacity: op });
    } catch {}
  };

  const handleChangeFloatingLayout = (l: 'horizontal' | 'vertical') => {
    setFloatingLayout(l);
    try {
      localStorage.setItem(FLOATING_LAYOUT_KEY, l);
      window.electronAPI?.syncTimersData?.({ layout: l });
    } catch {}
  };

  const handleChangeFloatingIconSize = (size: number) => {
    setFloatingIconSize(size);
    try {
      localStorage.setItem('screen_detector_floating_icon_size_v1', String(size));
      window.electronAPI?.syncTimersData?.({ iconSize: size });
    } catch {}
  };

  const handleChangeFloatingTextSize = (size: number) => {
    setFloatingTextSize(size);
    try {
      localStorage.setItem('screen_detector_floating_text_size_v1', String(size));
      window.electronAPI?.syncTimersData?.({ textSize: size });
    } catch {}
  };

  const handleToggleFloatingShowName = (show: boolean) => {
    setFloatingShowName(show);
    try {
      localStorage.setItem('screen_detector_floating_show_name_v1', String(show));
      window.electronAPI?.syncTimersData?.({ showName: show });
    } catch {}
  };

  const handleToggleFloatingWidget = (show: boolean) => {
    setShowFloatingWidget(show);
    try {
      localStorage.setItem(FLOATING_WIDGET_KEY, show ? 'true' : 'false');
    } catch {}

    if (window.electronAPI?.openFloatingWindow) {
      if (show) {
        window.electronAPI.openFloatingWindow();
      } else {
        window.electronAPI.closeFloatingWindow();
      }
    }
  };

  // Listen to window storage events & IPC sync for timers
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === TIMERS_STORAGE_KEY && e.newValue) {
        try {
          setTimers(JSON.parse(e.newValue));
        } catch {}
      }
    };
    window.addEventListener('storage', handleStorage);

    let removeSyncListener: (() => void) | undefined;
    if (window.electronAPI?.onTimersDataSynced) {
      removeSyncListener = window.electronAPI.onTimersDataSynced((data) => {
        if (data.timers) {
          setTimers(data.timers);
        }
      });
    }

    return () => {
      window.removeEventListener('storage', handleStorage);
      if (removeSyncListener) removeSyncListener();
    };
  }, []);

  // Precision Real-World Clock Timer Tick Interval (100% immune to background/lag slowdown)
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();

      setTimers((prev) => {
        let changed = false;
        const next = prev.map((t) => {
          if (!t.isRunning || t.enabled === false) return t;

          const endsAt = t.endsAt || (now + t.remainingSeconds * 1000);
          const rawRemaining = Math.max(0, (endsAt - now) / 1000);
          const newRemaining = Math.round(rawRemaining * 10) / 10;
          changed = true;

          // ── Check Lead Warning (提前幾秒提示) ──
          let leadTriggered = t.leadTriggered || false;
          if (t.leadSeconds > 0 && newRemaining <= t.leadSeconds && newRemaining > 0 && !leadTriggered) {
            leadTriggered = true;
            if (t.soundOnLead && settings.enableAudio) {
              const leadVol = (t.leadVolume ?? 0.8) * settings.masterVolume;
              playAlertSound(t.leadSoundType || 'beep', leadVol);
            }
            if (t.speakOnLead) {
              const leadText = t.customLeadSpeakText?.trim() || `${t.name} 快好了`;
              speakAlert(leadText, settings.speechVolume ?? 1.0);
            }
          }

          // ── Check Completion (倒數結束) ──
          if (newRemaining <= 0) {
            if (t.soundOnComplete && settings.enableAudio) {
              const compVol = (t.volume ?? 0.8) * settings.masterVolume;
              playAlertSound(t.soundType || 'double_ding', compVol, t.customSoundDataUrl);
            }
            if (t.speakOnComplete) {
              const compText = t.customSpeakText?.trim() || `${t.name} 計時完成`;
              speakAlert(compText, settings.speechVolume ?? 1.0);
            }

            // If auto-loop mode is active, restart automatically!
            if (t.mode === 'loop') {
              return {
                ...t,
                remainingSeconds: t.durationSeconds,
                isRunning: true,
                startedAt: now,
                endsAt: now + t.durationSeconds * 1000,
                leadTriggered: false,
              };
            } else {
              return {
                ...t,
                remainingSeconds: t.durationSeconds,
                isRunning: false,
                startedAt: undefined,
                endsAt: undefined,
                leadTriggered: false,
              };
            }
          }

          return {
            ...t,
            remainingSeconds: newRemaining,
            endsAt,
            leadTriggered,
          };
        });

        return changed ? next : prev;
      });
    }, 50);

    return () => clearInterval(interval);
  }, [settings.enableAudio, settings.masterVolume, settings.speechVolume]);

  // Global Hotkey Trigger Action (Timers countdown + Rules toggle)
  const triggerHotkey = useCallback(
    (hotkey: string, specificTimerId?: string, specificRuleId?: string) => {
      const cleanKey = hotkey.trim().toUpperCase();
      const now = Date.now();

      // 1. Check timers
      setTimers((prev) =>
        prev.map((t) => {
          if (
            (specificTimerId ? t.id === specificTimerId : t.hotkey.trim().toUpperCase() === cleanKey) &&
            t.enabled !== false
          ) {
            return {
              ...t,
              isRunning: true,
              remainingSeconds: t.durationSeconds,
              startedAt: now,
              endsAt: now + t.durationSeconds * 1000,
              leadTriggered: false,
            };
          }
          return t;
        })
      );

      // 2. Check rules (Toggle enable state)
      setRules((prev) =>
        prev.map((r) => {
          if (
            specificRuleId
              ? r.id === specificRuleId
              : r.hotkey && r.hotkey.trim().toUpperCase() === cleanKey
          ) {
            const nextEnabled = !r.enabled;
            speakAlert(`條件聯動 ${r.name} ${nextEnabled ? '已啟用' : '已停用'}`, settings.speechVolume ?? 1.0);
            return { ...r, enabled: nextEnabled };
          }
          return r;
        })
      );
    },
    [settings.speechVolume]
  );

  // 1. Permanent Global Hotkey Listener (Mounted ONCE on startup)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = (document.activeElement?.tagName || '').toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea') return;
      triggerHotkey(e.key);
    };

    window.addEventListener('keydown', handleKeyDown);

    let removeListener: (() => void) | undefined;
    if (window.electronAPI?.onGlobalHotkeyTriggered) {
      removeListener = window.electronAPI.onGlobalHotkeyTriggered((data) => {
        if (data.hotkey) {
          triggerHotkey(data.hotkey, data.timerId, data.ruleId);
        }
      });
    }

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (removeListener) removeListener();
    };
  }, [triggerHotkey]);

  // 2. Register Hotkeys with Electron for both Timers and Combo Rules
  const hotkeySignature =
    timers.map((t) => `${t.id}:${t.hotkey}:${t.enabled !== false ? '1' : '0'}`).join('|') +
    '###' +
    rules.map((r) => `${r.id}:${r.hotkey || ''}:${r.enabled ? '1' : '0'}`).join('|');

  useEffect(() => {
    if (!window.electronAPI?.registerGlobalHotkey) return;

    window.electronAPI.unregisterAllHotkeys?.().then(() => {
      timers.forEach((t) => {
        if (t.hotkey && t.enabled !== false) {
          window.electronAPI?.registerGlobalHotkey?.({ hotkey: t.hotkey, timerId: t.id });
        }
      });
      rules.forEach((r) => {
        if (r.hotkey) {
          window.electronAPI?.registerGlobalHotkey?.({ hotkey: r.hotkey, ruleId: r.id });
        }
      });
    });
  }, [hotkeySignature]);

  // 待審核人數只有管理員看得到，而且要問後端才知道（帳號已不在本機）。
  const refreshPendingCount = useCallback(async () => {
    if (currentUser?.role !== 'admin') {
      setPendingUsersCount(0);
      return;
    }
    const result = await adminListUsers();
    if (result.success && result.data) {
      setPendingUsersCount(result.data.filter((u) => u.status === 'pending').length);
    }
  }, [currentUser?.role]);

  useEffect(() => {
    void refreshPendingCount();
    // 這是網路請求，不像舊版讀 localStorage 那麼便宜，所以改成一分鐘一次。
    const interval = setInterval(() => void refreshPendingCount(), 60_000);
    return () => clearInterval(interval);
  }, [refreshPendingCount]);

  /**
   * 開機檢查更新。晚幾秒再問，免得跟啟動時的登入驗證擠在一起；只有真的有新版、
   * 而且使用者沒有對那個版本按過「跳過此版本」時才會跳出來。
   */
  useEffect(() => {
    if (isNativeFloatingWindow) return;
    const api = updateApi();
    if (!api?.checkForUpdate) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void api.checkForUpdate!().then((info) => {
        if (cancelled || !info.ok || !info.hasUpdate) return;
        let skipped = '';
        try {
          skipped = localStorage.getItem(SKIPPED_VERSION_KEY) || '';
        } catch {}
        if (skipped && skipped === info.latestVersion) return;
        setAutoUpdateInfo(info);
        setIsUpdateModalOpen(true);
      });
    }, 4000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isNativeFloatingWindow]);

  /**
   * 跟後端重新確認登入狀態。啟動時做一次，之後每 10 分鐘一次，切回前景時也做一次——
   * 管理員在後台停用或讓帳號到期後，其他電腦最慢十分鐘內就會被登出。
   */
  useEffect(() => {
    if (isNativeFloatingWindow) return;
    clearLegacyLocalData();

    let cancelled = false;
    const verify = async () => {
      const outcome = await revalidateSession();
      if (cancelled) return;
      if (outcome.user) {
        setCurrentUser(outcome.user);
        setSessionNotice(
          outcome.offline && outcome.graceRemainingDays !== undefined
            ? `目前連不上帳號伺服器，離線可再使用 ${outcome.graceRemainingDays} 天。`
            : '',
        );
        return;
      }
      // 沒有帳號可用：可能本來就沒登入，也可能是被停用／到期。
      setCurrentUser(null);
      setIsUserManagementOpen(false);
      setIsAuthModalOpen(true);
      setSessionNotice(outcome.message ?? '');
    };

    void verify();
    const interval = setInterval(() => void verify(), 600_000);
    const onFocus = () => void verify();
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [isNativeFloatingWindow]);

  // Request browser notification
  const handleRequestNotification = () => {
    if (typeof Notification !== 'undefined') {
      Notification.requestPermission().then((perm) => {
        setNotificationPermission(perm);
      });
    }
  };

  // Auth Callbacks
  const handleLoginSuccess = (user: UserAccount) => {
    setCurrentUser(user);
    setIsAuthModalOpen(false);
    setSessionNotice('');
  };

  const handleLogout = () => {
    void logoutUser();
    clearCurrentSession();
    setCurrentUser(null);
    setIsAuthModalOpen(true);
    setIsUserManagementOpen(false);
    setSessionNotice('');
  };

  // Save config wrapper
  const updateConfig = (newConfig: AppConfig) => {
    setConfig(newConfig);
    saveConfigToStorage(newConfig);
  };

  const handleUpdateSettings = (newSettings: GlobalSettings) => {
    updateConfig({ ...config, settings: newSettings });
  };

  const handleUpdateTarget = (updated: Target) => {
    clearTemplateCache(updated.id);
    const newTargets = targets.map((t) => (t.id === updated.id ? updated : t));
    updateConfig({ ...config, targets: newTargets });
  };

  const handleDeleteTarget = (targetId: string) => {
    clearTemplateCache(targetId);
    const newTargets = targets.filter((t) => t.id !== targetId);
    updateConfig({ ...config, targets: newTargets });
  };

  const handleDuplicateTarget = (target: Target) => {
    const duplicated: Target = {
      ...target,
      id: `target_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      name: `${target.name} (複製)`,
      lastTriggeredAt: undefined,
      currentSimilarity: undefined,
    };
    updateConfig({ ...config, targets: [...targets, duplicated] });
  };

  // ── 子目錄 (groups) ──
  // Order within a group is just the order of the `targets` array, so a drag only
  // rewrites that array (plus the dragged card's groupId) and never needs an
  // extra per-group index that could drift out of sync.

  /** Replace the whole target array, e.g. after a drag reorder. */
  const handleReorderTargets = (newTargets: Target[]) => {
    updateConfig({ ...config, targets: newTargets });
  };

  const handleUpdateGroups = (newGroups: TargetGroup[]) => {
    updateConfig({ ...config, groups: newGroups });
  };

  const handleAddGroup = () => {
    const newGroup: TargetGroup = {
      id: `group_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      name: `新子目錄 ${groups.length + 1}`,
      collapsed: false,
    };
    updateConfig({ ...config, groups: [...groups, newGroup] });
  };

  /**
   * Delete a group. The targets inside are kept and fall back to 未分類 —
   * deleting a folder should never silently destroy work.
   */
  const handleDeleteGroup = (groupId: string) => {
    updateConfig({
      ...config,
      groups: groups.filter((g) => g.id !== groupId),
      targets: targets.map((t) => (t.groupId === groupId ? { ...t, groupId: null } : t)),
    });
  };

  /** Apply one patch to every target in a group at once (批次編輯). */
  const handleBulkUpdateTargets = (targetIds: string[], patch: Partial<Target>) => {
    const ids = new Set(targetIds);
    targetIds.forEach((id) => clearTemplateCache(id));
    updateConfig({
      ...config,
      targets: targets.map((t) => (ids.has(t.id) ? { ...t, ...patch } : t)),
    });
  };

  const handleDeleteTargets = (targetIds: string[]) => {
    const ids = new Set(targetIds);
    targetIds.forEach((id) => clearTemplateCache(id));
    updateConfig({ ...config, targets: targets.filter((t) => !ids.has(t.id)) });
  };

  const handleExportConfig = () => {
    exportConfigAsJson(config);
  };

  const handleImportConfig = async (file: File) => {
    try {
      const imported = await importConfigFromJson(file);
      clearTemplateCache();
      updateConfig(imported);
      playAlertSound('chime', settings.masterVolume);
    } catch (err) {
      alert((err as Error).message || '設定檔匯入失敗！');
    }
  };

  // Desktop Stream Setup
  const handleStartCapture = async () => {
    if (window.electronAPI?.getDesktopSources) {
      setIsSourcePickerOpen(true);
    } else {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: 60, max: 60 } },
          audio: false,
        });
        // Browser path: no source id, so auto-click falls back to raw frame
        // coordinates (which is all it ever had here).
        captureSourceIdRef.current = null;
        captureGeoRef.current = { at: 0, rect: null };
        attachStreamToVideo(stream);
      } catch (err) {
        console.warn('Screen capture cancelled or failed:', err);
      }
    }
  };

  const handleSelectSource = async (source: DesktopSource) => {
    setIsSourcePickerOpen(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          // @ts-ignore
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: source.id,
            minFrameRate: 30,
            maxFrameRate: 60,
          },
        },
      });
      // Remembered so auto-click can ask the main process where this source is.
      captureSourceIdRef.current = source.id;
      captureGeoRef.current = { at: 0, rect: null };
      // Warm the lookup up now (and with it PowerShell's one-off Add-Type
      // compile) so the first rule that fires already has real geometry. The
      // result is deliberately discarded: without the frame size the screen
      // branch cannot verify which monitor it picked.
      if (window.electronAPI?.getCaptureGeometry) {
        void window.electronAPI.getCaptureGeometry(source.id, 0, 0).catch(() => null);
      }
      attachStreamToVideo(stream);
    } catch (err) {
      console.error('Failed to capture selected source:', err);
    }
  };

  const attachStreamToVideo = (stream: MediaStream) => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
    }
    streamRef.current = stream;

    stream.getVideoTracks()[0].onended = () => {
      handleStopCapture();
    };

    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }

    setIsStreamActive(true);
    setIsPaused(false);
  };

  const handleStopCapture = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    captureSourceIdRef.current = null;
    captureGeoRef.current = { at: 0, rect: null };
    setIsStreamActive(false);
    setIsPaused(false);
    setLatestMatches([]);
    latestMatchesRef.current = [];
    setFps(0);
    setLatencyMs(0);
  };

  // Crop & ROI Modals Handling
  const handleOpenCropModal = (
    target: Target | null = null,
    timerId?: string,
    onTimerCropDone?: (dataUrl: string) => void
  ) => {
    if (!videoRef.current || !isStreamActive) {
      alert('請先點擊「開始擷取視窗」以進行即時截圖！');
      return;
    }

    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    const w = video.videoWidth || sourceWidth;
    const h = video.videoHeight || sourceHeight;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);

    setCropSourceImage(canvas.toDataURL('image/png'));
    setEditingTarget(target);
    setTimerCropTargetId(timerId || (onTimerCropDone ? '__timer_modal__' : null));
    setTimerCropCallback(() => onTimerCropDone || null);
    setIsCropModalOpen(true);
  };

  const handleSaveTargetFromCrop = (targetData: Partial<Target>) => {
    if (editingTarget) {
      clearTemplateCache(editingTarget.id);
      const updated: Target = {
        ...editingTarget,
        ...targetData,
        imageWidth: targetData.imageWidth || editingTarget.imageWidth,
        imageHeight: targetData.imageHeight || editingTarget.imageHeight,
        imageDataUrl: targetData.imageDataUrl || editingTarget.imageDataUrl,
      };
      handleUpdateTarget(updated);
    } else {
      const newTarget: Target = {
        id: `target_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        name: targetData.name || `目標 #${targets.length + 1}`,
        enabled: true,
        color: targetData.color || '#10B981',
        imageDataUrl: targetData.imageDataUrl || '',
        imageWidth: targetData.imageWidth || 50,
        imageHeight: targetData.imageHeight || 50,
        groupId: targetData.groupId ?? null,
        threshold: targetData.threshold || 0.8,
        cooldownSeconds: targetData.cooldownSeconds || 3,
        // Keep the ROI the crop dialog produced (e.g. "auto-limit search area"),
        // instead of silently discarding it on first save.
        normalizedRoi: targetData.normalizedRoi ?? null,
        soundType: targetData.soundType || 'chime',
        volume: targetData.volume ?? 0.8,
        speechVolume: targetData.speechVolume ?? 1,
        speakName: targetData.speakName || false,
        browserNotification: targetData.browserNotification || false,
      };
      updateConfig({ ...config, targets: [...targets, newTarget] });
    }
    setIsCropModalOpen(false);
    setEditingTarget(null);
    setTimerCropTargetId(null);
    setTimerCropCallback(null);
  };

  const handleSaveTimerIcon = (imageDataUrl: string) => {
    if (timerCropCallback) {
      timerCropCallback(imageDataUrl);
    } else if (timerCropTargetId && timerCropTargetId !== '__timer_modal__') {
      handleUpdateTimers(
        timers.map((t) => (t.id === timerCropTargetId ? { ...t, imageDataUrl } : t))
      );
    }
    setTimerCropTargetId(null);
    setTimerCropCallback(null);
    setIsCropModalOpen(false);
  };

  const handleOpenRoiModal = (target: Target) => {
    if (!videoRef.current || !isStreamActive) return;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    const w = video.videoWidth || sourceWidth;
    const h = video.videoHeight || sourceHeight;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);

    setCropSourceImage(canvas.toDataURL('image/png'));
    setRoiTarget(target);
    setIsRoiModalOpen(true);
  };

  const handleSaveRoi = (_targetId: string, roi: { x: number; y: number; width: number; height: number } | null) => {
    if (!roiTarget) return;
    const updated: Target = {
      ...roiTarget,
      normalizedRoi: roi,
    };
    handleUpdateTarget(updated);
    setIsRoiModalOpen(false);
    setRoiTarget(null);
  };

  // ── Detection result handling (runs on the main thread, no pixel work) ──
  const scanStartRef = useRef(0);
  const lastSimTickRef = useRef(0);
  const [, setSimTick] = useState(0);

  // Which desktopCapturer source is being captured, and where it sits on the
  // desktop. Detection boxes are in capture-frame pixels; a click needs physical
  // desktop pixels, and the two only coincide for a single unscaled monitor.
  const captureSourceIdRef = useRef<string | null>(null);
  const captureGeoRef = useRef<{
    at: number;
    rect: { x: number; y: number; width: number; height: number } | null;
  }>({ at: 0, rect: null });

  const performMappedClick = useCallback(
    async (
      action: string,
      frameX: number,
      frameY: number,
      frameW: number,
      frameH: number,
      returnToCenter: boolean
    ) => {
      if (!window.electronAPI?.performMouseAction) return;

      let rect: { x: number; y: number; width: number; height: number } | null = null;
      const sourceId = captureSourceIdRef.current;
      if (sourceId && window.electronAPI.getCaptureGeometry) {
        // Re-read the geometry every 250ms so a window that gets moved or
        // resized mid-session is still clicked correctly, without paying an IPC
        // round trip on every rule evaluation. A failed lookup is never cached:
        // the very first one can fail while the PowerShell worker is still
        // compiling, and caching that would keep clicking raw coordinates.
        const now = Date.now();
        if (captureGeoRef.current.rect && now - captureGeoRef.current.at < 250) {
          rect = captureGeoRef.current.rect;
        } else {
          try {
            rect = await window.electronAPI.getCaptureGeometry(sourceId, frameW, frameH);
          } catch {
            rect = null;
          }
          if (rect) captureGeoRef.current = { at: now, rect };
        }
      }

      let screenX = frameX;
      let screenY = frameY;
      if (rect && frameW > 0 && frameH > 0 && rect.width > 0 && rect.height > 0) {
        // The capture is a scaled copy of the source rect, so the mapping is a
        // straight ratio plus the source's desktop offset.
        screenX = rect.x + frameX * (rect.width / frameW);
        screenY = rect.y + frameY * (rect.height / frameH);
      }

      window.electronAPI.performMouseAction({
        action,
        screenX: Math.round(screenX),
        screenY: Math.round(screenY),
        returnToCenter,
      });
    },
    []
  );

  rulesRef.current = rules;

  const applyDetectionResults = useCallback(
    (
      results: { targetId: string; score: number; box: Rect }[],
      rawW: number,
      rawH: number,
      activeTargets: Target[]
    ) => {
      const now = Date.now();
      const video = videoRef.current;
      const currentMatches: MatchResult[] = [...latestMatchesRef.current];
      let matchesChanged = false;

      for (const res of results) {
        const target = activeTargets.find((t) => t.id === res.targetId);
        if (!target) continue;

        const { score, box } = res;
        target.currentSimilarity = score;

        const existingIdx = currentMatches.findIndex((m) => m.targetId === target.id);

        if (score < target.threshold) {
          if (existingIdx >= 0) {
            currentMatches.splice(existingIdx, 1);
            matchesChanged = true;
          }
          continue;
        }

        const matchEntry: MatchResult = {
          targetId: target.id,
          targetName: target.name,
          color: target.color,
          similarity: score,
          box,
          normalizedBox: {
            x: box.x / rawW,
            y: box.y / rawH,
            width: box.width / rawW,
            height: box.height / rawH,
          },
          timestamp: now,
        };

        if (existingIdx >= 0) {
          const prev = currentMatches[existingIdx];
          if (
            prev.box.x !== box.x ||
            prev.box.y !== box.y ||
            Math.abs(prev.similarity - score) > 0.005
          ) {
            matchesChanged = true;
          }
          currentMatches[existingIdx] = matchEntry;
        } else {
          currentMatches.push(matchEntry);
          matchesChanged = true;
        }

        // Cooldown check
        const timeSinceLast = target.lastTriggeredAt ? (now - target.lastTriggeredAt) / 1000 : 999;
        if (timeSinceLast < target.cooldownSeconds) continue;
        target.lastTriggeredAt = now;

        if (settings.enableAudio) {
          const targetVol = (target.volume ?? 0.8) * settings.masterVolume;
          playAlertSound(target.soundType, targetVol, target.customSoundDataUrl);
        }
        if (target.speakName) {
          speakAlert(
            `偵測到 ${target.name}`,
            (target.speechVolume ?? 1) * (settings.speechVolume ?? 1.0)
          );
        }
        if (target.browserNotification) {
          triggerBrowserNotification(
            `🎯 偵測到目標：${target.name}`,
            `相似度匹配率達 ${(score * 100).toFixed(1)}%`
          );
        }
        if (settings.flashScreenOnHit) {
          setScreenFlash(target.color);
          setTimeout(() => setScreenFlash(null), 350);
        }
        if (settings.confettiOnHit) {
          confetti({
            particleCount: 35,
            spread: 60,
            origin: { y: 0.8 },
            colors: [target.color, '#FFFFFF', '#10B981'],
          });
        }

        if (video) {
          try {
            const snapshot = cropImageFromSource(video, box);
            setLogs((prev) => [
              {
                id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                targetId: target.id,
                targetName: target.name,
                color: target.color,
                similarity: score,
                timestamp: now,
                snapshotDataUrl: snapshot.dataUrl,
                box,
              },
              ...prev.slice(0, 49),
            ]);
          } catch {}
        }
      }

      // ── Multi-Condition Image Automation Action Rules ──
      for (const rule of rulesRef.current) {
        if (!rule.enabled) continue;

        const allowedAIds =
          rule.targetIdsA && rule.targetIdsA.length > 0
            ? rule.targetIdsA
            : rule.targetIdA
            ? [rule.targetIdA]
            : [];
        if (allowedAIds.length === 0) continue;

        const matchA = currentMatches.find((m) => allowedAIds.includes(m.targetId));
        if (!matchA) continue;

        if (rule.targetIdB) {
          const matchB = currentMatches.find((m) => m.targetId === rule.targetIdB);
          if (!matchB) continue;
        }

        const timeSinceLastRule = rule.lastTriggeredAt ? (now - rule.lastTriggeredAt) / 1000 : 999;
        if (timeSinceLastRule < rule.cooldownSeconds) continue;
        rule.lastTriggeredAt = now;

        const centerX = matchA.box.x + matchA.box.width / 2;
        const centerY = matchA.box.y + matchA.box.height / 2;

        if (settings.enableAudio && (rule.action === 'sound_only' || rule.soundType)) {
          const ruleVol = (rule.volume ?? 0.8) * settings.masterVolume;
          playAlertSound(rule.soundType || 'double_ding', ruleVol);
        }

        if (window.electronAPI?.performMouseAction) {
          void performMappedClick(
            rule.action,
            centerX,
            centerY,
            rawW,
            rawH,
            rule.returnToCenter !== false
          );
        }
      }

      latestMatchesRef.current = currentMatches;

      // Re-rendering the whole tree on every single frame was a large part of
      // the perceived stutter. Only publish when the overlay would actually
      // change, and refresh the live similarity readouts a few times a second.
      if (matchesChanged) {
        setLatestMatches([...currentMatches]);
      }
      const nowPerf = performance.now();
      if (nowPerf - lastSimTickRef.current > 250) {
        lastSimTickRef.current = nowPerf;
        setSimTick((v) => v + 1);
      }
    },
    [settings, performMappedClick]
  );

  // ═══════════════════════════════════════════════════════════════════
  // WebGPU probe
  //
  // Asking for an adapter is the only reliable way to know: `navigator.gpu` can
  // exist on a machine whose driver is blocklisted. The race guards against a
  // driver that never answers — three seconds and we take the CPU path.
  //
  // Detection always *starts* on the CPU pool even when an adapter exists: the
  // first second of frame times is the baseline the GPU path has to beat.
  // ═══════════════════════════════════════════════════════════════════
  useEffect(() => {
    let alive = true;
    const decide = (available: boolean) => {
      if (!alive) return;
      gpuAvailableRef.current = available;
      setGpuMode('cpu');
    };
    (async () => {
      try {
        const gpu = (
          navigator as unknown as { gpu?: { requestAdapter(o?: unknown): Promise<unknown> } }
        ).gpu;
        if (!gpu) return decide(false);
        const adapter = await Promise.race([
          gpu.requestAdapter({ powerPreference: 'high-performance' }),
          new Promise((r) => setTimeout(() => r(null), 3000)),
        ]);
        decide(!!adapter);
      } catch {
        decide(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // ═══════════════════════════════════════════════════════════════════
  // Off-Thread Detection Engine
  //
  // Every pixel operation (frame decode + template matching) happens inside a
  // pool of Web Workers, with the enabled targets sharded round-robin across
  // them. The main thread only grabs an ImageBitmap per worker, transfers them,
  // and reacts to the merged scores — so the UI stays smooth with 15+ targets
  // and the search itself runs on several cores instead of one.
  // ═══════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!isStreamActive || isPaused || isCropModalOpen || isRoiModalOpen) return;
    // Wait for the adapter probe rather than starting on the CPU and swapping a
    // few milliseconds later: that swap would tear down a live worker pool.
    if (gpuMode === 'probing') return;

    let isScanning = true;
    let scanTimeoutId: number;
    let inFlight = false;
    let frameSeq = 0;

    const scanIntervalMs = settings.scanFps >= 60 ? 16 : Math.max(16, Math.floor(1000 / settings.scanFps));

    const enabledTargets = targets.filter((t) => t.enabled);

    // Each worker gets a shard of the *targets* and a full-frame copy, so it
    // pays the per-frame fixed cost (gray + pyramid, ~24ms) once and then only
    // searches its own targets. Splitting the frame into overlapping bands
    // instead was measured to nearly double the total CPU work — the overlap
    // rows get searched twice and every band re-pays the setup — so the target
    // split stays and the pool is simply allowed to use more cores.
    // One core is left for the UI and the compositor; more workers than targets
    // would only idle.
    //
    // On the GPU path none of that applies: the sweep is on the card and the only
    // CPU work left is one readback plus the refinement of a few candidates, so a
    // single worker holds every target — a second one would just mean a second
    // device, a second frame upload and a second copy of the same planes.
    const useGpu = gpuMode === 'gpu';
    const cores = navigator.hardwareConcurrency || 4;
    const poolSize = useGpu
      ? 1
      : Math.max(1, Math.min(8, cores - 1, enabledTargets.length || 1));

    const workers: Worker[] = [];
    for (let i = 0; i < poolSize; i++) {
      // Both URLs are written out in full: the bundler resolves worker entry
      // points statically, so a computed path would not be bundled at all.
      workers.push(
        useGpu
          ? new Worker(new URL('./workers/gpuDetectionWorker.ts', import.meta.url))
          : new Worker(new URL('./workers/detectionWorker.ts', import.meta.url))
      );
    }

    const toSpec = (t: Target) => ({
      id: t.id,
      imageDataUrl: t.imageDataUrl,
      imageWidth: t.imageWidth,
      imageHeight: t.imageHeight,
      threshold: t.threshold,
      normalizedRoi: t.normalizedRoi || null,
    });

    // Round-robin the targets so a run of expensive (large) templates does not
    // all land on the same worker.
    const shards: Target[][] = workers.map(() => []);
    enabledTargets.forEach((t, i) => shards[i % workers.length].push(t));

    workers.forEach((w, i) => {
      w.postMessage({
        type: 'targets',
        algorithm: settings.matchAlgorithm,
        targets: shards[i].map(toSpec),
      });
    });

    let awaiting = 0;
    let mergedResults: { targetId: string; score: number; box: Rect }[] = [];
    let mergedWidth = 0;
    let mergedHeight = 0;

    // ── Backend trial ──
    //
    // Frame times are collected in whichever backend is running. The first
    // window measures the pool, the second measures the GPU, and the GPU keeps
    // the job only if its median is not worse. The first eight frames of each
    // window are dropped: worker startup, shader compilation and the GPU
    // self-test all land there and none of them repeat.
    const recordFrameTime = (ms: number) => {
      const trial = backendTrialRef.current;
      if (trial.verdict !== 'unknown') return;
      if (trial.targets !== enabledTargets.length) {
        trial.targets = enabledTargets.length;
        trial.cpuMedian = null;
        trial.samples = [];
        return;
      }
      trial.samples.push(ms);
      if (trial.samples.length < 24) return;
      const median = trial.samples.slice(8).sort((a, b) => a - b)[8];
      trial.samples = [];
      if (!useGpu) {
        if (!gpuAvailableRef.current) {
          trial.verdict = 'cpu-only';
          return;
        }
        trial.cpuMedian = median;
        setGpuMode('gpu');
      } else if (trial.cpuMedian !== null && median > trial.cpuMedian * 1.1) {
        trial.verdict = 'slow';
        setGpuMode('cpu');
      } else {
        trial.verdict = 'ok';
      }
    };

    // ── Idle gate ──
    //
    // Each worker reports whether the frame it received was byte-identical to
    // the previous one. While the captured screen is completely still, there is
    // nothing new to search, so the pool is put to sleep and only one worker
    // keeps watching for the first changed pixel. That is the difference between
    // burning every core on a motionless screen and using almost nothing.
    let gateMode = false;
    let frameAllUnchanged = true;
    /** Last complete score set, used to fill in the shards that are asleep. */
    let lastMerged: { targetId: string; score: number; box: Rect }[] = [];

    const scanTick = async () => {
      if (!isScanning) return;
      if (inFlight) {
        scanTimeoutId = window.setTimeout(scanTick, 4);
        return;
      }

      const video = videoRef.current;
      if (!video || video.readyState < 2 || enabledTargets.length === 0) {
        scanTimeoutId = window.setTimeout(scanTick, scanIntervalMs);
        return;
      }

      const rawW = video.videoWidth || sourceWidth;
      const rawH = video.videoHeight || sourceHeight;
      if (rawW <= 0 || rawH <= 0) {
        scanTimeoutId = window.setTimeout(scanTick, scanIntervalMs);
        return;
      }
      if (rawW !== sourceWidth) setSourceWidth(rawW);
      if (rawH !== sourceHeight) setSourceHeight(rawH);

      inFlight = true;
      scanStartRef.current = performance.now();
      const frameId = ++frameSeq;
      mergedResults = [];
      frameAllUnchanged = true;
      awaiting = 0;
      // Asleep: only the first worker gets a frame, so the CPU cost of a still
      // screen is one readback and one memcmp instead of a full search per core.
      const active = gateMode ? workers.slice(0, 1) : workers;
      try {
        // One bitmap per worker: a transferred ImageBitmap belongs to exactly one
        // thread, so it cannot be shared. createImageBitmap on a <video> is
        // GPU-side and does not block on pixel readback the way getImageData did.
        const bitmaps = await Promise.all(active.map(() => createImageBitmap(video)));
        if (!isScanning) {
          bitmaps.forEach((b) => b.close());
          return;
        }
        awaiting = active.length;
        active.forEach((w, i) => {
          w.postMessage(
            {
              type: 'frame',
              frameId,
              bitmap: bitmaps[i],
              bandY: 0,
              fullWidth: rawW,
              fullHeight: rawH,
            },
            [bitmaps[i]]
          );
        });
      } catch {
        inFlight = false;
        awaiting = 0;
        if (isScanning) scanTimeoutId = window.setTimeout(scanTick, scanIntervalMs);
      }
    };

    const onWorkerMessage = (event: MessageEvent) => {
      const data = event.data;
      // The GPU worker reports the outcome of its startup self-test. A failure
      // switches this effect to the CPU pool for the rest of the session, which
      // is the whole point of the test: a wrong shader must cost a frame, not
      // silently turn every target into "not on screen".
      if (data?.type === 'mode') {
        setGpuActive(!!data.gpu);
        if (!data.gpu) {
          // A self-test failure is permanent for this session: do not trial it
          // again, the answer will not change.
          backendTrialRef.current.verdict = 'slow';
          setGpuMode('cpu');
        }
        return;
      }
      if (data?.type !== 'result') return;
      if (!isScanning || data.frameId !== frameSeq) return;

      if (!data.unchanged) frameAllUnchanged = false;

      // Every worker now reports on every target, so the same target can come
      // back from two overlapping bands. Keep the strongest hit per target.
      for (const r of data.results as { targetId: string; score: number; box: Rect }[]) {
        const existing = mergedResults.find((m) => m.targetId === r.targetId);
        if (!existing) mergedResults.push(r);
        else if (r.score > existing.score) {
          existing.score = r.score;
          existing.box = r.box;
        }
      }
      mergedWidth = data.width;
      mergedHeight = data.height;
      awaiting--;
      // Wait until every shard has reported so the UI sees one coherent frame.
      if (awaiting > 0) return;

      // While the pool is asleep only one shard reports, so carry the previous
      // scores for the sleeping shards — the frame was identical, so they are
      // still the correct answer.
      for (const prev of lastMerged) {
        if (!mergedResults.some((m) => m.targetId === prev.targetId)) mergedResults.push(prev);
      }
      lastMerged = mergedResults;

      try {
        applyDetectionResults(mergedResults, mergedWidth, mergedHeight, enabledTargets);
      } finally {
        const scanElapsed = performance.now() - scanStartRef.current;
        recordFrameTime(scanElapsed);

        const nowMs = performance.now();
        if (nowMs - lastTelemetryUpdateRef.current > 400) {
          setLatencyMs(Math.round(scanElapsed));
          lastTelemetryUpdateRef.current = nowMs;
        }

        frameCountRef.current++;
        const nowTs = Date.now();
        if (nowTs - lastFpsCalcRef.current >= 1000) {
          setFps(frameCountRef.current);
          frameCountRef.current = 0;
          lastFpsCalcRef.current = nowTs;
        }

        // Nothing moved anywhere: keep only the watchdog shard awake next tick.
        gateMode = frameAllUnchanged;

        inFlight = false;
        if (isScanning) {
          const nextDelay = Math.max(2, scanIntervalMs - Math.round(scanElapsed));
          scanTimeoutId = window.setTimeout(scanTick, nextDelay);
        }
      }
    };

    workers.forEach((w) => {
      w.onmessage = onWorkerMessage;
    });

    scanTimeoutId = window.setTimeout(scanTick, 10);

    return () => {
      isScanning = false;
      window.clearTimeout(scanTimeoutId);
      workers.forEach((w) => {
        w.onmessage = null;
        w.terminate();
      });
      if (!useGpu) setGpuActive(false);
    };
  }, [
    isStreamActive,
    isPaused,
    isCropModalOpen,
    isRoiModalOpen,
    gpuMode,
    targets,
    rules,
    settings,
    sourceWidth,
    sourceHeight,
    applyDetectionResults,
  ]);

  // If this is the standalone Native Floating Window in Electron
  if (isNativeFloatingWindow) {
    return (
      <div className="w-screen h-screen bg-transparent select-none overflow-hidden">
        <FloatingTimerOverlay
          timers={timers}
          onTriggerTimer={(timerId) => {
            handleUpdateTimers(
              timers.map((t) =>
                t.id === timerId
                  ? { ...t, isRunning: true, remainingSeconds: t.durationSeconds, startedAt: Date.now() }
                  : t
              )
            );
          }}
          onResetTimer={(timerId) => {
            handleUpdateTimers(
              timers.map((t) =>
                t.id === timerId
                  ? { ...t, isRunning: false, remainingSeconds: t.durationSeconds, startedAt: undefined }
                  : t
              )
            );
          }}
          onClose={() => window.close()}
          opacity={floatingOpacity}
          layout={floatingLayout}
          onChangeOpacity={handleChangeFloatingOpacity}
          onChangeLayout={handleChangeFloatingLayout}
        />
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-slate-950 text-slate-100 font-sans select-none overflow-hidden min-h-0">
      {/* Visual Screen Flash on Hit */}
      {screenFlash && (
        <div
          className="fixed inset-0 pointer-events-none z-50 transition-opacity duration-300"
          style={{
            backgroundColor: screenFlash,
            opacity: 0.18,
          }}
        />
      )}

      {/* Top Main Navigation Bar */}
      <Navbar
        isStreamActive={isStreamActive}
        isPaused={isPaused}
        onStartCapture={handleStartCapture}
        onStopCapture={handleStopCapture}
        onTogglePause={() => setIsPaused(!isPaused)}
        onExportConfig={handleExportConfig}
        onImportConfig={handleImportConfig}
        onOpenSettings={() => setIsSettingsModalOpen(true)}
        settings={settings}
        onUpdateSettings={handleUpdateSettings}
        currentUser={currentUser}
        pendingUsersCount={pendingUsersCount}
        onOpenUserManagement={() => setIsUserManagementOpen(true)}
        onLogout={handleLogout}
        activeTab={activeTab}
        onChangeTab={setActiveTab}
      />

      {/* 離線寬限提示：連不上帳號伺服器時讓使用者知道還剩幾天 */}
      {currentUser && sessionNotice && (
        <div className="px-3 lg:px-4 pt-2">
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            ⚠️ {sessionNotice}
          </div>
        </div>
      )}
      {/* ── TAB 1: 🎯 即時圖像辨識與清單 (Kept mounted to preserve 60FPS video stream!) ── */}
      <main className={`flex-1 w-full p-3 lg:p-4 flex flex-col lg:flex-row gap-3 lg:gap-4 overflow-hidden min-h-0 ${
        activeTab === 'detect' ? '' : 'hidden'
      }`}>
        {/* Left Column: Direct Hardware Video Stream & Canvas HUD */}
        <section className="flex-1 h-full min-h-0 flex flex-col min-w-0">
          <LiveStreamViewer
            videoRef={videoRef}
            isStreamActive={isStreamActive}
            isPaused={isPaused}
            onTogglePause={() => setIsPaused(!isPaused)}
            onStartCapture={handleStartCapture}
            onStopCapture={handleStopCapture}
            onOpenCropModal={() => handleOpenCropModal(null)}
            targets={targets}
            latestMatches={latestMatches}
            settings={settings}
            fps={fps}
            latencyMs={latencyMs}
            gpuActive={gpuActive}
            sourceWidth={sourceWidth}
            sourceHeight={sourceHeight}
          />
        </section>

        {/* Right Column: Multi-Target Cards & Logs */}
        <section className="w-full lg:w-[460px] xl:w-[500px] flex flex-col h-full min-h-0 gap-3 shrink-0">
          {/* Target List */}
          <div className="flex-1 min-h-0 flex flex-col">
            <TargetList
              targets={targets}
              groups={groups}
              onUpdateTarget={handleUpdateTarget}
              onDeleteTarget={handleDeleteTarget}
              onDuplicateTarget={handleDuplicateTarget}
              onReorderTargets={handleReorderTargets}
              onUpdateGroups={handleUpdateGroups}
              onAddGroup={handleAddGroup}
              onDeleteGroup={handleDeleteGroup}
              onBulkUpdateTargets={handleBulkUpdateTargets}
              onDeleteTargets={handleDeleteTargets}
              onOpenRoiModal={handleOpenRoiModal}
              onEditTarget={(target) => handleOpenCropModal(target)}
              onOpenNewCrop={() => handleOpenCropModal(null)}
              isStreamActive={isStreamActive}
              masterVolume={settings.masterVolume}
            />
          </div>

          {/* Real-time Match Logs */}
          <div className="h-[210px] shrink-0 flex flex-col">
            <LogHistory
              logs={logs}
              onClearLogs={() => setLogs([])}
              masterVolume={settings.masterVolume}
            />
          </div>
        </section>
      </main>

      {/* ── TAB 2: ⚡ 進階條件聯動 ＆ 按鍵倒數計時器 ── */}
      {activeTab === 'automation' && (
        <AutomationAndTimers
          targets={targets}
          rules={rules}
          onUpdateRules={handleUpdateRules}
          timers={timers}
          onUpdateTimers={handleUpdateTimers}
          isStreamActive={isStreamActive}
          onOpenCropForTimer={(timerId, onDone) => handleOpenCropModal(null, timerId, onDone)}
          masterVolume={settings.masterVolume}
          speechVolume={settings.speechVolume}
          showFloatingWidget={showFloatingWidget}
          onToggleFloatingWidget={handleToggleFloatingWidget}
          floatingOpacity={floatingOpacity}
          onChangeFloatingOpacity={handleChangeFloatingOpacity}
          floatingLayout={floatingLayout}
          onChangeFloatingLayout={handleChangeFloatingLayout}
          floatingIconSize={floatingIconSize}
          onChangeFloatingIconSize={handleChangeFloatingIconSize}
          floatingTextSize={floatingTextSize}
          onChangeFloatingTextSize={handleChangeFloatingTextSize}
          floatingShowName={floatingShowName}
          onToggleFloatingShowName={handleToggleFloatingShowName}
        />
      )}

      {/* In-App Draggable Floating Cooldown Timers Overlay Widget (Fallback for Web/In-App) */}
      {showFloatingWidget && !window.electronAPI?.openFloatingWindow && (
        <FloatingTimerOverlay
          timers={timers}
          onTriggerTimer={(timerId) => {
            handleUpdateTimers(
              timers.map((t) =>
                t.id === timerId
                  ? { ...t, isRunning: true, remainingSeconds: t.durationSeconds, startedAt: Date.now() }
                  : t
              )
            );
          }}
          onResetTimer={(timerId) => {
            handleUpdateTimers(
              timers.map((t) =>
                t.id === timerId
                  ? { ...t, isRunning: false, remainingSeconds: t.durationSeconds, startedAt: undefined }
                  : t
              )
            );
          }}
          onClose={() => handleToggleFloatingWidget(false)}
          opacity={floatingOpacity}
          layout={floatingLayout}
          iconSize={floatingIconSize}
          textSize={floatingTextSize}
          showName={floatingShowName}
          onChangeOpacity={handleChangeFloatingOpacity}
          onChangeLayout={handleChangeFloatingLayout}
          onChangeIconSize={handleChangeFloatingIconSize}
          onChangeTextSize={handleChangeFloatingTextSize}
          onToggleShowName={handleToggleFloatingShowName}
        />
      )}

      {/* Screenshot Cropping Modal */}
      <CropModal
        isOpen={isCropModalOpen}
        onClose={() => {
          setIsCropModalOpen(false);
          setTimerCropTargetId(null);
          setTimerCropCallback(null);
        }}
        sourceImage={cropSourceImage}
        sourceWidth={sourceWidth}
        sourceHeight={sourceHeight}
        existingTargets={targets}
        onSaveTarget={handleSaveTargetFromCrop}
        editingTarget={editingTarget}
        isForTimerIcon={!!timerCropTargetId || !!timerCropCallback}
        onSaveTimerIcon={handleSaveTimerIcon}
      />

      {/* Per-Target ROI Selection Modal */}
      <RoiModal
        isOpen={isRoiModalOpen}
        onClose={() => setIsRoiModalOpen(false)}
        target={roiTarget}
        sourceImage={cropSourceImage}
        sourceWidth={sourceWidth}
        sourceHeight={sourceHeight}
        onSaveRoi={handleSaveRoi}
      />

      {/* Global Settings Modal */}
      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        settings={settings}
        onUpdateSettings={handleUpdateSettings}
        onRequestBrowserNotification={handleRequestNotification}
        notificationPermission={notificationPermission}
        onCheckForUpdate={() => {
          setAutoUpdateInfo(null);
          setIsUpdateModalOpen(true);
        }}
      />

      {/* 軟體更新（開機自動檢查，或從設定裡手動檢查） */}
      <UpdateModal
        isOpen={isUpdateModalOpen}
        onClose={() => setIsUpdateModalOpen(false)}
        presetInfo={autoUpdateInfo}
      />

      {/* Electron Desktop Window / Screen Selector Modal */}
      <SourcePickerModal
        isOpen={isSourcePickerOpen}
        onClose={() => setIsSourcePickerOpen(false)}
        onSelectSource={handleSelectSource}
      />

      {/* User Login / Registration Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onLoginSuccess={handleLoginSuccess}
        notice={sessionNotice}
      />

      {/* Admin User Approval & Permissions Management Modal */}
      {currentUser && (
        <UserManagementModal
          isOpen={isUserManagementOpen}
          onClose={() => {
            setIsUserManagementOpen(false);
            void refreshPendingCount();
          }}
          currentAdmin={currentUser}
        />
      )}
    </div>
  );
}
