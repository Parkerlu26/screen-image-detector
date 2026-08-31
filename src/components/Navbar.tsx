import React, { useRef } from 'react';
import {
  Video,
  VideoOff,
  Pause,
  Play,
  Download,
  Upload,
  Settings as SettingsIcon,
  Volume2,
  VolumeX,
  Crosshair,
  Users,
  LogOut,
  Shield,
  User,
  Sparkles,
  Layers,
} from 'lucide-react';
import { GlobalSettings, UserAccount } from '../types';

interface NavbarProps {
  isStreamActive: boolean;
  isPaused: boolean;
  onStartCapture: () => void;
  onStopCapture: () => void;
  onTogglePause: () => void;
  onExportConfig: () => void;
  onImportConfig: (file: File) => void;
  onOpenSettings: () => void;
  settings: GlobalSettings;
  onUpdateSettings: (settings: GlobalSettings) => void;
  currentUser: UserAccount | null;
  pendingUsersCount?: number;
  onOpenUserManagement?: () => void;
  onLogout?: () => void;
  activeTab: 'detect' | 'automation';
  onChangeTab: (tab: 'detect' | 'automation') => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  isStreamActive,
  isPaused,
  onStartCapture,
  onStopCapture,
  onTogglePause,
  onExportConfig,
  onImportConfig,
  onOpenSettings,
  settings,
  onUpdateSettings,
  currentUser,
  pendingUsersCount = 0,
  onOpenUserManagement,
  onLogout,
  activeTab,
  onChangeTab,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onImportConfig(file);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <header className="bg-slate-950 border-b border-slate-800 px-4 lg:px-6 py-3 sticky top-0 z-40 shadow-xl shrink-0">
      <div className="w-full mx-auto flex flex-wrap items-center justify-between gap-3">
        {/* Brand & Title */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-600 flex items-center justify-center text-white shadow-lg shadow-emerald-950/50">
            <Crosshair className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-white tracking-tight">
                六月幫你顧
              </h1>
            </div>
            <p className="text-[11px] text-slate-400 hidden sm:block">
              視窗螢幕即時圖像偵測與自動提醒系統
            </p>
          </div>
        </div>

        {/* Center Navigation Tabs */}
        <div className="flex items-center gap-1 bg-slate-900/90 p-1 rounded-xl border border-slate-800 text-xs font-bold">
          <button
            type="button"
            onClick={() => onChangeTab('detect')}
            className={`px-3.5 py-1.5 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'detect'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Crosshair className="w-3.5 h-3.5" />
            🎯 即時圖像辨識
          </button>
          <button
            type="button"
            onClick={() => onChangeTab('automation')}
            className={`px-3.5 py-1.5 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'automation'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            ⚡ 進階聯動 ＆ 計時器
          </button>
        </div>

        {/* Right Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Stream Capture Controls */}
          {isStreamActive ? (
            <>
              {/* Pause / Resume Button */}
              <button
                type="button"
                onClick={onTogglePause}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all shadow-md cursor-pointer ${
                  isPaused
                    ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-amber-950/40 animate-pulse'
                    : 'bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700'
                }`}
                title={isPaused ? '點擊繼續偵測' : '點擊暫停偵測'}
              >
                {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                {isPaused ? '繼續' : '暫停'}
              </button>

              <button
                type="button"
                onClick={onStopCapture}
                className="flex items-center gap-1.5 px-3.5 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-rose-950/40 cursor-pointer"
              >
                <VideoOff className="w-3.5 h-3.5" />
                停止擷取
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onStartCapture}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-emerald-950/50 cursor-pointer"
            >
              <Video className="w-3.5 h-3.5" />
              開始擷取視窗
            </button>
          )}

          {/* Quick Sound Mute Toggle */}
          <button
            type="button"
            onClick={() => onUpdateSettings({ ...settings, enableAudio: !settings.enableAudio })}
            className={`p-2 rounded-xl border transition-all cursor-pointer ${
              settings.enableAudio
                ? 'bg-slate-800 text-emerald-400 border-slate-700 hover:bg-slate-700'
                : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
            }`}
            title={settings.enableAudio ? '提示音效已開啟 (點擊靜音)' : '已靜音 (點擊開啟音效)'}
          >
            {settings.enableAudio ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>

          {/* Import / Export JSON */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept=".json"
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl border border-slate-700 transition-colors cursor-pointer"
            title="匯入目標設定檔 (JSON)"
          >
            <Upload className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={onExportConfig}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl border border-slate-700 transition-colors cursor-pointer"
            title="匯出備份目前設定 (JSON)"
          >
            <Download className="w-4 h-4" />
          </button>

          {/* User Management Button (For Admin) */}
          {currentUser && currentUser.role === 'admin' && onOpenUserManagement && (
            <button
              type="button"
              onClick={onOpenUserManagement}
              className="relative flex items-center gap-1 px-3 py-1.5 rounded-xl bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-200 border border-indigo-500/40 text-xs font-bold transition-all cursor-pointer"
              title="開啟使用者審核管理後台"
            >
              <Users className="w-3.5 h-3.5 text-indigo-400" />
              <span>使用者管理</span>
              {pendingUsersCount > 0 && (
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              )}
            </button>
          )}

          {/* Settings Modal Toggle */}
          <button
            type="button"
            onClick={onOpenSettings}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl border border-slate-700 transition-colors cursor-pointer"
            title="全域設定"
          >
            <SettingsIcon className="w-4 h-4" />
          </button>

          {/* Current User Pill & Logout */}
          {currentUser && (
            <div className="flex items-center gap-1.5 pl-1.5 border-l border-slate-800">
              <div className="flex items-center gap-1 bg-slate-900 px-2 py-1 rounded-lg border border-slate-800 text-[11px] text-slate-300">
                {currentUser.role === 'admin' ? (
                  <Shield className="w-3 h-3 text-indigo-400" />
                ) : (
                  <User className="w-3 h-3 text-slate-400" />
                )}
                <span className="font-bold text-white max-w-[80px] truncate">
                  {currentUser.displayName || currentUser.username}
                </span>
              </div>

              {onLogout && (
                <button
                  type="button"
                  onClick={onLogout}
                  className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                  title="登出帳號"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
