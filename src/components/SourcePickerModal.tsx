import React, { useState, useEffect } from 'react';
import { AppWindow, Monitor, RefreshCw, Search, X, Sparkles, CheckCircle2 } from 'lucide-react';

export interface DesktopSource {
  id: string;
  name: string;
  thumbnail: string; // Base64 image
  appIcon?: string | null;
  isScreen?: boolean;
}

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
      const electronAPI = (window as unknown as { electronAPI?: { getDesktopSources: () => Promise<DesktopSource[]> } }).electronAPI;
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <AppWindow className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                選擇要擷取監控的視窗或螢幕
              </h2>
              <p className="text-xs text-slate-400">
                點選下方任意應用程式視窗、遊戲畫面或顯示器開始即時偵測
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

        {/* Tab & Search Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 border-b border-slate-800/80 bg-slate-950/60">
          {/* Tabs */}
          <div className="flex items-center gap-1.5 bg-slate-900 p-1 rounded-xl border border-slate-800">
            <button
              type="button"
              onClick={() => setActiveTab('window')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'window'
                  ? 'bg-emerald-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <AppWindow className="w-3.5 h-3.5" />
              應用程式視窗
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('screen')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'screen'
                  ? 'bg-emerald-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Monitor className="w-3.5 h-3.5" />
              整個螢幕畫面
            </button>
          </div>

          {/* Search bar & Refresh */}
          <div className="flex items-center gap-2 flex-1 max-w-xs">
            <div className="relative w-full">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜尋視窗名稱..."
                className="w-full bg-slate-900 border border-slate-700/80 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <button
              type="button"
              onClick={fetchSources}
              disabled={isLoading}
              className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700/80 transition-colors disabled:opacity-50"
              title="重新整理視窗清單"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-emerald-400' : ''}`} />
            </button>
          </div>
        </div>

        {/* Source Cards Grid */}
        <div className="flex-1 p-6 overflow-y-auto min-h-[360px]">
          {filteredSources.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-14 h-14 rounded-2xl bg-slate-800/80 border border-slate-700 flex items-center justify-center text-slate-500 mb-3">
                <AppWindow className="w-7 h-7" />
              </div>
              <p className="text-sm font-semibold text-slate-300 mb-1">
                {isLoading ? '正在讀取開啟中的視窗...' : '未找到符合的視窗'}
              </p>
              <p className="text-xs text-slate-500 max-w-sm mb-4">
                請確認您要監控的遊戲或應用程式視窗已開啟且未最小化，然後點擊重新整理。
              </p>
              <button
                type="button"
                onClick={fetchSources}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold border border-slate-700 transition-colors flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                重新整理視窗
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {filteredSources.map((source) => (
                <div
                  key={source.id}
                  onClick={() => onSelectSource(source)}
                  className="group relative bg-slate-950 border border-slate-800 hover:border-emerald-500 rounded-xl p-3 cursor-pointer transition-all duration-200 hover:shadow-xl hover:shadow-emerald-950/30 flex flex-col gap-2.5 overflow-hidden"
                >
                  {/* Thumbnail Preview */}
                  <div className="relative w-full aspect-video bg-slate-900 rounded-lg overflow-hidden border border-slate-800/80 flex items-center justify-center group-hover:border-emerald-500/50 transition-colors">
                    {source.thumbnail ? (
                      <img
                        src={source.thumbnail}
                        alt={source.name}
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <AppWindow className="w-8 h-8 text-slate-600" />
                    )}

                    {/* Hover Glow Mask */}
                    <div className="absolute inset-0 bg-emerald-500/10 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <span className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold shadow-lg flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        選擇此視窗
                      </span>
                    </div>
                  </div>

                  {/* Window Title & Icon */}
                  <div className="flex items-center gap-2 min-w-0">
                    {source.appIcon ? (
                      <img
                        src={source.appIcon}
                        alt=""
                        className="w-4 h-4 rounded shrink-0"
                      />
                    ) : (
                      <AppWindow className="w-4 h-4 text-emerald-400 shrink-0" />
                    )}
                    <span className="text-xs font-bold text-slate-200 group-hover:text-white truncate">
                      {source.name || '未命名視窗'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-slate-800 bg-slate-950 flex items-center justify-between text-xs text-slate-400">
          <span>共找到 {filteredSources.length} 個可擷取目標</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-medium transition-colors"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
};
