import React from 'react';
import { GlobalSettings } from '../types';
import { Settings, X, Bell, Eye, Zap, Volume2, Sparkles, Mic, Download } from 'lucide-react';
import { speakAlert } from '../utils/audio';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: GlobalSettings;
  onUpdateSettings: (newSettings: GlobalSettings) => void;
  onRequestBrowserNotification: () => void;
  notificationPermission: NotificationPermission | 'unsupported';
  /** 打開「軟體更新」對話框。開機時也會自動檢查一次，這裡是手動的入口。 */
  onCheckForUpdate?: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
  onRequestBrowserNotification,
  notificationPermission,
  onCheckForUpdate,
}) => {
  if (!isOpen) return null;

  const handleChange = <K extends keyof GlobalSettings>(key: K, value: GlobalSettings[K]) => {
    onUpdateSettings({
      ...settings,
      [key]: value,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">全域設定 (Global Settings)</h2>
              <p className="text-xs text-slate-400">自訂辨識效能、提示反饋與畫面覆蓋層顯示</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <div className="p-6 space-y-5">
          {/* Section 1: Performance & FPS */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-400" />
              辨識效能與掃描頻率
            </h3>
            
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-xs font-medium text-slate-300">
                    偵測掃描頻率 (Scan FPS): <strong className="text-amber-400 font-mono text-sm">{settings.scanFps >= 60 ? '60 FPS (極致高刷)' : `${settings.scanFps} FPS`}</strong>
                  </label>
                  <div className="flex items-center gap-1">
                    {[15, 30, 60].map((fpsVal) => (
                      <button
                        key={fpsVal}
                        type="button"
                        onClick={() => handleChange('scanFps', fpsVal)}
                        className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${
                          settings.scanFps === fpsVal
                            ? 'bg-amber-500 text-slate-950 shadow-sm'
                            : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-700'
                        }`}
                      >
                        {fpsVal} FPS
                      </button>
                    ))}
                  </div>
                </div>
                <input
                  type="range"
                  min="5"
                  max="60"
                  step="5"
                  value={settings.scanFps}
                  onChange={(e) => handleChange('scanFps', Number(e.target.value))}
                  className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                />
                <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                  <span>5 FPS (省電)</span>
                  <span>30 FPS (流暢)</span>
                  <span>60 FPS (極致電競 & 毫秒級低延遲)</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  比對演算法模式
                </label>
                <select
                  value={settings.matchAlgorithm}
                  onChange={(e) => handleChange('matchAlgorithm', e.target.value as 'ncc' | 'fast_color')}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                >
                  <option value="ncc">🌟 歸一化互相關 (NCC/ZNCC) - 抗亮度變化的精準比對 (推薦)</option>
                  <option value="fast_color">⚡ 快速色彩差值 (Color SAD) - 顏色敏感型圖示極速比對</option>
                </select>
              </div>
            </div>
          </div>

          {/* Section 2: Visual Overlays */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <Eye className="w-4 h-4 text-emerald-400" />
              畫面視覺標籤與特效
            </h3>

            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2.5">
              <label className="flex items-center justify-between cursor-pointer text-xs text-slate-300">
                <span>在即時預覽畫面上繪製「辨識成功框」</span>
                <input
                  type="checkbox"
                  checked={settings.showBoundingBoxesOnStream}
                  onChange={(e) => handleChange('showBoundingBoxesOnStream', e.target.checked)}
                  className="w-4 h-4 rounded bg-slate-900 border-slate-700 text-emerald-600 focus:ring-0"
                />
              </label>

              <label className="flex items-center justify-between cursor-pointer text-xs text-slate-300">
                <span>在畫面上顯示目標的「自選偵測區域 (ROI)」虛線框</span>
                <input
                  type="checkbox"
                  checked={settings.showRoiOnStream}
                  onChange={(e) => handleChange('showRoiOnStream', e.target.checked)}
                  className="w-4 h-4 rounded bg-slate-900 border-slate-700 text-emerald-600 focus:ring-0"
                />
              </label>

              <label className="flex items-center justify-between cursor-pointer text-xs text-slate-300">
                <span>辨識命中時畫面向外閃爍光暈 (Screen Flash)</span>
                <input
                  type="checkbox"
                  checked={settings.flashScreenOnHit}
                  onChange={(e) => handleChange('flashScreenOnHit', e.target.checked)}
                  className="w-4 h-4 rounded bg-slate-900 border-slate-700 text-emerald-600 focus:ring-0"
                />
              </label>

              <label className="flex items-center justify-between cursor-pointer text-xs text-slate-300">
                <span>辨識命中時施放慶祝彩帶特效</span>
                <input
                  type="checkbox"
                  checked={settings.confettiOnHit}
                  onChange={(e) => handleChange('confettiOnHit', e.target.checked)}
                  className="w-4 h-4 rounded bg-slate-900 border-slate-700 text-emerald-600 focus:ring-0"
                />
              </label>
            </div>
          </div>

          {/* Section 3: Audio & Notifications */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <Volume2 className="w-4 h-4 text-cyan-400" />
              聲音與瀏覽器系統通知
            </h3>

            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-xs font-medium text-slate-300">
                    提示音效音量 (Sound Volume): {Math.round(settings.masterVolume * 100)}%
                  </label>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={settings.masterVolume}
                  onChange={(e) => handleChange('masterVolume', Number(e.target.value))}
                  className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                />
              </div>

              {/* Speech Voice Volume Slider */}
              <div className="pt-2 border-t border-slate-800">
                <div className="flex justify-between items-center mb-1">
                  <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                    <Mic className="w-3.5 h-3.5 text-amber-400" />
                    語音朗讀音量 (Voice Volume): {Math.round((settings.speechVolume ?? 1.0) * 100)}%
                  </label>
                  <button
                    type="button"
                    onClick={() => speakAlert('語音音量測試', settings.speechVolume ?? 1.0)}
                    className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-amber-300 text-[10px] font-bold border border-slate-700 transition-colors"
                  >
                    🔊 試聽語音
                  </button>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={settings.speechVolume ?? 1.0}
                  onChange={(e) => handleChange('speechVolume', Number(e.target.value))}
                  className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                />
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-800">
                <div>
                  <span className="text-xs text-slate-300 font-medium block">瀏覽器桌面推播通知</span>
                  <span className="text-[11px] text-slate-400">
                    狀態: {notificationPermission === 'granted' ? '✅ 已授權' : notificationPermission === 'denied' ? '❌ 已拒絕' : '⚠️ 未設定'}
                  </span>
                </div>
                {notificationPermission !== 'granted' && (
                  <button
                    type="button"
                    onClick={onRequestBrowserNotification}
                    className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-medium transition-colors flex items-center gap-1"
                  >
                    <Bell className="w-3.5 h-3.5" />
                    請求授權
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* 軟體更新 */}
          {onCheckForUpdate && (
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                <Download className="w-3.5 h-3.5" />
                軟體更新
              </h3>
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-white font-medium">檢查是否有新版本</p>
                  <p className="text-xs text-slate-500">
                    每次啟動會自動檢查一次，有新版可以直接一鍵下載更新。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onCheckForUpdate}
                  className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-medium transition-colors flex items-center gap-1 shrink-0"
                >
                  <Download className="w-3.5 h-3.5" />
                  檢查更新
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-950 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white transition-colors text-xs font-bold"
          >
            關閉設定
          </button>
        </div>
      </div>
    </div>
  );
};
