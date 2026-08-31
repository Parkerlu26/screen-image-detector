import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, X, Plus, Sparkles, RefreshCw, Trophy, Bell, ShieldAlert, Coins } from 'lucide-react';

interface SimulatedScreenModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUseAsSource?: (canvas: HTMLCanvasElement) => void;
}

interface SimItem {
  id: string;
  type: 'coin' | 'boss' | 'alert' | 'badge' | 'chat';
  text: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
  life?: number;
}

export const SimulatedScreenModal: React.FC<SimulatedScreenModalProps> = ({
  isOpen,
  onClose,
  onUseAsSource,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [items, setItems] = useState<SimItem[]>([
    { id: '1', type: 'coin', text: '🪙 金幣 (Coin)', x: 120, y: 150, vx: 2, vy: 1.5, color: '#F59E0B', size: 48 },
    { id: '2', type: 'boss', text: '⚔️ BOSS 出現', x: 400, y: 100, vx: -1.5, vy: 2, color: '#EF4444', size: 64 },
    { id: '3', type: 'alert', text: '⚠️ 低血量警告', x: 280, y: 280, vx: 0, vy: 0, color: '#DC2626', size: 40 },
  ]);

  const [counter, setCounter] = useState(0);

  // Animation Loop
  useEffect(() => {
    if (!isOpen) return;
    let animId: number;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const render = () => {
      if (isPlaying) {
        setCounter((c) => c + 1);

        // Update physics
        setItems((prevItems) =>
          prevItems.map((item) => {
            let nx = item.x + item.vx;
            let ny = item.y + item.vy;
            let nvx = item.vx;
            let nvy = item.vy;

            if (nx <= 20 || nx >= canvas.width - item.size - 20) nvx = -nvx;
            if (ny <= 20 || ny >= canvas.height - item.size - 20) nvy = -nvy;

            return {
              ...item,
              x: Math.max(20, Math.min(canvas.width - item.size - 20, nx)),
              y: Math.max(20, Math.min(canvas.height - item.size - 20, ny)),
              vx: nvx,
              vy: nvy,
            };
          })
        );
      }

      // Draw background gaming HUD interface
      ctx.fillStyle = '#0F172A';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw subtle grid
      ctx.strokeStyle = '#1E293B';
      ctx.lineWidth = 1;
      for (let x = 0; x < canvas.width; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }
      for (let y = 0; y < canvas.height; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }

      // Top Status Bar (Simulated Game UI)
      ctx.fillStyle = '#1E293B';
      ctx.fillRect(10, 10, canvas.width - 20, 50);
      ctx.strokeStyle = '#334155';
      ctx.strokeRect(10, 10, canvas.width - 20, 50);

      // Player Info
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 14px system-ui, sans-serif';
      ctx.fillText('🛡️ 玩家等級: Lv.99  |  戰力: 88,400', 25, 40);

      // Health bar
      ctx.fillStyle = '#334155';
      ctx.fillRect(canvas.width - 240, 22, 210, 24);
      ctx.fillStyle = '#EF4444';
      ctx.fillRect(canvas.width - 240, 22, 170, 24);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillText('HP: 85%', canvas.width - 150, 39);

      // Draw Dynamic Items
      items.forEach((item) => {
        ctx.save();
        ctx.shadowColor = item.color;
        ctx.shadowBlur = 15;

        // Container Box
        ctx.fillStyle = `${item.color}33`;
        ctx.strokeStyle = item.color;
        ctx.lineWidth = 2;
        
        const w = item.size * 2.2;
        const h = item.size;
        ctx.fillRect(item.x, item.y, w, h);
        ctx.strokeRect(item.x, item.y, w, h);

        // Icon + Text
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 13px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(item.text, item.x + w / 2, item.y + h / 2);

        ctx.restore();
      });

      // Bottom Message Log Box
      ctx.fillStyle = '#1E293B';
      ctx.fillRect(10, canvas.height - 70, canvas.width - 20, 60);
      ctx.strokeStyle = '#334155';
      ctx.strokeRect(10, canvas.height - 70, canvas.width - 20, 60);
      ctx.fillStyle = '#94A3B8';
      ctx.font = '12px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`[系統廣播] 模擬戰場運行中... 幀計數: ${counter}`, 25, canvas.height - 40);
      ctx.fillText(`提示：你可以點擊主畫面的「截圖新增目標」，選取下方的金幣或 BOSS 來進行即時偵測！`, 25, canvas.height - 20);

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [isOpen, isPlaying, items, counter]);

  const addItem = (type: SimItem['type'], text: string, color: string) => {
    const canvas = canvasRef.current;
    const w = canvas ? canvas.width : 800;
    const h = canvas ? canvas.height : 500;
    const newItem: SimItem = {
      id: `item_${Date.now()}`,
      type,
      text,
      x: Math.floor(Math.random() * (w - 200) + 50),
      y: Math.floor(Math.random() * (h - 200) + 70),
      vx: (Math.random() - 0.5) * 4 || 1.5,
      vy: (Math.random() - 0.5) * 4 || 1.5,
      color,
      size: type === 'boss' ? 56 : 42,
    };
    setItems((prev) => [...prev, newItem]);
  };

  const handleUseSource = () => {
    if (canvasRef.current && onUseAsSource) {
      onUseAsSource(canvasRef.current);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-5xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                內建模擬測試環境 (Simulated Test Screen)
              </h2>
              <p className="text-xs text-slate-400">
                可直接將此模擬畫布設為測試訊號來源，或使用「截圖工具」截取金幣 / BOSS 進行測試
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 flex flex-col items-center">
          <div className="relative max-w-full flex items-center justify-center bg-slate-950 rounded-xl border border-slate-800 overflow-hidden shadow-inner">
            <canvas
              ref={canvasRef}
              width={800}
              height={480}
              className="max-w-full max-h-[52vh] object-contain rounded"
            />
          </div>

          {/* Generator Controls */}
          <div className="flex flex-wrap items-center justify-between w-full mt-4 gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-slate-400 mr-1">生成測試物件:</span>
              <button
                type="button"
                onClick={() => addItem('coin', '🪙 金幣 (Coin)', '#F59E0B')}
                className="flex items-center gap-1 px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-lg text-xs font-medium transition-colors"
              >
                <Coins className="w-3.5 h-3.5" />
                + 金幣
              </button>
              <button
                type="button"
                onClick={() => addItem('boss', '⚔️ BOSS 出現', '#EF4444')}
                className="flex items-center gap-1 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-300 border border-red-500/30 rounded-lg text-xs font-medium transition-colors"
              >
                <Trophy className="w-3.5 h-3.5" />
                + BOSS 標記
              </button>
              <button
                type="button"
                onClick={() => addItem('alert', '⚠️ 低血量警告', '#DC2626')}
                className="flex items-center gap-1 px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded-lg text-xs font-medium transition-colors"
              >
                <ShieldAlert className="w-3.5 h-3.5" />
                + 警告標示
              </button>
              <button
                type="button"
                onClick={() => addItem('badge', '🎯 任務完成', '#10B981')}
                className="flex items-center gap-1 px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-lg text-xs font-medium transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                + 任務標誌
              </button>
              <button
                type="button"
                onClick={() => setItems([])}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 text-slate-400 hover:text-white rounded-lg text-xs transition-colors"
              >
                <RefreshCw className="w-3 h-3" />
                清空物件
              </button>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setIsPlaying(!isPlaying)}
                className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white transition-colors text-xs font-medium flex items-center gap-1.5 border border-slate-700"
              >
                {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                {isPlaying ? '暫停移動' : '繼續移動'}
              </button>
              {onUseAsSource && (
                <button
                  type="button"
                  onClick={handleUseSource}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white transition-colors text-xs font-bold shadow-lg shadow-indigo-900/30 flex items-center gap-1.5"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  將此畫布設為即時辨識訊號來源
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
