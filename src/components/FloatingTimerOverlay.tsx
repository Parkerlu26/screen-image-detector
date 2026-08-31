import React, { useState, useEffect } from 'react';
import { CooldownTimer } from '../types';
import { X, GripVertical, LayoutGrid, LayoutList, Sliders, Type, Image as ImageIcon } from 'lucide-react';

interface FloatingTimerOverlayProps {
  timers: CooldownTimer[];
  onTriggerTimer: (timerId: string) => void;
  onResetTimer: (timerId: string) => void;
  onClose: () => void;
  opacity?: number;
  layout?: 'horizontal' | 'vertical';
  iconSize?: number; // 32..80 px (default 46)
  textSize?: number; // 10..22 px (default 13)
  showName?: boolean; // default true
  onChangeOpacity?: (op: number) => void;
  onChangeLayout?: (l: 'horizontal' | 'vertical') => void;
  onChangeIconSize?: (size: number) => void;
  onChangeTextSize?: (size: number) => void;
  onToggleShowName?: (show: boolean) => void;
}

export const FloatingTimerOverlay: React.FC<FloatingTimerOverlayProps> = ({
  timers,
  onTriggerTimer,
  onResetTimer,
  onClose,
  opacity = 0.95,
  layout = 'horizontal',
  iconSize = 46,
  textSize = 13,
  showName = true,
  onChangeOpacity,
  onChangeLayout,
  onChangeIconSize,
  onChangeTextSize,
  onToggleShowName,
}) => {
  const [position, setPosition] = useState({ x: 50, y: 50 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [showControls, setShowControls] = useState(false);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);

  const isNativeWindow = window.location.hash === '#floating';

  // Dynamic window resizing based on timer count, icon size, font size, and name toggle
  const enabledTimers = timers.filter((t) => t.enabled !== false);

  useEffect(() => {
    if (!isNativeWindow || !window.electronAPI?.resizeFloatingWindow) return;

    const count = Math.max(1, enabledTimers.length);
    const itemWidth = Math.max(iconSize + 16, 54);
    const singleItemHeight = (textSize + 8) + iconSize + (showName ? 18 : 2);

    let targetW = 200;
    let targetH = 135;

    if (layout === 'horizontal') {
      targetW = Math.max(160, count * itemWidth + 30);
      targetH = Math.max(90, singleItemHeight + 36);
    } else {
      targetW = Math.max(100, itemWidth + 24);
      targetH = Math.max(120, count * singleItemHeight + 36);
    }

    window.electronAPI.resizeFloatingWindow({ width: targetW, height: targetH });
  }, [enabledTimers.length, layout, iconSize, textSize, showName, isNativeWindow]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (isNativeWindow) return;
    setIsDragging(true);
    setDragOffset({
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || isNativeWindow) return;
    setPosition({
      x: Math.max(0, Math.min(window.innerWidth - 60, e.clientX - dragOffset.x)),
      y: Math.max(0, Math.min(window.innerHeight - 60, e.clientY - dragOffset.y)),
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const ICON_SIZES = [36, 46, 58, 72];
  const TEXT_SIZES = [11, 13, 16, 20];

  return (
    <div
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseEnter={() => setShowControls(true)}
      onMouseLeave={() => {
        setShowControls(false);
        setShowSettingsMenu(false);
      }}
      className={`${isNativeWindow ? 'w-full h-full p-1' : 'fixed z-[9999]'} select-none font-sans bg-transparent overflow-hidden`}
      style={!isNativeWindow ? { left: `${position.x}px`, top: `${position.y}px` } : undefined}
    >
      <div
        className="relative transition-opacity duration-150 flex flex-col gap-1 items-center bg-transparent w-full h-full"
        style={{ opacity }}
      >
        {/* Hover Mini Drag Bar & Controls */}
        <div
          onMouseDown={handleMouseDown}
          style={{ WebkitAppRegion: 'drag' } as any}
          className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate-950/90 border border-slate-700/80 text-[9px] text-slate-300 shadow-xl cursor-move transition-opacity duration-150 shrink-0 ${
            showControls || isNativeWindow ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <GripVertical className="w-2.5 h-2.5 text-emerald-400" />
          <span className="font-bold text-[9px]">懸浮窗</span>

          <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as any}>
            {/* Layout Toggle */}
            {onChangeLayout && (
              <button
                type="button"
                onClick={() => onChangeLayout(layout === 'horizontal' ? 'vertical' : 'horizontal')}
                className="p-0.5 hover:text-white rounded text-slate-400 cursor-pointer"
                title={layout === 'horizontal' ? '切換為直排' : '切換為橫排'}
              >
                {layout === 'horizontal' ? <LayoutList className="w-2.5 h-2.5" /> : <LayoutGrid className="w-2.5 h-2.5" />}
              </button>
            )}

            {/* Quick Settings Dropdown Toggle */}
            <button
              type="button"
              onClick={() => setShowSettingsMenu(!showSettingsMenu)}
              className={`p-0.5 rounded transition-colors cursor-pointer ${
                showSettingsMenu ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
              title="調整圖示/字體大小與名稱顯示"
            >
              <Sliders className="w-2.5 h-2.5" />
            </button>

            {/* Opacity Cycle */}
            {onChangeOpacity && (
              <button
                type="button"
                onClick={() => {
                  const ops = [1.0, 0.85, 0.65, 0.4];
                  const next = ops[(ops.indexOf(opacity) + 1) % ops.length];
                  onChangeOpacity(next);
                }}
                className="p-0.5 hover:text-white rounded text-[8px] font-mono text-slate-400 cursor-pointer"
                title="切換透明度"
              >
                {Math.round(opacity * 100)}%
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="p-0.5 hover:text-rose-400 rounded text-slate-400 cursor-pointer"
              title="關閉懸浮窗"
            >
              <X className="w-2.5 h-2.5" />
            </button>
          </div>
        </div>

        {/* ── Quick Settings Popup Menu ── */}
        {showSettingsMenu && (
          <div
            style={{ WebkitAppRegion: 'no-drag' } as any}
            className="absolute top-7 z-50 p-2 bg-slate-950/95 border border-slate-700 rounded-xl shadow-2xl space-y-2 text-[10px] text-slate-200 min-w-[170px] backdrop-blur-md animate-in fade-in"
          >
            {/* 1. 圖示大小 */}
            {onChangeIconSize && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-400 flex items-center gap-1">
                  <ImageIcon className="w-3 h-3 text-cyan-400" />
                  圖示大小:
                </span>
                <div className="flex items-center gap-1">
                  {ICON_SIZES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => onChangeIconSize(s)}
                      className={`px-1.5 py-0.5 rounded font-mono font-bold ${
                        iconSize === s
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 2. 字體大小 */}
            {onChangeTextSize && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-400 flex items-center gap-1">
                  <Type className="w-3 h-3 text-amber-400" />
                  字體大小:
                </span>
                <div className="flex items-center gap-1">
                  {TEXT_SIZES.map((ts) => (
                    <button
                      key={ts}
                      type="button"
                      onClick={() => onChangeTextSize(ts)}
                      className={`px-1.5 py-0.5 rounded font-mono font-bold ${
                        textSize === ts
                          ? 'bg-amber-600 text-white'
                          : 'bg-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      {ts}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 3. 是否顯示名稱 */}
            {onToggleShowName && (
              <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-800">
                <span className="text-slate-400">顯示計時名稱:</span>
                <button
                  type="button"
                  onClick={() => onToggleShowName(!showName)}
                  className={`px-2 py-0.5 rounded font-bold transition-colors ${
                    showName
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {showName ? '開啟' : '隱藏'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Timers Layout: 上方秒數 ＋ 中間鮮明全彩圖示 ＋ 下方名稱 ── */}
        <div
          className={`flex gap-3 items-center justify-center bg-transparent ${
            layout === 'vertical' ? 'flex-col' : 'flex-row flex-wrap'
          }`}
          style={{ WebkitAppRegion: 'drag' } as any}
        >
          {enabledTimers.length === 0 ? (
            <div className="text-[10px] text-slate-300 bg-slate-950/90 px-3 py-1.5 rounded-xl border border-slate-700 shadow-xl">
              尚未建立計時器
            </div>
          ) : (
            enabledTimers.map((timer) => {
              const percent = Math.max(0, (timer.remainingSeconds / timer.durationSeconds) * 100);
              const isCooling = timer.isRunning;
              const displaySeconds = timer.remainingSeconds.toFixed(1);

              const nameFontSize = Math.max(9, Math.round(textSize * 0.82));

              return (
                <div
                  key={timer.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onTriggerTimer(timer.id);
                  }}
                  style={{ WebkitAppRegion: 'no-drag' } as any}
                  className="flex flex-col items-center gap-0.5 cursor-pointer transition-transform hover:scale-105 active:scale-95 shrink-0"
                  title={`${timer.name} (快捷鍵: ${timer.hotkey}) - 點擊觸發/重設`}
                >
                  {/* 1. 上方秒數 (可自訂大小) */}
                  <div className="text-center flex items-center justify-center" style={{ height: `${textSize + 4}px` }}>
                    {isCooling ? (
                      <span
                        className="font-black font-mono text-emerald-400 drop-shadow-[0_2px_4px_rgba(0,0,0,1)] tracking-tight"
                        style={{ fontSize: `${textSize}px` }}
                      >
                        {displaySeconds}s
                      </span>
                    ) : (
                      <span
                        className="font-bold font-mono text-amber-300 drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)] bg-slate-950/90 px-1.5 py-0.2 rounded border border-amber-500/50"
                        style={{ fontSize: `${Math.max(9, textSize - 2)}px` }}
                      >
                        {timer.hotkey}
                      </span>
                    )}
                  </div>

                  {/* 2. 中間圖示 (可自訂大小 - 保持鮮明全彩) */}
                  <div
                    className="relative rounded-xl bg-slate-950 border-2 border-slate-700/80 overflow-hidden flex items-center justify-center shadow-2xl"
                    style={{ width: `${iconSize}px`, height: `${iconSize}px` }}
                  >
                    {timer.imageDataUrl ? (
                      <img
                        src={timer.imageDataUrl}
                        alt={timer.name}
                        className="w-full h-full object-contain p-0.5 opacity-100"
                      />
                    ) : (
                      <div className="w-full h-full bg-slate-900 flex flex-col items-center justify-center font-bold text-amber-300 font-mono text-xs">
                        <span>{timer.hotkey}</span>
                      </div>
                    )}

                    {/* Semi-transparent Dark Cooldown Wipe Mask */}
                    {isCooling && timer.displayMode !== 'original_only' && (
                      <div
                        className="absolute inset-0 bg-black/55 transition-all duration-100 pointer-events-none"
                        style={{ height: `${percent}%` }}
                      />
                    )}
                  </div>

                  {/* 3. 下方名稱 (可自訂大小與開關) */}
                  {showName && (
                    <div className="text-center px-0.5 mt-0.5" style={{ width: `${Math.max(iconSize + 14, 52)}px` }}>
                      <span
                        className="font-bold text-white drop-shadow-[0_1px_3px_rgba(0,0,0,1)] truncate block leading-tight text-center"
                        style={{ fontSize: `${nameFontSize}px` }}
                      >
                        {timer.name}
                      </span>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
