/**
 * 內建模擬測試環境。
 *
 * 一張 800×480 的畫布，自己畫一套假的遊戲 HUD 與幾個會彈跳的標記，
 * 讓使用者不用真的開遊戲也能截圖、建目標、試偵測。
 *
 * 外殼走 components.css 的元件名（.modal／.btn／.hint），
 * 但**畫布裡面的顏色一律寫死**：那是「被偵測的畫面」的顏色，
 * 不是這個軟體的介面顏色，跟著主題翻反而會讓偵測結果不可重現。
 * 同理，畫布外框也固定深色，才看得出畫布的邊界在哪。
 */
import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, X, Plus, Sparkles, RefreshCw, Trophy, ShieldAlert, Coins } from 'lucide-react';

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
    <div className="scrim">
      <div
        className="modal"
        style={{ '--mw': '1024px' } as React.CSSProperties}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sim-title"
      >
        <header>
          <div className="mtile">
            <Sparkles />
          </div>
          <div className="htxt">
            <div className="ttl">
              <h3 id="sim-title">內建模擬測試環境 (Simulated Test Screen)</h3>
            </div>
            <p>可直接將此模擬畫布設為測試訊號來源，或使用「截圖工具」截取金幣 / BOSS 進行測試</p>
          </div>

          <div className="hact">
            <button
              type="button"
              className="btn ghost ico-only"
              onClick={onClose}
              title="關閉模擬測試環境"
              aria-label="關閉模擬測試環境"
            >
              <X />
            </button>
          </div>
        </header>

        {/* 畫布高度會被 max-h 夾住，格線列不能拉伸，所以 alignContent 要 start */}
        <div className="body" style={{ alignContent: 'start' }}>
          {/* 外框固定深色（不吃主題）並且只包住畫布本身：使用者要截的就是這塊，
              框比畫布寬會讓人以為旁邊的深色也算在來源裡面。 */}
          <div
            style={{
              display: 'grid',
              placeItems: 'center',
              justifySelf: 'center',
              background: '#0a0e12',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r3)',
              overflow: 'hidden',
            }}
          >
            <canvas
              ref={canvasRef}
              width={800}
              height={480}
              style={{ maxWidth: '100%', maxHeight: '52vh', objectFit: 'contain', display: 'block' }}
            />
          </div>

          {/* 生成器：顏色用 --ok/--warn/--bad 三個語意代幣，深淺主題各有一組合格對比。
              這一列不要用 .flow：那個類是給規則敘述用的，會把圖示縮成 12px。 */}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--sp2)' }}>
            <span className="hint" style={{ margin: 0 }}>
              生成測試物件:
            </span>
            <button
              type="button"
              className="btn"
              style={{ color: 'var(--warn)' }}
              onClick={() => addItem('coin', '🪙 金幣 (Coin)', '#F59E0B')}
            >
              <Coins />+ 金幣
            </button>
            <button
              type="button"
              className="btn"
              style={{ color: 'var(--bad)' }}
              onClick={() => addItem('boss', '⚔️ BOSS 出現', '#EF4444')}
            >
              <Trophy />+ BOSS 標記
            </button>
            <button
              type="button"
              className="btn"
              style={{ color: 'var(--bad)' }}
              onClick={() => addItem('alert', '⚠️ 低血量警告', '#DC2626')}
            >
              <ShieldAlert />+ 警告標示
            </button>
            <button
              type="button"
              className="btn"
              style={{ color: 'var(--ok)' }}
              onClick={() => addItem('badge', '🎯 任務完成', '#10B981')}
            >
              <Plus />+ 任務標誌
            </button>
            <button type="button" className="btn ghost" onClick={() => setItems([])}>
              <RefreshCw />
              清空物件
            </button>
          </div>
        </div>

        <footer>
          <button type="button" className="btn" onClick={() => setIsPlaying(!isPlaying)}>
            {isPlaying ? <Pause /> : <Play />}
            {isPlaying ? '暫停移動' : '繼續移動'}
          </button>
          {onUseAsSource && (
            <button type="button" className="btn pri" onClick={handleUseSource}>
              <Sparkles />
              將此畫布設為即時辨識訊號來源
            </button>
          )}
        </footer>
      </div>
    </div>
  );
};
