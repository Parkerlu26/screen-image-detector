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
  Check,
  Sparkles,
  X,
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

                // HUD Label badge（底色跟著新版玻璃材質，字級與結構不動）
                const label = `🎯 ${match.targetName} ${(match.similarity * 100).toFixed(1)}%`;
                ctx.font = 'bold 13px system-ui, sans-serif';
                const textWidth = ctx.measureText(label).width;
                const labelY = box.y > 26 ? box.y - 26 : box.y + box.height + 6;
                ctx.fillStyle = 'rgba(14, 15, 17, 0.82)';
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
    <div ref={containerRef} className="viewer">
      {/* .canvas 自己是容器查詢的容器：HUD 依「畫布寬度」決定丟掉哪些欄位 */}
      <div className="canvas">
        {/* 影像層永遠掛著不卸載，否則切分頁回來要重新要一次擷取權限 */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: isStreamActive ? 'flex' : 'none',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* Direct GPU Hardware-Accelerated Video (Smooth 60+ FPS native streaming) */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
          {/* Transparent High-Speed Overlay Canvas for Bounding Boxes & ROI */}
          <canvas
            ref={overlayCanvasRef}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              pointerEvents: 'none',
            }}
          />
        </div>

        {/* 待機畫面：還沒選畫面來源時整塊蓋在畫布上 */}
        {!isStreamActive && (
          <div className="standby">
            <span className="tile">
              <VideoOff />
            </span>
            <h3>準備好開始即時影像辨識</h3>
            <p>選擇要擷取的遊戲視窗、應用程式或全螢幕，即可框選截圖目標並進行毫秒級自動辨識與聲音提醒。</p>
            <button type="button" onClick={onStartCapture} className="btn pri">
              <Video />
              開始擷取視窗 / 螢幕
            </button>
          </div>
        )}

        {/* 浮在影像上的東西才用 iOS 毛玻璃材質 */}
        <div className="hud">
          <div style={{ display: 'flex', gap: 'var(--sp2)', alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}>
            {showHud && (
              isStreamActive ? (
                <>
                  <span className="glass">
                    <span className={`dot${isPaused ? ' paused' : ''}`} />
                    {isPaused ? '串流已暫停' : '即時視窗監控中'}
                    <span className="gseg d2">
                      <span className="sep" />
                      <span className="num" style={{ color: 'var(--dim)' }}>
                        {sourceWidth > 0 ? `${sourceWidth}×${sourceHeight}` : '--'}
                      </span>
                    </span>
                    <span className="gseg">
                      <span className="sep" />
                      <span className="num" style={{ color: 'var(--acc-txt)', fontWeight: 600 }}>
                        {fps} FPS
                      </span>
                    </span>
                    <span className="gseg d1">
                      <span className="sep" />
                      <span className="num" style={{ color: 'var(--dim)' }}>
                        {latencyMs} ms
                      </span>
                    </span>
                  </span>

                  {gpuActive && (
                    <span
                      className="glass d3"
                      style={{ gap: 5, color: 'var(--dim)' }}
                      title="比對搜尋在顯示卡上執行，CPU 只負責最後的精確比對"
                    >
                      <Sparkles style={{ width: 13, height: 13, color: 'var(--acc-txt)' }} />
                      GPU 加速
                    </span>
                  )}
                </>
              ) : (
                <span className="glass" style={{ color: 'var(--dim)' }}>
                  <span className="dot idle" />
                  尚未擷取視窗或螢幕
                </span>
              )
            )}
          </div>

          {/* 覆蓋層快捷鍵：串流中永遠可按，就算 HUD 標籤被關掉 */}
          {isStreamActive && (
            <div className="glass pad0">
              <button
                type="button"
                onClick={onTogglePause}
                className="btn ghost ico-only"
                style={isPaused ? { color: 'var(--warn)' } : undefined}
                aria-label={isPaused ? '繼續即時串流' : '暫停畫面'}
                title={isPaused ? '繼續即時串流' : '暫停畫面'}
              >
                {isPaused ? <Play /> : <Pause />}
              </button>

              <button
                type="button"
                onClick={() => setShowHud(!showHud)}
                className="btn ghost ico-only"
                style={showHud ? { color: 'var(--acc-txt)' } : undefined}
                aria-label={showHud ? '隱藏 HUD 標籤與辨識框' : '顯示 HUD 標籤與辨識框'}
                title={showHud ? '隱藏 HUD 標籤與辨識框' : '顯示 HUD 標籤與辨識框'}
              >
                {showHud ? <Eye /> : <EyeOff />}
              </button>

              <button
                type="button"
                onClick={toggleFullscreen}
                className="btn ghost ico-only"
                aria-label={isFullscreen ? '退出全螢幕' : '全螢幕檢視'}
                title={isFullscreen ? '退出全螢幕' : '全螢幕檢視'}
              >
                {isFullscreen ? <Minimize2 /> : <Maximize2 />}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 底列。關掉 HUD 時一起收起來，讓畫面完全乾淨 */}
      {isStreamActive && showHud && (
        <div className="viewbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp2)' }}>
            <button type="button" onClick={onOpenCropModal} className="btn pri" title="從畫面截圖新增偵測目標">
              <Camera />
              截圖新增目標
            </button>

            {latestMatches.length > 0 && (
              <span className="tag ok">
                <Check />
                命中 {latestMatches.length} 個目標
              </span>
            )}
          </div>

          <button type="button" onClick={onStopCapture} className="btn ghost" title="停止擷取畫面">
            <X />
            結束擷取
          </button>
        </div>
      )}
    </div>
  );
};
