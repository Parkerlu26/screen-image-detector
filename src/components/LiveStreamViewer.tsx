import React, { useRef, useEffect, useState } from 'react';
import { Target, MatchResult, GlobalSettings } from '../types';
import {
  Video,
  VideoOff,
  Camera,
  Eye,
  EyeOff,
  Maximize2,
  Minimize2,
  Crosshair,
  Activity,
  Play,
  Pause,
} from 'lucide-react';

interface LiveStreamViewerProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  isStreamActive: boolean;
  isPaused: boolean;
  onTogglePause: () => void;
  onStartCapture: () => void;
  onStopCapture: () => void;
  onOpenCropModal: () => void;
  targets: Target[];
  latestMatches: MatchResult[];
  settings: GlobalSettings;
  fps: number;
  latencyMs: number;
  /** True while the candidate sweep is running on the GPU. */
  gpuActive?: boolean;
  sourceWidth: number;
  sourceHeight: number;
}

export const LiveStreamViewer: React.FC<LiveStreamViewerProps> = ({
  videoRef,
  isStreamActive,
  isPaused,
  onTogglePause,
  onStartCapture,
  onStopCapture,
  onOpenCropModal,
  targets,
  latestMatches,
  settings,
  fps,
  latencyMs,
  gpuActive = false,
  sourceWidth,
  sourceHeight,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showHud, setShowHud] = useState(true);

  // Sync physical video element playback state with isPaused
  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      if (isPaused) {
        video.pause();
      } else if (isStreamActive) {
        video.play().catch(() => {});
      }
    }
  }, [isPaused, isStreamActive, videoRef]);

  // Toggle fullscreen
  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  // Lightweight 60 FPS Transparent Overlay Drawing
  useEffect(() => {
    if (!isStreamActive) return;

    let isRunning = true;
    let animId: number;

    const drawOverlay = () => {
      if (!isRunning) return;

      const overlay = overlayCanvasRef.current;
      const video = videoRef.current;

      if (overlay && video && video.readyState >= 2) {
        const vw = video.videoWidth || sourceWidth || 1280;
        const vh = video.videoHeight || sourceHeight || 720;

        if (overlay.width !== vw || overlay.height !== vh) {
          overlay.width = vw;
          overlay.height = vh;
        }

        const ctx = overlay.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, vw, vh);

          // Only draw bounding boxes and ROI if showHud is enabled
          if (showHud) {
            // 1. Draw ROI outlines
            if (settings.showRoiOnStream) {
              targets.forEach((t) => {
                if (t.enabled && t.normalizedRoi) {
                  const rx = t.normalizedRoi.x * vw;
                  const ry = t.normalizedRoi.y * vh;
                  const rw = t.normalizedRoi.width * vw;
                  const rh = t.normalizedRoi.height * vh;

                  ctx.save();
                  ctx.strokeStyle = t.color;
                  ctx.lineWidth = 1.5;
                  ctx.setLineDash([6, 6]);
                  ctx.strokeRect(rx, ry, rw, rh);
                  ctx.fillStyle = `${t.color}15`;
                  ctx.fillRect(rx, ry, rw, rh);
                  ctx.fillStyle = t.color;
                  ctx.font = '11px system-ui, sans-serif';
                  ctx.fillText(`[ROI] ${t.name}`, rx + 4, ry + 14);
                  ctx.restore();
                }
              });
            }

            // 2. Draw bounding boxes on screen
            if (settings.showBoundingBoxesOnStream && latestMatches.length > 0) {
              latestMatches.forEach((match) => {
                const box = match.box;
                ctx.save();
                ctx.strokeStyle = match.color;
                ctx.lineWidth = 1.5;
                ctx.strokeRect(box.x, box.y, box.width, box.height);

                // Corner bracket accents
                const cLen = Math.min(10, box.width / 4);
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(box.x - 1, box.y + cLen); ctx.lineTo(box.x - 1, box.y - 1); ctx.lineTo(box.x + cLen, box.y - 1);
                ctx.moveTo(box.x + box.width - cLen, box.y - 1); ctx.lineTo(box.x + box.width + 1, box.y - 1); ctx.lineTo(box.x + box.width + 1, box.y + cLen);
                ctx.moveTo(box.x - 1, box.y + box.height - cLen); ctx.lineTo(box.x - 1, box.y + box.height + 1); ctx.lineTo(box.x + cLen, box.y + box.height + 1);
                ctx.moveTo(box.x + box.width - cLen, box.y + box.height + 1); ctx.lineTo(box.x + box.width + 1, box.y + box.height + 1); ctx.lineTo(box.x + box.width + 1, box.y + box.height - cLen);
                ctx.stroke();

                // HUD Label badge
                const label = `🎯 ${match.targetName} ${(match.similarity * 100).toFixed(1)}%`;
                ctx.font = 'bold 13px system-ui, sans-serif';
                const textWidth = ctx.measureText(label).width;
                const labelY = box.y > 26 ? box.y - 26 : box.y + box.height + 6;
                ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
                ctx.fillRect(box.x - 2, labelY, textWidth + 16, 24);
                ctx.strokeStyle = match.color;
                ctx.lineWidth = 1.5;
                ctx.strokeRect(box.x - 2, labelY, textWidth + 16, 24);
                ctx.fillStyle = '#FFFFFF';
                ctx.fillText(label, box.x + 6, labelY + 16);
                ctx.restore();
              });
            }
          }
        }
      }

      if (isRunning) {
        animId = requestAnimationFrame(drawOverlay);
      }
    };

    animId = requestAnimationFrame(drawOverlay);
    return () => {
      isRunning = false;
      cancelAnimationFrame(animId);
    };
  }, [isStreamActive, showHud, targets, latestMatches, settings, sourceWidth, sourceHeight]);

  return (
    <div
      ref={containerRef}
      className="relative flex flex-col h-full w-full bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl group min-h-0"
    >
      {/* Top HUD Bar */}
      <div className="absolute top-3 left-3 right-3 z-30 flex items-center justify-between pointer-events-none">
        {/* Left: Stream Stats & Badges (Hidden when showHud is false) */}
        <div className="flex items-center gap-2 pointer-events-auto">
          {showHud && (
            isStreamActive ? (
              <div className="flex items-center gap-2 bg-slate-900/90 backdrop-blur-md px-3 py-1.5 rounded-xl border border-slate-700/80 shadow-lg text-xs">
                <span className="relative flex h-2.5 w-2.5">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${isPaused ? 'bg-amber-400 opacity-75' : 'bg-emerald-400 opacity-75'}`} />
                  <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${isPaused ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                </span>
                <span className="font-bold text-white">
                  {isPaused ? '串流已暫停' : '即時視窗監控中'}
                </span>
                <span className="text-slate-500">|</span>
                <span className="text-slate-300 font-mono">
                  {sourceWidth > 0 ? `${sourceWidth}×${sourceHeight}` : '--'}
                </span>
                <span className="text-slate-500">|</span>
                <span className="text-emerald-400 font-mono font-bold flex items-center gap-1">
                  <Activity className="w-3.5 h-3.5" />
                  {fps} FPS
                </span>
                <span className="text-slate-500">|</span>
                <span className="text-cyan-400 font-mono">{latencyMs}ms</span>
                {gpuActive && (
                  <>
                    <span className="text-slate-500">|</span>
                    <span
                      className="text-violet-300 font-mono font-bold"
                      title="比對搜尋在顯示卡上執行，CPU 只負責最後的精確比對"
                    >
                      GPU
                    </span>
                  </>
                )}
              </div>
            ) : (
              <div className="bg-slate-900/80 backdrop-blur-md px-3 py-1.5 rounded-xl border border-slate-800 text-xs text-slate-400 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-slate-600" />
                <span>尚未擷取視窗或螢幕</span>
              </div>
            )
          )}
        </div>

        {/* Right: Quick Overlay Controls (Always accessible) */}
        {isStreamActive && (
          <div className="flex items-center gap-1.5 bg-slate-900/90 backdrop-blur-md p-1 rounded-xl border border-slate-700/80 shadow-lg pointer-events-auto">
            {/* Pause / Resume Button */}
            <button
              type="button"
              onClick={onTogglePause}
              className={`p-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1 ${
                isPaused
                  ? 'bg-amber-500/30 text-amber-300 border border-amber-500/50'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800'
              }`}
              title={isPaused ? '繼續即時串流' : '暫停畫面'}
            >
              {isPaused ? <Play className="w-4 h-4 text-amber-400" /> : <Pause className="w-4 h-4" />}
            </button>

            {/* Show / Hide HUD Button */}
            <button
              type="button"
              onClick={() => setShowHud(!showHud)}
              className={`p-1.5 rounded-lg text-xs transition-colors ${
                showHud ? 'text-emerald-400 bg-emerald-500/10' : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
              title={showHud ? '隱藏 HUD 標籤與辨識框' : '顯示 HUD 標籤與辨識框'}
            >
              {showHud ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4 text-slate-500" />}
            </button>

            {/* Fullscreen Button */}
            <button
              type="button"
              onClick={toggleFullscreen}
              className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
              title={isFullscreen ? '退出全螢幕' : '全螢幕檢視'}
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          </div>
        )}
      </div>

      {/* Main Video & Overlay Container (Auto scales with parent size) */}
      <div className="relative flex-1 w-full h-full flex items-center justify-center bg-slate-950 p-2 overflow-hidden min-h-0">
        <div className={`relative w-full h-full flex items-center justify-center ${isStreamActive ? '' : 'hidden'}`}>
          {/* Direct GPU Hardware-Accelerated Video (Smooth 60+ FPS native streaming) */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-contain rounded-lg shadow-2xl border border-slate-800"
          />
          {/* Transparent High-Speed Overlay Canvas for Bounding Boxes & ROI */}
          <canvas
            ref={overlayCanvasRef}
            className="pointer-events-none absolute inset-0 w-full h-full object-contain"
          />
        </div>

        {!isStreamActive && (
          /* Empty / Standby State Screen */
          <div className="flex flex-col items-center justify-center p-8 text-center max-w-md">
            <div className="w-20 h-20 rounded-3xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-500 mb-5 shadow-xl">
              <VideoOff className="w-10 h-10 text-slate-600" />
            </div>

            <h3 className="text-base font-bold text-white mb-2">
              準備好開始即時影像辨識
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed mb-6">
              選擇要擷取的遊戲視窗、應用程式或全螢幕，即可框選截圖目標並進行毫秒級自動辨識與聲音提醒。
            </p>

            <div className="flex items-center gap-3 w-full justify-center">
              <button
                type="button"
                onClick={onStartCapture}
                className="w-full sm:w-auto px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all shadow-lg shadow-emerald-950/50 flex items-center justify-center gap-2 cursor-pointer"
              >
                <Video className="w-4 h-4" />
                開始擷取視窗 / 螢幕
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Floating Control Bar (Hidden when showHud is false) */}
      {isStreamActive && showHud && (
        <div className="p-3 bg-slate-950/90 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3 z-20 shrink-0 animate-in fade-in duration-150">
          {/* Left: Quick Screenshot Action */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onOpenCropModal}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-emerald-950/40 flex items-center gap-2 cursor-pointer"
            >
              <Camera className="w-4 h-4" />
              截圖新增目標
            </button>
          </div>

          {/* Right: Active Match summary & Stream Stop */}
          <div className="flex items-center gap-3">
            {latestMatches.length > 0 && (
              <div className="flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/30 px-3 py-1.5 rounded-xl text-xs text-emerald-300 font-semibold animate-pulse">
                <Crosshair className="w-3.5 h-3.5 text-emerald-400" />
                <span>命中 {latestMatches.length} 個目標!</span>
              </div>
            )}

            <button
              type="button"
              onClick={onStopCapture}
              className="px-3 py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded-xl text-xs font-medium transition-colors cursor-pointer"
            >
              結束擷取
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
