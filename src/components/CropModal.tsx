/**
 * 高精度截圖視窗：從擷取到的整張畫面裡框出一小塊，存成偵測目標，或存成計時器圖示。
 *
 * 外殼走 components.css 的 .scrim.flush ＋ .modal.sheet（開起來就佔滿畫面），
 * 按「還原視窗」才收成一般 .modal。工作區是 .work ＞ .stage（左）＋ .rail（右，320px）：
 * .stage 的底色寫死 #0a0e12，**不吃主題**——上面躺的是使用者擷取到的畫面，不是我們的介面；
 * 同理，浮在畫面上的三條工具列一律用 .glass（深底玻璃＋亮字），開關狀態只換字色不換底色。
 *
 * 畫布裡面畫的每一個數字都是「框得準不準」的一部分，換樣式的時候一個都不能動：
 * 外圈遮罩 0.62、選取框 1.5px、三等分格線 0.25／dash [3,3]、8 個手柄 8px、
 * 命中半徑 12px、最小邊長 4px、滾輪 1.15／0.87、縮放上下限 0.6～6.0、
 * 放大鏡半徑 max(65, 原圖寬/18)、方向鍵 1px（Shift 10px）。
 *
 * isForTimerIcon 是一條完全獨立的出口：handleSave 走到它就 onSaveTimerIcon() 後直接 return，
 * 絕不建立偵測目標。右欄在這個模式下也只顯示一張說明橫幅與兩顆決定。
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';

import { Target, SoundType, Rect } from '../types';
import { playAlertSound } from '../utils/audio';
import { COLOR_PALETTE, getNextColor } from '../utils/storage';
import {
  Check,
  Volume2,
  X,
  ZoomIn,
  ZoomOut,
  Scissors,
  Sparkles,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Maximize2,
  Minimize2,
  Crosshair,
  Move,
  RotateCcw,
  Sliders,
  Eye,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react';

interface CropModalProps {
  isOpen: boolean;
  onClose: () => void;
  sourceImage: string; // Base64 full frame
  sourceWidth: number;
  sourceHeight: number;
  existingTargets: Target[];
  onSaveTarget: (target: Target) => void;
  editingTarget?: Target | null;
  isForTimerIcon?: boolean;
  onSaveTimerIcon?: (dataUrl: string) => void;
}

type DragMode = 'create' | 'move' | 'nw' | 'ne' | 'se' | 'sw' | 'n' | 's' | 'e' | 'w' | 'pan';

export const CropModal: React.FC<CropModalProps> = ({
  isOpen,
  onClose,
  sourceImage,
  sourceWidth,
  sourceHeight,
  existingTargets,
  onSaveTarget,
  editingTarget,
  isForTimerIcon = false,
  onSaveTimerIcon,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // Fullscreen & Immersive Layout State
  const [isFullscreen, setIsFullscreen] = useState(true); // Default to full-screen view for maximum clarity!
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // Canvas View Zoom (1.0x to 6.0x) & Pan offsets
  const [canvasZoom, setCanvasZoom] = useState(1.0);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ mouseX: number; mouseY: number; startPanX: number; startPanY: number }>({
    mouseX: 0,
    mouseY: 0,
    startPanX: 0,
    startPanY: 0,
  });

  // Space key tracking for Pan tool
  const [isSpacePressed, setIsSpacePressed] = useState(false);

  // Selection in exact image coordinate space (pixels: 0..sourceWidth, 0..sourceHeight)
  const [selection, setSelection] = useState<Rect>({
    x: Math.floor(sourceWidth * 0.35),
    y: Math.floor(sourceHeight * 0.35),
    width: Math.min(140, Math.floor(sourceWidth * 0.25)),
    height: Math.min(140, Math.floor(sourceHeight * 0.25)),
  });

  const [isDragging, setIsDragging] = useState(false);
  const [dragMode, setDragMode] = useState<DragMode>('create');
  const [cursorStyle, setCursorStyle] = useState<string>('crosshair');
  const dragStartRef = useRef<{ imgX: number; imgY: number; initialRect: Rect }>({
    imgX: 0,
    imgY: 0,
    initialRect: selection,
  });

  // Form Fields
  const [name, setName] = useState(editingTarget ? editingTarget.name : `目標 ${existingTargets.length + 1}`);
  const [color, setColor] = useState(editingTarget ? editingTarget.color : getNextColor(existingTargets));
  const [threshold, setThreshold] = useState(editingTarget ? Math.round(editingTarget.threshold * 100) : 85);
  const [cooldown, setCooldown] = useState(editingTarget ? editingTarget.cooldownSeconds : 3);
  const [soundType, setSoundType] = useState<SoundType>(editingTarget ? editingTarget.soundType : 'chime');
  const [speakName, setSpeakName] = useState(editingTarget ? editingTarget.speakName : false);
  const [autoSetRoi, setAutoSetRoi] = useState(false);
  const [croppedPreviewUrl, setCroppedPreviewUrl] = useState<string>('');

  // Magnifier & Crosshair state
  const [mouseImgPos, setMouseImgPos] = useState<{ x: number; y: number } | null>(null);
  const [showMagnifier, setShowMagnifier] = useState(true);
  const [zoomLevel, setZoomLevel] = useState<number>(4); // 2x, 4x, 8x

  // Reset zoom & pan on modal open
  useEffect(() => {
    if (!isOpen) return;
    setCanvasZoom(1.0);
    setPanOffset({ x: 0, y: 0 });

    if (editingTarget) {
      setName(editingTarget.name);
      setColor(editingTarget.color);
      setThreshold(Math.round(editingTarget.threshold * 100));
      setCooldown(editingTarget.cooldownSeconds);
      setSoundType(editingTarget.soundType);
      setSpeakName(editingTarget.speakName);
    } else {
      setName(`目標 ${existingTargets.length + 1}`);
      setColor(getNextColor(existingTargets));
      setThreshold(85);
      setCooldown(3);
      setSoundType('chime');
      setSpeakName(false);
      setAutoSetRoi(false);
    }
  }, [isOpen, editingTarget, existingTargets]);

  // Load image
  useEffect(() => {
    if (!isOpen || !sourceImage) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imgRef.current = img;
      renderCanvas();
      updateCroppedPreview();
    };
    img.src = sourceImage;
  }, [isOpen, sourceImage]);

  // Update preview snippet
  const updateCroppedPreview = useCallback(() => {
    if (!imgRef.current) return;
    const img = imgRef.current;
    const w = Math.max(2, Math.round(selection.width));
    const h = Math.max(2, Math.round(selection.height));
    const x = Math.max(0, Math.min(img.naturalWidth - w, Math.round(selection.x)));
    const y = Math.max(0, Math.min(img.naturalHeight - h, Math.round(selection.y)));

    const previewCanvas = document.createElement('canvas');
    previewCanvas.width = w;
    previewCanvas.height = h;
    const pctx = previewCanvas.getContext('2d');
    if (pctx) {
      pctx.imageSmoothingEnabled = false;
      pctx.drawImage(img, x, y, w, h, 0, 0, w, h);
      setCroppedPreviewUrl(previewCanvas.toDataURL('image/png'));
    }
  }, [selection]);

  useEffect(() => {
    updateCroppedPreview();
  }, [selection, updateCroppedPreview]);

  // Convert CSS client coordinates to exact Image pixel coordinates (Works with Canvas Zoom and Pan!)
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

  // Render canvas & high-precision HUD
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imgRef.current) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cw = canvas.width;
    const ch = canvas.height;
    ctx.clearRect(0, 0, cw, ch);

    // 1. Draw base video frame
    ctx.drawImage(imgRef.current, 0, 0, cw, ch);

    // 2. Dark overlay for non-selected regions
    ctx.fillStyle = 'rgba(0, 0, 0, 0.62)';
    ctx.fillRect(0, 0, cw, ch);

    // 3. Clear crop area to show raw bright image
    const sx = Math.round(selection.x);
    const sy = Math.round(selection.y);
    const sw = Math.round(selection.width);
    const sh = Math.round(selection.height);

    ctx.clearRect(sx, sy, sw, sh);
    ctx.drawImage(imgRef.current, sx, sy, sw, sh, sx, sy, sw, sh);

    // 4. Draw refined crisp thin border
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(sx, sy, sw, sh);

    // 5. Draw Rule of Thirds grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 0.75;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(sx + sw / 3, sy);
    ctx.lineTo(sx + sw / 3, sy + sh);
    ctx.moveTo(sx + (sw * 2) / 3, sy);
    ctx.lineTo(sx + (sw * 2) / 3, sy + sh);
    ctx.moveTo(sx, sy + sh / 3);
    ctx.lineTo(sx + sw, sy + sh / 3);
    ctx.moveTo(sx, sy + (sh * 2) / 3);
    ctx.lineTo(sx + sw, sy + (sh * 2) / 3);
    ctx.stroke();
    ctx.setLineDash([]);

    // 6. Draw 8 Refined Precision Handles
    const handleSize = 8;
    const handles = [
      { mode: 'nw', x: sx, y: sy },
      { mode: 'n', x: sx + sw / 2, y: sy },
      { mode: 'ne', x: sx + sw, y: sy },
      { mode: 'e', x: sx + sw, y: sy + sh / 2 },
      { mode: 'se', x: sx + sw, y: sy + sh },
      { mode: 's', x: sx + sw / 2, y: sy + sh },
      { mode: 'sw', x: sx, y: sy + sh },
      { mode: 'w', x: sx, y: sy + sh / 2 },
    ];

    handles.forEach((h) => {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(h.x - handleSize / 2, h.y - handleSize / 2, handleSize, handleSize);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(h.x - handleSize / 2, h.y - handleSize / 2, handleSize, handleSize);
    });

    // 7. Dimension Label Pill
    const dimText = `${Math.round(selection.width)} × ${Math.round(selection.height)} px`;
    const fontSize = 12;
    ctx.font = `bold ${fontSize}px system-ui, -apple-system, sans-serif`;
    const textMetrics = ctx.measureText(dimText);
    const badgeW = textMetrics.width + 14;
    const badgeH = fontSize + 10;
    const badgeY = sy > badgeH + 6 ? sy - badgeH - 3 : sy + sh + 4;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
    ctx.fillRect(sx, badgeY, badgeW, badgeH);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(sx, badgeY, badgeW, badgeH);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(dimText, sx + 7, badgeY + fontSize);

    // 8. Crosshair Guides (Full-canvas hairline indicator)
    if (mouseImgPos) {
      const mx = Math.round(mouseImgPos.x);
      const my = Math.round(mouseImgPos.y);

      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);

      ctx.beginPath();
      ctx.moveTo(0, my);
      ctx.lineTo(cw, my);
      ctx.moveTo(mx, 0);
      ctx.lineTo(mx, ch);
      ctx.stroke();
      ctx.restore();
    }

    // 9. Floating 4x/8x Pixel Magnifier Loupe
    if (showMagnifier && mouseImgPos && imgRef.current) {
      const mx = Math.round(mouseImgPos.x);
      const my = Math.round(mouseImgPos.y);
      const loupeRadius = Math.max(65, Math.round(sourceWidth / 18));
      const zoom = zoomLevel;

      // Position loupe offset from cursor
      let lx = mx + loupeRadius + 30;
      let ly = my - loupeRadius - 30;
      if (lx + loupeRadius > cw) lx = mx - loupeRadius - 30;
      if (ly - loupeRadius < 0) ly = my + loupeRadius + 30;

      ctx.save();
      ctx.beginPath();
      ctx.arc(lx, ly, loupeRadius, 0, Math.PI * 2);
      ctx.clip();

      // Clear loupe bg
      ctx.fillStyle = '#0F172A';
      ctx.fillRect(lx - loupeRadius, ly - loupeRadius, loupeRadius * 2, loupeRadius * 2);

      // Draw zoomed portion with pixelated crispness
      ctx.imageSmoothingEnabled = false;
      const zoomW = (loupeRadius * 2) / zoom;
      const zoomH = (loupeRadius * 2) / zoom;

      ctx.drawImage(
        imgRef.current,
        mx - zoomW / 2,
        my - zoomH / 2,
        zoomW,
        zoomH,
        lx - loupeRadius,
        ly - loupeRadius,
        loupeRadius * 2,
        loupeRadius * 2
      );

      // Pixel Grid inside Loupe
      if (zoom >= 4) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 1;
        const pixelSizeOnLoupe = zoom;
        const startX = lx - loupeRadius + ((mx - zoomW / 2) % 1) * zoom;
        const startY = ly - loupeRadius + ((my - zoomH / 2) % 1) * zoom;

        for (let gx = startX; gx < lx + loupeRadius; gx += pixelSizeOnLoupe) {
          ctx.beginPath();
          ctx.moveTo(gx, ly - loupeRadius);
          ctx.lineTo(gx, ly + loupeRadius);
          ctx.stroke();
        }
        for (let gy = startY; gy < ly + loupeRadius; gy += pixelSizeOnLoupe) {
          ctx.beginPath();
          ctx.moveTo(lx - loupeRadius, gy);
          ctx.lineTo(lx + loupeRadius, gy);
          ctx.stroke();
        }
      }

      // Center Pixel Box & Crosshair
      ctx.strokeStyle = '#EF4444';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(lx - zoom / 2, ly - zoom / 2, zoom, zoom);

      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(lx - loupeRadius, ly);
      ctx.lineTo(lx - zoom / 2 - 2, ly);
      ctx.moveTo(lx + zoom / 2 + 2, ly);
      ctx.lineTo(lx + loupeRadius, ly);
      ctx.moveTo(lx, ly - loupeRadius);
      ctx.lineTo(lx, ly - zoom / 2 - 2);
      ctx.moveTo(lx, ly + zoom / 2 + 2);
      ctx.lineTo(lx, ly + loupeRadius);
      ctx.stroke();

      ctx.restore();

      // Outer bezel of Loupe
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(lx, ly, loupeRadius, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(lx, ly, loupeRadius - 2, 0, Math.PI * 2);
      ctx.stroke();

      // Loupe bottom pill (coords & zoom)
      const coordPill = `${zoom}x | X:${mx} Y:${my}`;
      ctx.font = 'bold 11px system-ui, sans-serif';
      const pillW = ctx.measureText(coordPill).width + 12;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
      ctx.fillRect(lx - pillW / 2, ly + loupeRadius - 18, pillW, 16);
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 1;
      ctx.strokeRect(lx - pillW / 2, ly + loupeRadius - 18, pillW, 16);
      ctx.fillStyle = '#38BDF8';
      ctx.textAlign = 'center';
      ctx.fillText(coordPill, lx, ly + loupeRadius - 6);
      ctx.textAlign = 'left';
    }
  }, [selection, sourceWidth, sourceHeight, color, showMagnifier, zoomLevel, mouseImgPos]);

  useEffect(() => {
    renderCanvas();
  }, [renderCanvas]);

  // Determine handle mode from mouse position in CSS pixels
  const getHandleAtPos = useCallback(
    (cssX: number, cssY: number, scaleX: number, scaleY: number): DragMode | null => {
      const sx = selection.x / scaleX;
      const sy = selection.y / scaleY;
      const sw = selection.width / scaleX;
      const sh = selection.height / scaleY;
      const hitRadius = 12; // 12 CSS pixels radius

      if (Math.abs(cssX - sx) <= hitRadius && Math.abs(cssY - sy) <= hitRadius) return 'nw';
      if (Math.abs(cssX - (sx + sw)) <= hitRadius && Math.abs(cssY - sy) <= hitRadius) return 'ne';
      if (Math.abs(cssX - (sx + sw)) <= hitRadius && Math.abs(cssY - (sy + sh)) <= hitRadius) return 'se';
      if (Math.abs(cssX - sx) <= hitRadius && Math.abs(cssY - (sy + sh)) <= hitRadius) return 'sw';

      if (Math.abs(cssY - sy) <= hitRadius && cssX >= sx && cssX <= sx + sw) return 'n';
      if (Math.abs(cssY - (sy + sh)) <= hitRadius && cssX >= sx && cssX <= sx + sw) return 's';
      if (Math.abs(cssX - sx) <= hitRadius && cssY >= sy && cssY <= sy + sh) return 'w';
      if (Math.abs(cssX - (sx + sw)) <= hitRadius && cssY >= sy && cssY <= sy + sh) return 'e';

      if (cssX >= sx && cssX <= sx + sw && cssY >= sy && cssY <= sy + sh) return 'move';

      return null;
    },
    [selection]
  );

  // Mouse Down / Pointer Down handler
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // Check if middle click, right click, or space is held -> Pan Mode
    if (e.button === 1 || e.button === 2 || isSpacePressed) {
      e.preventDefault();
      setIsPanning(true);
      setDragMode('pan');
      panStartRef.current = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        startPanX: panOffset.x,
        startPanY: panOffset.y,
      };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }

    if (e.button !== 0) return; // Left click only for crop

    const { cssX, cssY, imgX, imgY, scaleX, scaleY } = getCanvasCoords(e.clientX, e.clientY);
    const hitMode = getHandleAtPos(cssX, cssY, scaleX, scaleY);

    const mode = hitMode || 'create';
    setDragMode(mode);
    setIsDragging(true);

    if (mode === 'create') {
      setSelection({
        x: Math.round(imgX),
        y: Math.round(imgY),
        width: 4,
        height: 4,
      });
      dragStartRef.current = {
        imgX,
        imgY,
        initialRect: { x: imgX, y: imgY, width: 4, height: 4 },
      };
    } else {
      dragStartRef.current = {
        imgX,
        imgY,
        initialRect: { ...selection },
      };
    }

    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  // Global Pointer Move
  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // Handle Canvas Panning
    if (isPanning) {
      const dx = e.clientX - panStartRef.current.mouseX;
      const dy = e.clientY - panStartRef.current.mouseY;
      setPanOffset({
        x: panStartRef.current.startPanX + dx,
        y: panStartRef.current.startPanY + dy,
      });
      return;
    }

    const { cssX, cssY, imgX, imgY, scaleX, scaleY } = getCanvasCoords(e.clientX, e.clientY);

    setMouseImgPos({ x: imgX, y: imgY });

    if (!isDragging) {
      if (isSpacePressed) {
        setCursorStyle('grab');
        return;
      }

      const mode = getHandleAtPos(cssX, cssY, scaleX, scaleY);
      switch (mode) {
        case 'nw':
        case 'se':
          setCursorStyle('nwse-resize');
          break;
        case 'ne':
        case 'sw':
          setCursorStyle('nesw-resize');
          break;
        case 'n':
        case 's':
          setCursorStyle('ns-resize');
          break;
        case 'e':
        case 'w':
          setCursorStyle('ew-resize');
          break;
        case 'move':
          setCursorStyle('move');
          break;
        default:
          setCursorStyle('crosshair');
          break;
      }
      return;
    }

    // Process Crop Dragging
    const dx = imgX - dragStartRef.current.imgX;
    const dy = imgY - dragStartRef.current.imgY;
    const init = dragStartRef.current.initialRect;

    let newRect = { ...init };

    switch (dragMode) {
      case 'create': {
        const startX = Math.min(dragStartRef.current.imgX, imgX);
        const startY = Math.min(dragStartRef.current.imgY, imgY);
        const w = Math.abs(imgX - dragStartRef.current.imgX);
        const h = Math.abs(imgY - dragStartRef.current.imgY);
        newRect = {
          x: Math.max(0, Math.round(startX)),
          y: Math.max(0, Math.round(startY)),
          width: Math.min(sourceWidth - startX, Math.max(4, Math.round(w))),
          height: Math.min(sourceHeight - startY, Math.max(4, Math.round(h))),
        };
        break;
      }
      case 'move': {
        const nx = Math.max(0, Math.min(sourceWidth - init.width, Math.round(init.x + dx)));
        const ny = Math.max(0, Math.min(sourceHeight - init.height, Math.round(init.y + dy)));
        newRect = { ...init, x: nx, y: ny };
        break;
      }
      case 'se': {
        newRect.width = Math.max(4, Math.min(sourceWidth - init.x, Math.round(init.width + dx)));
        newRect.height = Math.max(4, Math.min(sourceHeight - init.y, Math.round(init.height + dy)));
        break;
      }
      case 'nw': {
        const nx = Math.max(0, Math.min(init.x + init.width - 4, Math.round(init.x + dx)));
        const ny = Math.max(0, Math.min(init.y + init.height - 4, Math.round(init.y + dy)));
        newRect.x = nx;
        newRect.y = ny;
        newRect.width = init.width - (nx - init.x);
        newRect.height = init.height - (ny - init.y);
        break;
      }
      case 'ne': {
        const ny = Math.max(0, Math.min(init.y + init.height - 4, Math.round(init.y + dy)));
        newRect.y = ny;
        newRect.width = Math.max(4, Math.min(sourceWidth - init.x, Math.round(init.width + dx)));
        newRect.height = init.height - (ny - init.y);
        break;
      }
      case 'sw': {
        const nx = Math.max(0, Math.min(init.x + init.width - 4, Math.round(init.x + dx)));
        newRect.x = nx;
        newRect.width = init.width - (nx - init.x);
        newRect.height = Math.max(4, Math.min(sourceHeight - init.y, Math.round(init.height + dy)));
        break;
      }
      case 'n': {
        const ny = Math.max(0, Math.min(init.y + init.height - 4, Math.round(init.y + dy)));
        newRect.y = ny;
        newRect.height = init.height - (ny - init.y);
        break;
      }
      case 's': {
        newRect.height = Math.max(4, Math.min(sourceHeight - init.y, Math.round(init.height + dy)));
        break;
      }
      case 'w': {
        const nx = Math.max(0, Math.min(init.x + init.width - 4, Math.round(init.x + dx)));
        newRect.x = nx;
        newRect.width = init.width - (nx - init.x);
        break;
      }
      case 'e': {
        newRect.width = Math.max(4, Math.min(sourceWidth - init.x, Math.round(init.width + dx)));
        break;
      }
    }

    setSelection(newRect);
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

  // Mouse Wheel Zooming on Canvas
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
    setCanvasZoom((prev) => Math.max(0.6, Math.min(6.0, Number((prev * zoomFactor).toFixed(2)))));
  };

  // Reset Zoom & Pan
  const handleResetZoom = () => {
    setCanvasZoom(1.0);
    setPanOffset({ x: 0, y: 0 });
  };

  // Pixel-level Nudge Adjustment (Keyboard & Buttons)
  const nudgeSelection = (dx: number, dy: number, dw: number = 0, dh: number = 0) => {
    setSelection((prev) => {
      const nx = Math.max(0, Math.min(sourceWidth - prev.width, prev.x + dx));
      const ny = Math.max(0, Math.min(sourceHeight - prev.height, prev.y + dy));
      const nw = Math.max(4, Math.min(sourceWidth - nx, prev.width + dw));
      const nh = Math.max(4, Math.min(sourceHeight - ny, prev.height + dh));
      return { x: nx, y: ny, width: nw, height: nh };
    });
  };

  // Global Keyboard Listener (Space bar pan + Arrow nudge + F key full screen)
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        setIsSpacePressed(true);
        setCursorStyle('grab');
        return;
      }

      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        setIsFullscreen((prev) => !prev);
        return;
      }

      const step = e.shiftKey ? 10 : 1;

      if (e.altKey) {
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          nudgeSelection(0, 0, step, 0);
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          nudgeSelection(0, 0, -step, 0);
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          nudgeSelection(0, 0, 0, step);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          nudgeSelection(0, 0, 0, -step);
        }
      } else {
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          nudgeSelection(step, 0);
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          nudgeSelection(-step, 0);
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          nudgeSelection(0, step);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          nudgeSelection(0, -step);
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpacePressed(false);
        setCursorStyle('crosshair');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isOpen, sourceWidth, sourceHeight]);

  const handleSave = () => {
    if (!croppedPreviewUrl) return;

    // If opened for timer icon — STRICTLY save as timer icon, NEVER create detection target!
    if (isForTimerIcon) {
      if (onSaveTimerIcon) {
        onSaveTimerIcon(croppedPreviewUrl);
      }
      onClose();
      return; // Hard stop — never fall through to onSaveTarget
    }

    let normalizedRoi = editingTarget?.normalizedRoi || null;
    if (autoSetRoi) {
      const padW = selection.width * 0.3;
      const padH = selection.height * 0.3;
      const rx = Math.max(0, selection.x - padW) / sourceWidth;
      const ry = Math.max(0, selection.y - padH) / sourceHeight;
      const rw = Math.min(1 - rx, (selection.width + padW * 2) / sourceWidth);
      const rh = Math.min(1 - ry, (selection.height + padH * 2) / sourceHeight);
      normalizedRoi = { x: rx, y: ry, width: rw, height: rh };
    }

    const newTarget: Target = {
      id: editingTarget ? editingTarget.id : `target_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      name: name.trim() || `目標 ${existingTargets.length + 1}`,
      enabled: true,
      color,
      imageDataUrl: croppedPreviewUrl,
      imageWidth: Math.round(selection.width),
      imageHeight: Math.round(selection.height),
      threshold: threshold / 100,
      cooldownSeconds: cooldown,
      normalizedRoi,
      soundType,
      speakName,
      browserNotification: true,
    };

    onSaveTarget(newTarget);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className={`scrim${isFullscreen ? ' flush' : ''}`}>
      <div
        className={`modal${isFullscreen ? ' sheet' : ''}`}
        style={{ '--mw': '1280px' } as React.CSSProperties}
        role="dialog"
        aria-modal="true"
        aria-labelledby="crop-title"
      >
        <header>
          <div className="mtile">
            <Scissors />
          </div>
          <div className="htxt">
            <div className="ttl">
              <h3 id="crop-title">
                {isForTimerIcon
                  ? '計時器圖示截圖（圖示模式）'
                  : editingTarget
                    ? '編輯目標截圖與參數'
                    : '獨立全螢幕高精度截圖視窗'}
              </h3>
              <span className="tag">{isFullscreen ? '全螢幕沉浸模式' : '視窗模式'}</span>
            </div>
            <p>滾輪放大/縮小畫布 • 空白鍵/中鍵拖曳平移 • 8 向手柄 • 4x/8x 放大鏡 • 方向鍵 1px 微調</p>
          </div>

          <div className="hact">
            <button
              type="button"
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="btn"
              title={isFullscreen ? '還原視窗模式 (F 鍵)' : '切換全螢幕放大 (F 鍵)'}
            >
              {isFullscreen ? <Minimize2 /> : <Maximize2 />}
              {isFullscreen ? '還原視窗' : '全螢幕放大'}
            </button>

            {/* 面板收起來的時候這顆要浮起（.btn），因為它是「把面板找回來」的唯一入口；
                面板開著時它只是收合鈕，退成 ghost。 */}
            <button
              type="button"
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className={`btn${isSidebarOpen ? ' ghost' : ''} ico-only`}
              aria-pressed={!isSidebarOpen}
              title={isSidebarOpen ? '收合右側設定面板 (以最大化畫布)' : '展開右側設定面板'}
              aria-label={isSidebarOpen ? '收合右側設定面板' : '展開右側設定面板'}
            >
              {isSidebarOpen ? <PanelRightClose /> : <PanelRightOpen />}
            </button>

            <button
              type="button"
              onClick={onClose}
              className="btn ghost ico-only"
              title="關閉"
              aria-label="關閉"
            >
              <X />
            </button>
          </div>
        </header>

        {/* 畫布工作台：左邊 .stage（底色寫死 #0a0e12，不吃主題，因為上面躺的是
            使用者擷取到的畫面），右邊 .rail 是 320px 的設定欄。 */}
        <div className="work">
          <div
            ref={containerRef}
            onWheel={handleWheel}
            onContextMenu={(e) => e.preventDefault()}
            className="stage"
            style={{
              cursor: isPanning ? 'grabbing' : isSpacePressed ? 'grab' : cursorStyle,
            }}
          >
            {/* Scaled & Panned Canvas Container */}
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
                onPointerLeave={() => setMouseImgPos(null)}
                style={{
                  maxWidth: 'none',
                  maxHeight: isFullscreen ? 'calc(100vh - 100px)' : 'calc(80vh - 120px)',
                  width: 'auto',
                  height: 'auto',
                  display: 'block',
                  touchAction: 'none',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  boxShadow: '0 30px 70px -20px rgba(0, 0, 0, 0.8)',
                }}
              />
            </div>

            {/* 浮在別人的影像上的工具列一律用 .glass（深底玻璃＋亮字，不吃主題）。
                .glass.pad0 會把裡面的 .btn 收成 24×24 方塊，帶文字的那幾顆就地把寬度放回 auto。
                開關狀態不能靠換底色（淺色主題的 .btn 底色會在深色玻璃裡糊掉），改成換字色。 */}
            <div className="stagebar tl">
              <div className="glass pad0">
                <button
                  type="button"
                  onClick={() => setCanvasZoom((z) => Math.max(0.6, Number((z - 0.25).toFixed(2))))}
                  className="btn ghost ico-only"
                  title="縮小畫布 (或滾輪向下)"
                  aria-label="縮小畫布"
                >
                  <ZoomOut />
                </button>

                <span
                  className="num"
                  style={{ fontWeight: 600, minWidth: 38, textAlign: 'center' }}
                >
                  {Math.round(canvasZoom * 100)}%
                </span>

                <button
                  type="button"
                  onClick={() => setCanvasZoom((z) => Math.min(6.0, Number((z + 0.25).toFixed(2))))}
                  className="btn ghost ico-only"
                  title="放大畫布 (或滾輪向上)"
                  aria-label="放大畫布"
                >
                  <ZoomIn />
                </button>

                <span className="sep" />

                <button
                  type="button"
                  onClick={handleResetZoom}
                  className="btn ghost"
                  style={{ width: 'auto', padding: '0 6px' }}
                  title="還原原始大小 (100%)"
                >
                  <RotateCcw />
                  100%
                </button>

                <span className="sep" />

                {/* 開著的時候用強調色的字，不是換底色：這一顆躺在深色玻璃上。 */}
                <button
                  type="button"
                  onClick={() => setShowMagnifier(!showMagnifier)}
                  className="btn ghost"
                  style={{
                    width: 'auto',
                    padding: '0 6px',
                    ...(showMagnifier ? { color: 'var(--acc-txt)' } : null),
                  }}
                  aria-pressed={showMagnifier}
                  title="開關 4x/8x 放大鏡"
                >
                  <Crosshair />
                  放大鏡
                </button>
                {showMagnifier && (
                  <>
                    <span className="sep" />
                    {[2, 4, 8].map((z) => (
                      <button
                        key={z}
                        type="button"
                        onClick={() => setZoomLevel(z)}
                        className="btn ghost"
                        style={{
                          width: 'auto',
                          padding: '0 5px',
                          ...(zoomLevel === z ? { color: 'var(--acc-txt)', fontWeight: 600 } : null),
                        }}
                        aria-pressed={zoomLevel === z}
                        title={`放大鏡倍率 ${z}x`}
                      >
                        {z}x
                      </button>
                    ))}
                  </>
                )}
              </div>
            </div>

            {/* 底下這條同時放三組讀數和一個四向微調，窄視窗塞不進一列，所以用 .glass.wrap
                （會換行、max-width 100%）。.k 是欄名、<b> 是值；「截圖」是使用者正在調的那一個，
                給強調色，另外兩個維持一般字色。原本整條寫死 font-sans，把代幣的字體堆疊蓋掉了，拿掉。 */}
            <div className="stagebar bl" style={{ maxWidth: 'calc(100% - var(--sp3) * 2)' }}>
              <div className="glass wrap">
                <span>
                  <span className="k">原圖: </span>
                  <b className="num">
                    {sourceWidth}×{sourceHeight}
                  </b>
                </span>
                <span className="sep" />
                <span>
                  <span className="k">截圖: </span>
                  <b className="num" style={{ color: 'var(--acc-txt)' }}>
                    {Math.round(selection.width)}×{Math.round(selection.height)}px
                  </b>
                </span>
                <span className="sep" />
                <span>
                  <span className="k">座標: </span>
                  <b className="num">
                    ({Math.round(selection.x)}, {Math.round(selection.y)})
                  </b>
                </span>

                <span className="sep" />
                <span className="k">微調:</span>
                {(
                  [
                    [ArrowLeft, -1, 0, '向左 1px (Shift+← 10px)', '向左微調 1px'],
                    [ArrowRight, 1, 0, '向右 1px (Shift+→ 10px)', '向右微調 1px'],
                    [ArrowUp, 0, -1, '向上 1px (Shift+↑ 10px)', '向上微調 1px'],
                    [ArrowDown, 0, 1, '向下 1px (Shift+↓ 10px)', '向下微調 1px'],
                  ] as const
                ).map(([Icon, dx, dy, tip, label]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => nudgeSelection(dx, dy)}
                    className="btn ghost ico-only"
                    style={{ width: 24, height: 24, borderRadius: 'var(--r1)' }}
                    title={tip}
                    aria-label={label}
                  >
                    <Icon />
                  </button>
                ))}
              </div>
            </div>

            {/* 面板收起來的時候，右上角補一組浮動入口：把面板找回來，或直接存檔。
                這一組也躺在使用者的影像上，所以同樣是 .glass；儲存是主要決定，用 .btn pri。 */}
            {!isSidebarOpen && (
              <div className="stagebar tr">
                <div className="glass pad0">
                  <button
                    type="button"
                    onClick={() => setIsSidebarOpen(true)}
                    className="btn ghost"
                    style={{ width: 'auto', padding: '0 8px' }}
                    title="展開設定面板"
                  >
                    <PanelRightOpen />
                    展開設定面板
                  </button>
                  <span className="sep" />
                  <button
                    type="button"
                    onClick={handleSave}
                    className="btn pri"
                    style={{ width: 'auto', padding: '0 8px' }}
                  >
                    <Sparkles />
                    儲存目標
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 右邊的設定欄。.rail 是固定 320px、自己會滾的一欄（那個寬度就是原本 w-80 的數字），
              裡面所有欄位走 .fgroup／.fbox／.field 那一套。 */}
          {isSidebarOpen && (
            <div className="rail">
              {/* 截圖預覽。.shot80 是 76px 的方框，外框顏色用 inline --tc 傳這個目標自己的顏色，
                  跟畫布上的選取框、HUD 標籤同一個色。 */}
              <div
                className="fbox"
                style={{ gridTemplateColumns: 'auto 1fr', alignItems: 'center', gap: 'var(--sp3)' }}
              >
                <div className="shot80" style={{ '--tc': color } as React.CSSProperties}>
                  {croppedPreviewUrl ? (
                    <img src={croppedPreviewUrl} alt="Cropped Preview" />
                  ) : (
                    <span>無截圖</span>
                  )}
                </div>
                <div style={{ minWidth: 0, display: 'grid', gap: 2 }}>
                  <span className="hint" style={{ margin: 0, color: 'var(--dim)', fontWeight: 600 }}>
                    目標圖案預覽
                  </span>
                  <b className="num" style={{ fontSize: 'var(--fs2)', fontWeight: 600 }}>
                    {Math.round(selection.width)} × {Math.round(selection.height)} px
                  </b>
                  <span className="hint" style={{ margin: 0, color: 'var(--acc-txt)' }}>
                    ✓ 原始像素對應完成
                  </span>
                </div>
              </div>

              {/* 計時器圖示模式：這條路只是「確認並存成圖示」，沒有偵測參數可以調，
                  所以整欄只有一張說明橫幅＋兩顆決定，用 my-auto 的意思讓它停在欄的中間。 */}
              {isForTimerIcon ? (
                <div
                  style={{
                    display: 'grid',
                    gap: 'var(--sp3)',
                    marginTop: 'auto',
                    marginBottom: 'auto',
                  }}
                >
                  <div className="banner ok">
                    <Sparkles />
                    <p>
                      <b>計時器專屬圖示</b>
                      <br />✓ 此截圖將直接作為懸浮窗與技能倒數專屬圖示，絕不加入或影響影像偵測清單。
                    </p>
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gap: 'var(--sp2)',
                      paddingTop: 'var(--sp3)',
                      borderTop: '1px solid var(--line)',
                    }}
                  >
                    <button type="button" onClick={onClose} className="btn wide">
                      取消
                    </button>
                    <button type="button" onClick={handleSave} className="btn pri wide">
                      <Sparkles />
                      儲存為計時器圖示
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="fgroup">
                    <label htmlFor="crop-name">目標自訂名稱</label>
                    <input
                      id="crop-name"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="例如：Boss 出現標記、任務完成按鈕"
                      className="field lg"
                    />
                  </div>

                  {/* 顏色用 .dots：選中的那一顆靠 aria-pressed 畫白色外框（無障礙與外觀同一個來源），
                      不要再用 inline borderColor 自己畫。 */}
                  <div className="fgroup">
                    <label>辨識框顏色 (HUD Color)</label>
                    <div className="dots">
                      {COLOR_PALETTE.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setColor(c)}
                          style={{ backgroundColor: c }}
                          aria-pressed={color === c}
                          aria-label={`辨識框顏色 ${c}`}
                        >
                          {color === c && <Check />}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 兩條滑桿的填色靠 inline --p（CSS 用它畫 track 的漸層），數字用 .num 固定欄寬，
                      顏色跟填色同一個強調色，才看得出「這個數字就是那條的量」。 */}
                  <div className="fgroup">
                    <label htmlFor="crop-threshold" style={{ justifyContent: 'space-between' }}>
                      <span>相似度門檻 (Similarity Threshold)</span>
                      <b className="num" style={{ color: 'var(--acc-txt)' }}>
                        {threshold}%
                      </b>
                    </label>
                    <input
                      id="crop-threshold"
                      type="range"
                      min="50"
                      max="99"
                      value={threshold}
                      onChange={(e) => setThreshold(Number(e.target.value))}
                      style={
                        { '--p': `${((threshold - 50) / 49) * 100}%` } as React.CSSProperties
                      }
                    />
                    <span className="hint" style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>50% (寬鬆)</span>
                      <span>85% (建議)</span>
                      <span>99% (嚴格)</span>
                    </span>
                  </div>

                  <div className="fgroup">
                    <label htmlFor="crop-cooldown" style={{ justifyContent: 'space-between' }}>
                      <span>觸發冷卻時間 (Cooldown)</span>
                      <b className="num" style={{ color: 'var(--acc-txt)' }}>
                        {cooldown} 秒
                      </b>
                    </label>
                    <input
                      id="crop-cooldown"
                      type="range"
                      min="1"
                      max="30"
                      value={cooldown}
                      onChange={(e) => setCooldown(Number(e.target.value))}
                      style={{ '--p': `${((cooldown - 1) / 29) * 100}%` } as React.CSSProperties}
                    />
                  </div>

                  {/* 音效那一列：下拉是 30px 的 .field.lg，旁邊的試聽鈕就地拉成同高才不會參差。 */}
                  <div className="fgroup">
                    <label htmlFor="crop-sound">偵測提示音效 (Alert Sound)</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp2)' }}>
                      <select
                        id="crop-sound"
                        value={soundType}
                        onChange={(e) => setSoundType(e.target.value as SoundType)}
                        className="field lg"
                        style={{ flex: 1, minWidth: 0 }}
                      >
                        <option value="double_ding">🎯 雙音 (Double Ding)</option>
                        <option value="chime">🔔 清脆鈴聲 (Chime)</option>
                        <option value="beep">🚨 電子嗶嗶聲 (Beep)</option>
                        <option value="siren">⚠️ 急促警報 (Siren)</option>
                        <option value="coin">🪙 遊戲金幣聲 (Coin)</option>
                        <option value="scifi">⚡ 科技脈衝 (Sci-Fi Pulse)</option>
                        <option value="fanfare">🎺 勝利號角 (Fanfare)</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => playAlertSound(soundType, 0.8)}
                        className="btn"
                        style={{ height: 30, flex: 'none' }}
                        title="試聽音效"
                      >
                        <Volume2 />
                        試聽
                      </button>
                    </div>
                  </div>

                  {/* 兩個開關放同一個 .fbox 裡。.ckl 預設 white-space:nowrap（那是給短標籤用的），
                      ROI 這一句在 320px 的欄裡一定要能折行，所以就地放開並改成頂端對齊。 */}
                  <div className="fbox">
                    <label className="ckl">
                      <input
                        type="checkbox"
                        checked={speakName}
                        onChange={(e) => setSpeakName(e.target.checked)}
                      />
                      <span>語音播報目標名稱 (語音朗讀)</span>
                    </label>

                    {!editingTarget && (
                      <label
                        className="ckl"
                        style={{ whiteSpace: 'normal', alignItems: 'flex-start' }}
                      >
                        <input
                          type="checkbox"
                          checked={autoSetRoi}
                          onChange={(e) => setAutoSetRoi(e.target.checked)}
                          style={{ marginTop: 1 }}
                        />
                        <span>自動將當前截圖周圍設為此目標的偵測區域 (ROI)</span>
                      </label>
                    )}
                  </div>

                  {/* 決定放在欄底（marginTop:auto 把它推下去）。320px 的欄放不下兩顆並排的長字，
                      所以用 .btn.wide 上下疊，主要決定在下面——跟其他視窗的頁尾同一個順序。 */}
                  <div
                    style={{
                      display: 'grid',
                      gap: 'var(--sp2)',
                      marginTop: 'auto',
                      paddingTop: 'var(--sp3)',
                      borderTop: '1px solid var(--line)',
                    }}
                  >
                    <button type="button" onClick={onClose} className="btn wide">
                      取消
                    </button>
                    <button type="button" onClick={handleSave} className="btn pri wide">
                      <Sparkles />
                      {editingTarget ? '更新目標設定' : '儲存目標'}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
