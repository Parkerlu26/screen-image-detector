import React, { useState, useEffect } from 'react';
import { CooldownTimer } from '../types';
import { X, GripVertical, LayoutGrid, LayoutList, Sliders, Type, Image as ImageIcon } from 'lucide-react';

/* 桌面置頂懸浮計時窗。外觀走 components.css 的 fw-* 那一段：
   它永遠浮在使用者的遊戲畫面上，底下是別人的影像，所以固定深底玻璃，
   強調色只用 --acc-ondark（main.tsx 的 applyAppearance 也跑在 #floating，
   吃 --bg/--card/--txt 的話選淺色主題會整塊翻成白底白字）。
   尺寸數學（圖示大小、字級、名稱列寬、resizeFloatingWindow 的目標值）
   全部沿用舊版，一個數字都沒動；這一版只換外觀。 */

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
      className={`${isNativeWindow ? 'w-full h-full p-1' : 'fixed z-[9999]'} select-none bg-transparent overflow-hidden`}
      style={!isNativeWindow ? { left: `${position.x}px`, top: `${position.y}px` } : undefined}
    >
      <div
        className="relative transition-opacity duration-150 flex flex-col gap-1 items-center bg-transparent w-full h-full"
        style={{ opacity }}
      >
        {/* 滑過才浮出來的拖曳條與控制列（原生視窗一律顯示） */}
        <div
          onMouseDown={handleMouseDown}
          style={
            {
              WebkitAppRegion: 'drag',
              opacity: showControls || isNativeWindow ? 1 : 0,
            } as React.CSSProperties
          }
          className="fw-bar"
        >
          <GripVertical />
          <span>懸浮窗</span>

          <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            {/* 橫排／直排 */}
            {onChangeLayout && (
              <button
                type="button"
                className="fw-btn"
                onClick={() => onChangeLayout(layout === 'horizontal' ? 'vertical' : 'horizontal')}
                aria-label={layout === 'horizontal' ? '切換為直排' : '切換為橫排'}
                title={layout === 'horizontal' ? '切換為直排' : '切換為橫排'}
              >
                {layout === 'horizontal' ? <LayoutList /> : <LayoutGrid />}
              </button>
            )}

            {/* 快速設定 */}
            <button
              type="button"
              className="fw-btn"
              aria-pressed={showSettingsMenu}
              onClick={() => setShowSettingsMenu(!showSettingsMenu)}
              aria-label="調整圖示與字體大小、名稱顯示"
              title="調整圖示/字體大小與名稱顯示"
            >
              <Sliders />
            </button>

            {/* 透明度輪播 */}
            {onChangeOpacity && (
              <button
                type="button"
                className="fw-btn"
                onClick={() => {
                  const ops = [1.0, 0.85, 0.65, 0.4];
                  const next = ops[(ops.indexOf(opacity) + 1) % ops.length];
                  onChangeOpacity(next);
                }}
                title="切換透明度"
              >
                {Math.round(opacity * 100)}%
              </button>
            )}

            <button
              type="button"
              className="fw-btn x"
              onClick={onClose}
              aria-label="關閉懸浮窗"
              title="關閉懸浮窗"
            >
              <X />
            </button>
          </div>
        </div>

        {/* ── 快速設定小面板 ── */}
        {showSettingsMenu && (
          <div className="fw-pop" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            {/* 1. 圖示大小 */}
            {onChangeIconSize && (
              <div className="r">
                <span className="k">
                  <ImageIcon />
                  圖示大小
                </span>
                <div className="v">
                  {ICON_SIZES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className="fw-sz"
                      aria-pressed={iconSize === s}
                      onClick={() => onChangeIconSize(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 2. 字體大小 */}
            {onChangeTextSize && (
              <div className="r">
                <span className="k">
                  <Type />
                  字體大小
                </span>
                <div className="v">
                  {TEXT_SIZES.map((ts) => (
                    <button
                      key={ts}
                      type="button"
                      className="fw-sz"
                      aria-pressed={textSize === ts}
                      onClick={() => onChangeTextSize(ts)}
                    >
                      {ts}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 3. 是否顯示名稱 */}
            {onToggleShowName && (
              <div className="r">
                <span className="k">顯示計時名稱</span>
                <div className="v">
                  <button
                    type="button"
                    className="fw-sz"
                    aria-pressed={showName}
                    onClick={() => onToggleShowName(!showName)}
                  >
                    {showName ? '開啟' : '隱藏'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── 計時磚：上方秒數 ＋ 中間全彩圖示 ＋ 下方名稱 ── */}
        <div
          className={`flex gap-3 items-center justify-center bg-transparent ${
            layout === 'vertical' ? 'flex-col' : 'flex-row flex-wrap'
          }`}
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          {enabledTimers.length === 0 ? (
            <div className="fw-empty">尚未建立計時器</div>
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
                  style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                  className="fw-tile"
                  title={`${timer.name} (快捷鍵: ${timer.hotkey}) - 點擊觸發/重設`}
                >
                  {/* 1. 上方秒數（倒數中）／快捷鍵（待機） */}
                  <div
                    className="flex items-center justify-center"
                    style={{ height: `${textSize + 4}px` }}
                  >
                    {isCooling ? (
                      <span className="fw-num" style={{ fontSize: `${textSize}px` }}>
                        {displaySeconds}s
                      </span>
                    ) : (
                      <span className="fw-hk" style={{ fontSize: `${Math.max(9, textSize - 2)}px` }}>
                        {timer.hotkey}
                      </span>
                    )}
                  </div>

                  {/* 2. 中間圖示（保持鮮明全彩，尺寸由使用者選） */}
                  <div className="fw-ico" style={{ width: `${iconSize}px`, height: `${iconSize}px` }}>
                    {timer.imageDataUrl ? (
                      <img src={timer.imageDataUrl} alt={timer.name} />
                    ) : (
                      <span className="fw-num" style={{ fontSize: '12px' }}>
                        {timer.hotkey}
                      </span>
                    )}

                    {/* 冷卻遮罩：從上緣蓋下來，剩越少蓋越短 */}
                    {isCooling && timer.displayMode !== 'original_only' && (
                      <div className="fw-wipe" style={{ height: `${percent}%` }} />
                    )}
                  </div>

                  {/* 3. 下方名稱 */}
                  {showName && (
                    <div style={{ width: `${Math.max(iconSize + 14, 52)}px` }}>
                      <span className="fw-nm" style={{ fontSize: `${nameFontSize}px` }}>
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
