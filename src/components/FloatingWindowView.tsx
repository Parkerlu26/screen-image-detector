import React, { useState, useEffect, useCallback } from 'react';
import { CooldownTimer } from '../types';
import { FloatingTimerOverlay } from './FloatingTimerOverlay';

const TIMERS_STORAGE_KEY = 'screen_detector_cooldown_timers_v1';
const FLOATING_OPACITY_KEY = 'screen_detector_floating_opacity_v1';
const FLOATING_LAYOUT_KEY = 'screen_detector_floating_layout_v1';
const FLOATING_ICON_SIZE_KEY = 'screen_detector_floating_icon_size_v1';
const FLOATING_TEXT_SIZE_KEY = 'screen_detector_floating_text_size_v1';
const FLOATING_SHOW_NAME_KEY = 'screen_detector_floating_show_name_v1';

export const FloatingWindowView: React.FC = () => {
  const [timers, setTimers] = useState<CooldownTimer[]>(() => {
    try {
      const raw = localStorage.getItem(TIMERS_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const [opacity, setOpacity] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(FLOATING_OPACITY_KEY);
      return raw ? Number(raw) : 0.95;
    } catch {
      return 0.95;
    }
  });

  const [layout, setLayout] = useState<'horizontal' | 'vertical'>(() => {
    try {
      const raw = localStorage.getItem(FLOATING_LAYOUT_KEY);
      return raw === 'vertical' ? 'vertical' : 'horizontal';
    } catch {
      return 'horizontal';
    }
  });

  const [iconSize, setIconSize] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(FLOATING_ICON_SIZE_KEY);
      return raw ? Number(raw) : 46;
    } catch {
      return 46;
    }
  });

  const [textSize, setTextSize] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(FLOATING_TEXT_SIZE_KEY);
      return raw ? Number(raw) : 13;
    } catch {
      return 13;
    }
  });

  const [showName, setShowName] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(FLOATING_SHOW_NAME_KEY);
      return raw !== null ? raw === 'true' : true;
    } catch {
      return true;
    }
  });

  // Global hotkey trigger handler for floating window (instant 0ms trigger)
  const triggerTimerByHotkey = useCallback((hotkey: string) => {
    const cleanKey = hotkey.trim().toUpperCase();
    const now = Date.now();

    setTimers((prev) => {
      let matched = false;
      const next = prev.map((t) => {
        if (t.hotkey.trim().toUpperCase() === cleanKey) {
          matched = true;
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
      });

      if (matched) {
        try {
          localStorage.setItem(TIMERS_STORAGE_KEY, JSON.stringify(next));
        } catch {}
      }
      return matched ? next : prev;
    });
  }, []);

  // Listen to live synced timers data from master window, hotkey events & localStorage
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === TIMERS_STORAGE_KEY && e.newValue) {
        try {
          setTimers(JSON.parse(e.newValue));
        } catch {}
      } else if (e.key === FLOATING_OPACITY_KEY && e.newValue) {
        setOpacity(Number(e.newValue));
      } else if (e.key === FLOATING_LAYOUT_KEY && e.newValue) {
        setLayout(e.newValue === 'vertical' ? 'vertical' : 'horizontal');
      } else if (e.key === FLOATING_ICON_SIZE_KEY && e.newValue) {
        setIconSize(Number(e.newValue));
      } else if (e.key === FLOATING_TEXT_SIZE_KEY && e.newValue) {
        setTextSize(Number(e.newValue));
      } else if (e.key === FLOATING_SHOW_NAME_KEY && e.newValue) {
        setShowName(e.newValue === 'true');
      }
    };

    window.addEventListener('storage', handleStorage);

    let removeSyncListener: (() => void) | undefined;
    if (window.electronAPI?.onTimersDataSynced) {
      removeSyncListener = window.electronAPI.onTimersDataSynced((data) => {
        if (data.timers) setTimers(data.timers);
        if (data.opacity !== undefined) setOpacity(data.opacity);
        if (data.layout) setLayout(data.layout);
        if (data.iconSize !== undefined) setIconSize(data.iconSize);
        if (data.textSize !== undefined) setTextSize(data.textSize);
        if (data.showName !== undefined) setShowName(data.showName);
      });
    }

    let removeHotkeyListener: (() => void) | undefined;
    if (window.electronAPI?.onGlobalHotkeyTriggered) {
      removeHotkeyListener = window.electronAPI.onGlobalHotkeyTriggered(({ hotkey }) => {
        triggerTimerByHotkey(hotkey);
      });
    }

    return () => {
      window.removeEventListener('storage', handleStorage);
      if (removeSyncListener) removeSyncListener();
      if (removeHotkeyListener) removeHotkeyListener();
    };
  }, [triggerTimerByHotkey]);

  // Smooth visual countdown tick for floating display with auto-loop support
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setTimers((prev) => {
        let changed = false;
        const next = prev.map((t) => {
          if (!t.isRunning) return t;

          const endsAt = t.endsAt || (now + t.remainingSeconds * 1000);
          const rawRemaining = Math.max(0, (endsAt - now) / 1000);
          const newRemaining = Math.round(rawRemaining * 10) / 10;
          changed = true;

          if (newRemaining <= 0) {
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
          };
        });

        return changed ? next : prev;
      });
    }, 50);

    return () => clearInterval(interval);
  }, []);

  const handleTriggerTimer = (timerId: string) => {
    const now = Date.now();
    const updated = timers.map((t) =>
      t.id === timerId
        ? {
            ...t,
            isRunning: true,
            remainingSeconds: t.durationSeconds,
            startedAt: now,
            endsAt: now + t.durationSeconds * 1000,
            leadTriggered: false,
          }
        : t
    );
    setTimers(updated);
    try {
      localStorage.setItem(TIMERS_STORAGE_KEY, JSON.stringify(updated));
      window.electronAPI?.syncTimersData?.({ timers: updated });
    } catch {}
  };

  const handleResetTimer = (timerId: string) => {
    const updated = timers.map((t) =>
      t.id === timerId
        ? {
            ...t,
            isRunning: false,
            remainingSeconds: t.durationSeconds,
            startedAt: undefined,
            endsAt: undefined,
            leadTriggered: false,
          }
        : t
    );
    setTimers(updated);
    try {
      localStorage.setItem(TIMERS_STORAGE_KEY, JSON.stringify(updated));
      window.electronAPI?.syncTimersData?.({ timers: updated });
    } catch {}
  };

  const handleChangeOpacity = (newOp: number) => {
    setOpacity(newOp);
    try {
      localStorage.setItem(FLOATING_OPACITY_KEY, String(newOp));
      window.electronAPI?.syncTimersData?.({ opacity: newOp });
    } catch {}
  };

  const handleChangeLayout = (newLayout: 'horizontal' | 'vertical') => {
    setLayout(newLayout);
    try {
      localStorage.setItem(FLOATING_LAYOUT_KEY, newLayout);
      window.electronAPI?.syncTimersData?.({ layout: newLayout });
    } catch {}
  };

  const handleChangeIconSize = (size: number) => {
    setIconSize(size);
    try {
      localStorage.setItem(FLOATING_ICON_SIZE_KEY, String(size));
      window.electronAPI?.syncTimersData?.({ iconSize: size });
    } catch {}
  };

  const handleChangeTextSize = (size: number) => {
    setTextSize(size);
    try {
      localStorage.setItem(FLOATING_TEXT_SIZE_KEY, String(size));
      window.electronAPI?.syncTimersData?.({ textSize: size });
    } catch {}
  };

  const handleToggleShowName = (show: boolean) => {
    setShowName(show);
    try {
      localStorage.setItem(FLOATING_SHOW_NAME_KEY, String(show));
      window.electronAPI?.syncTimersData?.({ showName: show });
    } catch {}
  };

  return (
    <div className="w-screen h-screen bg-transparent select-none overflow-hidden">
      <FloatingTimerOverlay
        timers={timers}
        onTriggerTimer={handleTriggerTimer}
        onResetTimer={handleResetTimer}
        onClose={() => window.close()}
        opacity={opacity}
        layout={layout}
        iconSize={iconSize}
        textSize={textSize}
        showName={showName}
        onChangeOpacity={handleChangeOpacity}
        onChangeLayout={handleChangeLayout}
        onChangeIconSize={handleChangeIconSize}
        onChangeTextSize={handleChangeTextSize}
        onToggleShowName={handleToggleShowName}
      />
    </div>
  );
};
