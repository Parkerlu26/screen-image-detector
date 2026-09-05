/**
 * 單一目標的專屬偵測區域（ROI）視窗。
 *
 * 外殼走 components.css 的 .scrim.flush ＋ .modal.sheet（開起來就佔滿整個畫面），
 * 按「還原視窗」才收成一般的 .modal。畫布區用 .work ＞ .stage：那塊底色是寫死的
 * #0a0e12，**不吃主題**——上面躺的是使用者擷取到的畫面，不是我們的介面。
 *
 * 畫布裡面畫的每一個數字（框線 1.5px、角標 10px、遮罩 0.65、最小 8px、
 * 存檔門檻 10px、滾輪 1.15／0.87、縮放上下限 0.6～6.0）都是偵測行為的一部分，
 * 換樣式的時候一個都不能動。
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Target, Rect } from '../types';
import {
  Target as TargetIcon,
  X,
  Check,
  RotateCcw,
  Crosshair,
  Maximize2,
  Minimize2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

interface RoiModalProps {
  isOpen: boolean;
  onClose: () => void;
  target: Target | null;
  sourceImage: string;
  sourceWidth: number;
  sourceHeight: number;
  onSaveRoi: (targetId: string, normalizedRoi: { x: number; y: number; width: number; height: number } | null) => void;
}

export const RoiModal: React.FC<RoiModalProps> = ({
  isOpen,
  onClose,
  target,
  sourceImage,
  sourceWidth,
  sourceHeight,
  onSaveRoi,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // Fullscreen & Zoom state
  const [isFullscreen, setIsFullscreen] = useState(true);
  const [canvasZoom, setCanvasZoom] = useState(1.0);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ mouseX: number; mouseY: number; startPanX: number; startPanY: number }>({
    mouseX: 0,
    mouseY: 0,
    startPanX: 0,
    startPanY: 0,
  });

  // Selection in exact image pixel coordinates (0..sourceWidth, 0..sourceHeight)
  const [roiRect, setRoiRect] = useState<Rect | null>(null);
  const [isFullFrame, setIsFullFrame] = useState<boolean>(true);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragStartRef = useRef<{ imgX: number; imgY: number }>({ imgX: 0, imgY: 0 });

  useEffect(() => {
    if (!isOpen || !target) return;
    setCanvasZoom(1.0);
    setPanOffset({ x: 0, y: 0 });

    if (target.normalizedRoi) {
      setIsFullFrame(false);
      setRoiRect({
        x: Math.round(target.normalizedRoi.x * sourceWidth),
        y: Math.round(target.normalizedRoi.y * sourceHeight),
        width: Math.round(target.normalizedRoi.width * sourceWidth),
        height: Math.round(target.normalizedRoi.height * sourceHeight),
      });
    } else {
      setIsFullFrame(true);
      setRoiRect(null);
    }

    if (sourceImage) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        imgRef.current = img;
        drawCanvas();
      };
      img.src = sourceImage;
    }
  }, [isOpen, target, sourceImage, sourceWidth, sourceHeight]);

  // Convert CSS coordinates to exact Image pixel coordinates
  const getCanvasCoords = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return { cssX: 0, cssY: 0, imgX: 0, imgY: 0, scaleX: 1, scaleY: 1 };
      const rect = canvas.getBoundingClientRect();
      const cssX = clientX - rect.left;
      const cssY = clientY - rect.top;
      const scaleX = sourceWidth / rect.width;
      const scaleY = sourceHeight / rect.height;
      const imgX = Math.max(0, Math.min(sourceWidth, cssX * scaleX));
      const imgY = Math.max(0, Math.min(sourceHeight, cssY * scaleY));
      return { cssX, cssY, imgX, imgY, scaleX, scaleY };
    },
    [sourceWidth, sourceHeight]
  );

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imgRef.current) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cw = canvas.width;
    const ch = canvas.height;
    ctx.clearRect(0, 0, cw, ch);

    // Draw background video snapshot
    ctx.drawImage(imgRef.current, 0, 0, cw, ch);

    if (isFullFrame || !roiRect) {
      ctx.strokeStyle = target?.color || '#10B981';
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 8]);
      ctx.strokeRect(4, 4, cw - 8, ch - 8);
      ctx.setLineDash([]);

      ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
      ctx.fillRect(cw / 2 - 140, 20, 280, 36);
      ctx.strokeStyle = target?.color || '#10B981';
      ctx.lineWidth = 1;
      ctx.strokeRect(cw / 2 - 140, 20, 280, 36);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('🔍 全螢幕偵測模式 (未限制區域)', cw / 2, 43);
      ctx.textAlign = 'left';
      return;
    }

    // Darken outer non-search area
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.fillRect(0, 0, cw, ch);

    // Clear and draw ROI area
    const sx = Math.round(roiRect.x);
    const sy = Math.round(roiRect.y);
    const sw = Math.round(roiRect.width);
    const sh = Math.round(roiRect.height);

    ctx.clearRect(sx, sy, sw, sh);
    ctx.drawImage(imgRef.current, sx, sy, sw, sh, sx, sy, sw, sh);

    // Bounding border for ROI
    ctx.strokeStyle = target?.color || '#10B981';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(sx, sy, sw, sh);

    // Diagonal corner accents
    const cornerSize = 10;
    ctx.fillStyle = target?.color || '#10B981';
    ctx.fillRect(sx - 1, sy - 1, cornerSize, 2);
    ctx.fillRect(sx - 1, sy - 1, 2, cornerSize);
    ctx.fillRect(sx + sw - cornerSize + 1, sy - 1, cornerSize, 2);
    ctx.fillRect(sx + sw - 1, sy - 1, 2, cornerSize);
    ctx.fillRect(sx - 1, sy + sh - 1, cornerSize, 2);
    ctx.fillRect(sx - 1, sy + sh - cornerSize + 1, 2, cornerSize);
    ctx.fillRect(sx + sw - cornerSize + 1, sy + sh - 1, cornerSize, 2);
    ctx.fillRect(sx + sw - 1, sy + sh - cornerSize + 1, 2, cornerSize);

    // ROI Info Pill
    const label = `偵測區域: ${Math.round(roiRect.width)} × ${Math.round(roiRect.height)} px`;
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
    const textW = ctx.measureText(label).width + 14;
    const labelY = sy > 26 ? sy - 24 : sy + sh + 4;
    ctx.fillRect(sx, labelY, textW, 20);
    ctx.strokeStyle = target?.color || '#10B981';
    ctx.lineWidth = 1;
    ctx.strokeRect(sx, labelY, textW, 20);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(label, sx + 7, labelY + 14);
  }, [roiRect, isFullFrame, sourceWidth, sourceHeight, target]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button === 1 || e.button === 2) {
      e.preventDefault();
      setIsPanning(true);
      panStartRef.current = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        startPanX: panOffset.x,
        startPanY: panOffset.y,
      };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }

    const { imgX, imgY } = getCanvasCoords(e.clientX, e.clientY);
    setIsFullFrame(false);
    setIsDragging(true);
    dragStartRef.current = { imgX, imgY };
    setRoiRect({ x: imgX, y: imgY, width: 4, height: 4 });

    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isPanning) {
      const dx = e.clientX - panStartRef.current.mouseX;
      const dy = e.clientY - panStartRef.current.mouseY;
      setPanOffset({
        x: panStartRef.current.startPanX + dx,
        y: panStartRef.current.startPanY + dy,
      });
      return;
    }

    if (!isDragging) return;
    const { imgX, imgY } = getCanvasCoords(e.clientX, e.clientY);
    const startX = Math.min(dragStartRef.current.imgX, imgX);
    const startY = Math.min(dragStartRef.current.imgY, imgY);
    const w = Math.abs(imgX - dragStartRef.current.imgX);
    const h = Math.abs(imgY - dragStartRef.current.imgY);

    setRoiRect({
      x: Math.max(0, Math.round(startX)),
      y: Math.max(0, Math.round(startY)),
      width: Math.min(sourceWidth - startX, Math.max(8, Math.round(w))),
      height: Math.min(sourceHeight - startY, Math.max(8, Math.round(h))),
    });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    setIsDragging(false);
    setIsPanning(false);
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // Ignored
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 0.87;
    setCanvasZoom((prev) => Math.max(0.6, Math.min(6.0, Number((prev * factor).toFixed(2)))));
  };

  const handleSave = () => {
    if (!target) return;
    if (isFullFrame || !roiRect || roiRect.width < 10 || roiRect.height < 10) {
      onSaveRoi(target.id, null);
    } else {
      const normalized = {
        x: Math.max(0, roiRect.x / sourceWidth),
        y: Math.max(0, roiRect.y / sourceHeight),
        width: Math.min(1, roiRect.width / sourceWidth),
        height: Math.min(1, roiRect.height / sourceHeight),
      };
      onSaveRoi(target.id, normalized);
    }
    onClose();
  };

  if (!isOpen || !target) return null;

  return (
    <div className={`scrim${isFullscreen ? ' flush' : ''}`}>
      <div
        className={`modal${isFullscreen ? ' sheet' : ''}`}
        style={{ '--mw': '1152px' } as React.CSSProperties}
        role="dialog"
        aria-modal="true"
        aria-labelledby="roi-title"
      >
        <header>
          {/* 圖示磚吃這個目標自己的顏色：畫布上的框線、角標、資訊藥丸都是同一個色，
              標題這裡跟著走，才看得出來「現在框的是哪一個目標」。 */}
          <div
            className="mtile"
            style={{
              background: `${target.color}22`,
              borderColor: target.color,
              color: target.color,
            }}
          >
            <TargetIcon />
          </div>
          <div className="htxt">
            <div className="ttl">
              <h3 id="roi-title">設定「{target.name}」專屬偵測區域 (ROI)</h3>
            </div>
            <p>可滾輪放大畫面精確框選目標搜索範圍，大幅提升辨識效率並防止誤判</p>
          </div>

          <div className="hact">
            <button type="button" className="btn" onClick={() => setIsFullscreen(!isFullscreen)}>
              {isFullscreen ? <Minimize2 /> : <Maximize2 />}
              {isFullscreen ? '還原視窗' : '全螢幕放大'}
            </button>
            <button
              type="button"
              className="btn ghost ico-only"
              onClick={onClose}
              title="關閉"
              aria-label="關閉"
            >
              <X />
            </button>
          </div>
        </header>

        {/* 畫布工作台。.stage 的底色寫死 #0a0e12（淺色主題也一樣），
            白底會讓人以為畫面破圖。滾輪縮放與擋右鍵選單掛在這一層。 */}
        <div className="work">
          <div className="stage" onWheel={handleWheel} onContextMenu={(e) => e.preventDefault()}>
            <div
              style={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${canvasZoom})`,
                transformOrigin: 'center center',
                transition: 'transform 75ms',
                willChange: 'transform',
              }}
            >
              <canvas
                ref={canvasRef}
                width={sourceWidth || 1280}
                height={sourceHeight || 720}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                style={{
                  maxWidth: 'none',
                  maxHeight: isFullscreen ? 'calc(100vh - 120px)' : 'calc(80vh - 140px)',
                  width: 'auto',
                  height: 'auto',
                  display: 'block',
                  touchAction: 'none',
                  cursor: 'crosshair',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  boxShadow: '0 30px 70px -20px rgba(0, 0, 0, 0.8)',
                }}
              />
            </div>

            {/* 縮放列浮在別人的影像上，所以用 .glass（深底玻璃＋亮字，不吃主題），
                跟主畫面的 HUD 同一種材質。.glass.pad0 會把裡面的 .btn 收成 24×24
                方塊，「100%」那顆帶文字，就地把寬度放回 auto。 */}
            <div className="stagebar tl">
              <div className="glass pad0">
                <button
                  type="button"
                  className="btn ghost ico-only"
                  onClick={() => setCanvasZoom((z) => Math.max(0.6, Number((z - 0.25).toFixed(2))))}
                  title="縮小畫布"
                  aria-label="縮小畫布"
                >
                  <ZoomOut />
                </button>
                <span className="num" style={{ fontWeight: 600, padding: '0 2px' }}>
                  {Math.round(canvasZoom * 100)}%
                </span>
                <button
                  type="button"
                  className="btn ghost ico-only"
                  onClick={() => setCanvasZoom((z) => Math.min(6.0, Number((z + 0.25).toFixed(2))))}
                  title="放大畫布"
                  aria-label="放大畫布"
                >
                  <ZoomIn />
                </button>
                <span className="sep" />
                <button
                  type="button"
                  className="btn ghost"
                  style={{ width: 'auto', padding: '0 6px' }}
                  onClick={() => {
                    setCanvasZoom(1.0);
                    setPanOffset({ x: 0, y: 0 });
                  }}
                  title="回到 100% 並置中"
                >
                  <RotateCcw />
                  100%
                </button>
              </div>
            </div>
          </div>
        </div>

        <footer>
          {/* 左邊是「換一種框法」跟操作說明，右邊才是決定，中間用 marginRight:auto 撐開。 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--sp2)',
              marginRight: 'auto',
              minWidth: 0,
              flexWrap: 'wrap',
            }}
          >
            {/* 這顆同時是按鈕也是狀態：現在就是全螢幕偵測時用 .btn（浮起、亮字），
                已經框了區域就退成 .btn ghost（透明、灰字）。 */}
            <button
              type="button"
              className={`btn${isFullFrame ? '' : ' ghost'}`}
              onClick={() => {
                setIsFullFrame(true);
                setRoiRect(null);
              }}
            >
              <RotateCcw />
              恢復全螢幕偵測
            </button>
            <span
              className="hint"
              style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 'var(--sp1)' }}
            >
              <Crosshair style={{ width: 13, height: 13, color: 'var(--acc-txt)' }} />
              拖曳滑鼠自訂區域 • 滑鼠中鍵/右鍵拖曳平移
            </span>
          </div>

          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn pri" onClick={handleSave}>
            <Check />
            儲存區域設定
          </button>
        </footer>
      </div>
    </div>
  );
};
