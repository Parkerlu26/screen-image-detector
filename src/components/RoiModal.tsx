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
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md transition-all duration-200 ${
        isFullscreen ? 'p-0' : 'p-3 lg:p-4'
      }`}
    >
      <div
        className={`bg-slate-950 border border-slate-700/80 shadow-2xl flex flex-col overflow-hidden transition-all duration-200 ${
          isFullscreen ? 'w-screen h-screen rounded-none' : 'w-full max-w-6xl rounded-2xl max-h-[92vh]'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-slate-800 bg-slate-950/95 z-30 shrink-0">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center text-white border"
              style={{ backgroundColor: `${target.color}25`, borderColor: target.color }}
            >
              <TargetIcon className="w-5 h-5" style={{ color: target.color }} />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                設定「{target.name}」專屬偵測區域 (ROI)
              </h2>
              <p className="text-xs text-slate-400">
                可滾輪放大畫面精確框選目標搜索範圍，大幅提升辨識效率並防止誤判
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white rounded-lg border border-slate-700 text-xs font-semibold transition-colors"
            >
              {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              <span>{isFullscreen ? '還原視窗' : '全螢幕放大'}</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Viewport */}
        <div
          onWheel={handleWheel}
          onContextMenu={(e) => e.preventDefault()}
          className="flex-1 relative flex items-center justify-center bg-slate-950 overflow-hidden select-none"
        >
          <div
            className="relative flex items-center justify-center transition-transform duration-75 will-change-transform"
            style={{
              transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${canvasZoom})`,
              transformOrigin: 'center center',
            }}
          >
            <canvas
              ref={canvasRef}
              width={sourceWidth || 1280}
              height={sourceHeight || 720}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              className="max-w-none shadow-2xl border border-slate-800 touch-none cursor-crosshair"
              style={{
                maxHeight: isFullscreen ? 'calc(100vh - 120px)' : 'calc(80vh - 140px)',
                width: 'auto',
                height: 'auto',
              }}
            />
          </div>

          {/* Floating Zoom & Pan toolbar */}
          <div className="absolute top-4 left-4 z-20 flex items-center gap-1.5 bg-slate-900/90 backdrop-blur-md px-2.5 py-1.5 rounded-xl border border-slate-700/80 shadow-2xl text-xs">
            <button
              type="button"
              onClick={() => setCanvasZoom((z) => Math.max(0.6, Number((z - 0.25).toFixed(2))))}
              className="p-1 text-slate-300 hover:text-white hover:bg-slate-800 rounded-md"
              title="縮小畫布"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="font-mono font-bold text-white px-1">{Math.round(canvasZoom * 100)}%</span>
            <button
              type="button"
              onClick={() => setCanvasZoom((z) => Math.min(6.0, Number((z + 0.25).toFixed(2))))}
              className="p-1 text-slate-300 hover:text-white hover:bg-slate-800 rounded-md"
              title="放大畫布"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <div className="h-4 w-px bg-slate-700 mx-0.5" />
            <button
              type="button"
              onClick={() => {
                setCanvasZoom(1.0);
                setPanOffset({ x: 0, y: 0 });
              }}
              className="px-2 py-1 text-[11px] font-semibold text-slate-300 hover:text-white hover:bg-slate-800 rounded-md flex items-center gap-1"
            >
              <RotateCcw className="w-3 h-3" />
              100%
            </button>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex flex-wrap items-center justify-between px-6 py-3.5 border-t border-slate-800 bg-slate-950/95 z-30 gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setIsFullFrame(true);
                setRoiRect(null);
              }}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors border ${
                isFullFrame
                  ? 'bg-slate-700 text-white border-slate-500'
                  : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
              }`}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              恢復全螢幕偵測
            </button>
            <div className="text-xs text-slate-400 flex items-center gap-1 ml-2 font-mono">
              <Crosshair className="w-4 h-4 text-emerald-400" />
              <span>拖曳滑鼠自訂區域 • 滑鼠中鍵/右鍵拖曳平移</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors text-xs font-medium"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white transition-colors text-xs font-bold shadow-lg shadow-emerald-900/30 flex items-center gap-1.5 cursor-pointer"
            >
              <Check className="w-4 h-4" />
              儲存區域設定
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
