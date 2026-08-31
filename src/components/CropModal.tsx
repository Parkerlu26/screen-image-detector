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
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md transition-all duration-200 ${
        isFullscreen ? 'p-0' : 'p-3 lg:p-4'
      }`}
    >
      <div
        className={`bg-slate-950 border border-slate-700/80 shadow-2xl flex flex-col overflow-hidden transition-all duration-200 ${
          isFullscreen ? 'w-screen h-screen rounded-none' : 'w-full max-w-7xl rounded-2xl max-h-[95vh]'
        }`}
      >
        {/* Top Header Bar */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800 bg-slate-950/95 z-30 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Scissors className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white">
                  {isForTimerIcon ? '計時器圖示截圖（圖示模式）' : editingTarget ? '編輯目標截圖與參數' : '獨立全螢幕高精度截圖視窗'}
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/40">
                  {isFullscreen ? '全螢幕沉浸模式' : '視窗模式'}
                </span>
              </div>
              <p className="text-xs text-slate-400 hidden sm:block">
                滾輪放大/縮小畫布 • 空白鍵/中鍵拖曳平移 • 8 向手柄 • 4x/8x 放大鏡 • 方向鍵 1px 微調
              </p>
            </div>
          </div>

          {/* Quick Header Buttons */}
          <div className="flex items-center gap-2">
            {/* Toggle Fullscreen / Window Mode */}
            <button
              type="button"
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white rounded-lg border border-slate-700 text-xs font-semibold transition-colors"
              title={isFullscreen ? '還原視窗模式 (F 鍵)' : '切換全螢幕放大 (F 鍵)'}
            >
              {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              <span>{isFullscreen ? '還原視窗' : '全螢幕放大'}</span>
            </button>

            {/* Toggle Sidebar */}
            <button
              type="button"
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className={`p-1.5 rounded-lg border text-xs transition-colors ${
                isSidebarOpen
                  ? 'bg-slate-850 text-slate-300 border-slate-700 hover:text-white'
                  : 'bg-indigo-600 text-white border-indigo-500'
              }`}
              title={isSidebarOpen ? '收合右側設定面板 (以最大化畫布)' : '展開右側設定面板'}
            >
              {isSidebarOpen ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
            </button>

            {/* Close */}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors ml-1"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Main Work Area (Canvas + Floating/Sidebar Settings) */}
        <div className="flex-1 flex overflow-hidden relative">
          {/* Canvas Viewport (Left/Center) */}
          <div
            ref={containerRef}
            onWheel={handleWheel}
            onContextMenu={(e) => e.preventDefault()}
            className="flex-1 relative flex items-center justify-center bg-slate-950 overflow-hidden select-none"
            style={{
              cursor: isPanning ? 'grabbing' : isSpacePressed ? 'grab' : cursorStyle,
            }}
          >
            {/* Scaled & Panned Canvas Container */}
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
                onPointerLeave={() => setMouseImgPos(null)}
                className="max-w-none shadow-2xl border border-slate-800 touch-none"
                style={{
                  maxHeight: isFullscreen ? 'calc(100vh - 100px)' : 'calc(80vh - 120px)',
                  width: 'auto',
                  height: 'auto',
                }}
              />
            </div>

            {/* Floating Top-Left Canvas Controls (Zoom / Pan / Fit) */}
            <div className="absolute top-4 left-4 z-20 flex items-center gap-1.5 bg-slate-900/90 backdrop-blur-md px-2 py-1.5 rounded-xl border border-slate-700/80 shadow-2xl text-xs">
              {/* Zoom Out */}
              <button
                type="button"
                onClick={() => setCanvasZoom((z) => Math.max(0.6, Number((z - 0.25).toFixed(2))))}
                className="p-1 text-slate-300 hover:text-white hover:bg-slate-800 rounded-md transition-colors"
                title="縮小畫布 (或滾輪向下)"
              >
                <ZoomOut className="w-4 h-4" />
              </button>

              {/* Zoom % */}
              <span className="font-mono font-bold text-white px-1 min-w-[45px] text-center">
                {Math.round(canvasZoom * 100)}%
              </span>

              {/* Zoom In */}
              <button
                type="button"
                onClick={() => setCanvasZoom((z) => Math.min(6.0, Number((z + 0.25).toFixed(2))))}
                className="p-1 text-slate-300 hover:text-white hover:bg-slate-800 rounded-md transition-colors"
                title="放大畫布 (或滾輪向上)"
              >
                <ZoomIn className="w-4 h-4" />
              </button>

              <div className="h-4 w-px bg-slate-700 mx-0.5" />

              {/* Reset Zoom & Pan */}
              <button
                type="button"
                onClick={handleResetZoom}
                className="px-2 py-1 text-[11px] font-semibold text-slate-300 hover:text-white hover:bg-slate-800 rounded-md transition-colors flex items-center gap-1"
                title="還原原始大小 (100%)"
              >
                <RotateCcw className="w-3 h-3" />
                100%
              </button>

              {/* Magnifier Toggle */}
              <button
                type="button"
                onClick={() => setShowMagnifier(!showMagnifier)}
                className={`px-2 py-1 rounded-md text-[11px] font-semibold transition-colors flex items-center gap-1 ${
                  showMagnifier ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                <Crosshair className="w-3 h-3" />
                放大鏡
              </button>
              {showMagnifier && (
                <div className="flex items-center gap-0.5 border-l border-slate-700 pl-1">
                  {[2, 4, 8].map((z) => (
                    <button
                      key={z}
                      type="button"
                      onClick={() => setZoomLevel(z)}
                      className={`px-1 py-0.5 rounded text-[10px] font-bold ${
                        zoomLevel === z
                          ? 'bg-indigo-500/40 text-indigo-300 border border-indigo-500/50'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {z}x
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Floating Bottom-Left Precision Info Bar */}
            <div className="absolute bottom-4 left-4 z-20 flex flex-wrap items-center gap-3 bg-slate-900/90 backdrop-blur-md px-3 py-2 rounded-xl border border-slate-700/80 shadow-2xl text-xs text-slate-300 font-mono">
              <div>
                原圖: <strong className="text-white">{sourceWidth}×{sourceHeight}</strong>
              </div>
              <span className="text-slate-600">•</span>
              <div>
                截圖: <strong className="text-emerald-400 font-bold">{Math.round(selection.width)}×{Math.round(selection.height)}px</strong>
              </div>
              <span className="text-slate-600">•</span>
              <div>
                座標: <strong className="text-cyan-400">({Math.round(selection.x)}, {Math.round(selection.y)})</strong>
              </div>

              {/* 1px Nudge Direction D-Pad */}
              <div className="flex items-center gap-1 pl-2 border-l border-slate-700">
                <span className="text-[11px] text-slate-400 font-sans">微調:</span>
                <button
                  type="button"
                  onClick={() => nudgeSelection(-1, 0)}
                  className="p-1 hover:bg-slate-800 rounded text-slate-300"
                  title="向左 1px (Shift+← 10px)"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => nudgeSelection(1, 0)}
                  className="p-1 hover:bg-slate-800 rounded text-slate-300"
                  title="向右 1px (Shift+→ 10px)"
                >
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => nudgeSelection(0, -1)}
                  className="p-1 hover:bg-slate-800 rounded text-slate-300"
                  title="向上 1px (Shift+↑ 10px)"
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => nudgeSelection(0, 1)}
                  className="p-1 hover:bg-slate-800 rounded text-slate-300"
                  title="向下 1px (Shift+↓ 10px)"
                >
                  <ArrowDown className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Quick Unhide Sidebar Floating Button (if collapsed) */}
            {!isSidebarOpen && (
              <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsSidebarOpen(true)}
                  className="px-3.5 py-2 rounded-xl bg-slate-900/90 border border-slate-700/80 backdrop-blur-md text-white text-xs font-bold shadow-2xl flex items-center gap-2 hover:bg-slate-800"
                >
                  <PanelRightOpen className="w-4 h-4 text-emerald-400" />
                  展開設定面板
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg shadow-emerald-950/60 flex items-center gap-1.5"
                >
                  <Sparkles className="w-4 h-4" />
                  儲存目標
                </button>
              </div>
            )}
          </div>

          {/* Target Settings Side Panel (Right) */}
          {isSidebarOpen && (
            <div className="w-80 lg:w-96 bg-slate-900 border-l border-slate-800 p-5 flex flex-col gap-4 overflow-y-auto z-20 shrink-0 shadow-2xl">
              {/* Cropped Preview Thumbnail */}
              <div className="flex items-center gap-3.5 p-3 bg-slate-950 rounded-xl border border-slate-800">
                <div
                  className="w-20 h-20 rounded-lg border-2 flex items-center justify-center p-1 bg-slate-900 overflow-hidden shrink-0 shadow-inner"
                  style={{ borderColor: color }}
                >
                  {croppedPreviewUrl ? (
                    <img
                      src={croppedPreviewUrl}
                      alt="Cropped Preview"
                      className="max-w-full max-h-full object-contain image-rendering-pixelated"
                    />
                  ) : (
                    <span className="text-xs text-slate-500">無截圖</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-0.5">
                    目標圖案預覽
                  </span>
                  <p className="text-xs font-bold text-white font-mono">
                    {Math.round(selection.width)} × {Math.round(selection.height)} px
                  </p>
                  <p className="text-[11px] text-emerald-400 mt-1">
                    ✓ 原始像素對應完成
                  </p>
                </div>
              </div>

              {/* If for Timer Icon, show simple dedicated timer icon confirmation */}
              {isForTimerIcon ? (
                <div className="space-y-4 my-auto p-2">
                  <div className="p-3 bg-emerald-950/40 border border-emerald-500/40 rounded-xl text-emerald-300 text-xs space-y-1">
                    <p className="font-bold flex items-center gap-1.5 text-sm">
                      <Sparkles className="w-4 h-4 text-emerald-400" />
                      計時器專屬圖示
                    </p>
                    <p className="text-[11px] text-slate-300">
                      ✓ 此截圖將直接作為懸浮窗與技能倒數專屬圖示，絕不加入或影響影像偵測清單。
                    </p>
                  </div>

                  <div className="flex items-center gap-3 pt-4 border-t border-slate-800">
                    <button
                      type="button"
                      onClick={onClose}
                      className="flex-1 py-2.5 px-4 rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors text-xs font-medium"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      onClick={handleSave}
                      className="flex-1 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white transition-colors text-xs font-bold shadow-lg shadow-emerald-900/40 flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Sparkles className="w-4 h-4" />
                      儲存為計時器圖示
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Target Name */}
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      目標自訂名稱
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="例如：Boss 出現標記、任務完成按鈕"
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 font-medium"
                    />
                  </div>

                  {/* Color Badge Picker */}
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      辨識框顏色 (HUD Color)
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {COLOR_PALETTE.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setColor(c)}
                          className="w-7 h-7 rounded-full border-2 transition-transform hover:scale-110 flex items-center justify-center cursor-pointer"
                          style={{
                            backgroundColor: c,
                            borderColor: color === c ? '#FFFFFF' : 'transparent',
                          }}
                        >
                          {color === c && <Check className="w-3.5 h-3.5 text-white drop-shadow" />}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Similarity Slider */}
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="text-xs font-medium text-slate-300">
                        相似度門檻 (Similarity Threshold)
                      </label>
                      <span className="text-xs font-bold text-emerald-400 font-mono">{threshold}%</span>
                    </div>
                    <input
                      type="range"
                      min="50"
                      max="99"
                      value={threshold}
                      onChange={(e) => setThreshold(Number(e.target.value))}
                      className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                    />
                    <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                      <span>50% (寬鬆)</span>
                      <span>85% (建議)</span>
                      <span>99% (嚴格)</span>
                    </div>
                  </div>

                  {/* Cooldown Seconds */}
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="text-xs font-medium text-slate-300">
                        觸發冷卻時間 (Cooldown)
                      </label>
                      <span className="text-xs font-bold text-cyan-400 font-mono">{cooldown} 秒</span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="30"
                      value={cooldown}
                      onChange={(e) => setCooldown(Number(e.target.value))}
                      className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                    />
                  </div>

                  {/* Alert Sound Preset */}
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      偵測提示音效 (Alert Sound)
                    </label>
                    <div className="flex items-center gap-2">
                      <select
                        value={soundType}
                        onChange={(e) => setSoundType(e.target.value as SoundType)}
                        className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
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
                        className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700 transition-colors flex items-center gap-1 text-xs font-medium"
                        title="試聽音效"
                      >
                        <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
                        試聽
                      </button>
                    </div>
                  </div>

                  {/* Extra Options */}
                  <div className="space-y-2 pt-2 border-t border-slate-800">
                    <label className="flex items-center gap-2.5 cursor-pointer text-xs text-slate-300">
                      <input
                        type="checkbox"
                        checked={speakName}
                        onChange={(e) => setSpeakName(e.target.checked)}
                        className="w-4 h-4 rounded bg-slate-950 border-slate-700 text-emerald-600 focus:ring-0"
                      />
                      <span>語音播報目標名稱 (語音朗讀)</span>
                    </label>

                    {!editingTarget && (
                      <label className="flex items-center gap-2.5 cursor-pointer text-xs text-slate-300">
                        <input
                          type="checkbox"
                          checked={autoSetRoi}
                          onChange={(e) => setAutoSetRoi(e.target.checked)}
                          className="w-4 h-4 rounded bg-slate-950 border-slate-700 text-emerald-600 focus:ring-0"
                        />
                        <span>自動將當前截圖周圍設為此目標的偵測區域 (ROI)</span>
                      </label>
                    )}
                  </div>

                  {/* Bottom Actions */}
                  <div className="flex items-center gap-3 mt-auto pt-4 border-t border-slate-800">
                    <button
                      type="button"
                      onClick={onClose}
                      className="flex-1 py-2.5 px-4 rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors text-xs font-medium"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      onClick={handleSave}
                      className="flex-1 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white transition-colors text-xs font-bold shadow-lg shadow-emerald-900/40 flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Sparkles className="w-4 h-4" />
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
