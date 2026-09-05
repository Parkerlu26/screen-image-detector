/**
 * 畫面來源選擇器。
 *
 * 兩個頁籤（應用程式視窗／整個螢幕畫面）＋搜尋，一張卡就是一個可擷取目標，
 * 滑過去縮圖上會浮出「選擇此視窗」。
 *
 * 外觀走 components.css 的元件名（.modal／.seg／.search／.srcgrid／.srccard／.empty），
 * 這一份不再出現任何 slate／emerald 顏色 class：深淺與強調色由使用者在設定裡選。
 */
import React, { useState, useEffect } from 'react';
import { AppWindow, CheckCircle2, Monitor, RefreshCw, Search, X } from 'lucide-react';
import type { DesktopSource } from '../electron-api';

// DesktopSource 的定義搬到 src/electron-api.d.ts 了：它本來就是 get-desktop-sources
// 的回傳形狀，放在一個對話框裡等於讓橋的形狀有兩份描述。名字繼續從這裡往外送，
// 原本從這個檔案匯入它的地方不用改。
export type { DesktopSource };

interface SourcePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectSource: (source: DesktopSource) => void;
}

export const SourcePickerModal: React.FC<SourcePickerModalProps> = ({
  isOpen,
  onClose,
  onSelectSource,
}) => {
  const [sources, setSources] = useState<DesktopSource[]>([]);
  const [activeTab, setActiveTab] = useState<'window' | 'screen'>('window');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const fetchSources = async () => {
    setIsLoading(true);
    try {
      const electronAPI = window.electronAPI;
      if (electronAPI && typeof electronAPI.getDesktopSources === 'function') {
        const list = await electronAPI.getDesktopSources();
        setSources(list || []);
      }
    } catch (err) {
      console.error('Failed to get desktop sources:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchSources();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const filteredSources = sources.filter((s) => {
    const isScreenSource = s.isScreen || s.id.startsWith('screen:') || s.name.toLowerCase().includes('screen') || s.name.toLowerCase().includes('螢幕') || s.name.toLowerCase().includes('entire');
    const matchesTab = activeTab === 'screen' ? isScreenSource : !isScreenSource;
    const matchesSearch = s.name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesTab && matchesSearch;
  });

  return (
    <div className="scrim">
      <div
        className="modal"
        style={{ '--mw': '900px' } as React.CSSProperties}
        role="dialog"
        aria-modal="true"
        aria-labelledby="src-title"
      >
        <header>
          <div className="mtile">
            <AppWindow />
          </div>
          <div className="htxt">
            <div className="ttl">
              <h3 id="src-title">選擇要擷取監控的視窗或螢幕</h3>
            </div>
            <p>點選下方任意應用程式視窗、遊戲畫面或顯示器開始即時偵測</p>
          </div>

          <div className="hact">
            {/* 兩個頁籤跟頂列同一顆滑塊 */}
            <div
              className="seg"
              role="tablist"
              style={{ '--n': 2, '--i': activeTab === 'window' ? 0 : 1 } as React.CSSProperties}
            >
              <div className="seg-thumb" />
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'window'}
                onClick={() => setActiveTab('window')}
              >
                <AppWindow />
                應用程式視窗
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'screen'}
                onClick={() => setActiveTab('screen')}
              >
                <Monitor />
                整個螢幕畫面
              </button>
            </div>

            <button
              type="button"
              className="btn ghost ico-only"
              onClick={fetchSources}
              disabled={isLoading}
              title="重新整理視窗清單"
              aria-label="重新整理視窗清單"
            >
              <RefreshCw className={isLoading ? 'animate-spin' : undefined} />
            </button>

            <button
              type="button"
              className="btn ghost ico-only"
              onClick={onClose}
              title="關閉來源選擇"
              aria-label="關閉來源選擇"
            >
              <X />
            </button>
          </div>
        </header>

        {/* 卡片數量會變，所以 alignContent 要 start，不然只有一排卡時格線會被拉開 */}
        <div className="body" style={{ alignContent: 'start', minHeight: '360px' }}>
          <div className="search" style={{ maxWidth: '280px' }}>
            <Search />
            <input
              type="text"
              className="field"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜尋視窗名稱..."
            />
          </div>

          {filteredSources.length === 0 ? (
            <div className="empty big">
              <AppWindow />
              <p style={{ color: 'var(--txt)', fontWeight: 600 }}>
                {isLoading ? '正在讀取開啟中的視窗...' : '未找到符合的視窗'}
              </p>
              <p>請確認您要監控的遊戲或應用程式視窗已開啟且未最小化，然後點擊重新整理。</p>
              <button type="button" className="btn" onClick={fetchSources}>
                <RefreshCw />
                重新整理視窗
              </button>
            </div>
          ) : (
            <div className="srcgrid">
              {filteredSources.map((source) => (
                <button
                  key={source.id}
                  type="button"
                  className="srccard"
                  onClick={() => onSelectSource(source)}
                >
                  <div className="shot">
                    {source.thumbnail ? (
                      <img src={source.thumbnail} alt={source.name} />
                    ) : (
                      <AppWindow />
                    )}
                    {/* 滑過去才浮出來的遮罩，告訴使用者這張卡是可以按的 */}
                    <div className="ov">
                      <CheckCircle2 />
                      選擇此視窗
                    </div>
                  </div>

                  <div className="nm">
                    {source.appIcon ? <img src={source.appIcon} alt="" /> : <AppWindow />}
                    <span>{source.name || '未命名視窗'}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <footer>
          <span className="hint" style={{ margin: 0, marginRight: 'auto' }}>
            共找到 {filteredSources.length} 個可擷取目標
          </span>
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
        </footer>
      </div>
    </div>
  );
};
