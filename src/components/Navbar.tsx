import React, { useRef } from 'react';
import {
  Video,
  VideoOff,
  Pause,
  Play,
  Download,
  Upload,
  Settings2,
  Volume2,
  VolumeX,
  Users,
  LogOut,
  Shield,
  User,
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

/**
 * 暫停中的按鈕。components.css 沒有「填滿琥珀色」這種變體，而深色字壓在 --warn 上
 * 淺色模式會讀不出來（淺色的 --warn 是 #7d5606），所以走 .tag.warn 那套描邊＋淡底。
 */
const PAUSED_TINT: React.CSSProperties = {
  color: 'var(--warn)',
  borderColor: 'rgba(242,201,76,.35)',
  background: 'rgba(242,201,76,.12)',
};

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
    <header className="nav">
      {/* 第一欄故意留空：名字已經在標題列置中，分段控制才是這一列的主角 */}
      <div
        className="seg nav-tabs"
        role="tablist"
        style={{ '--n': 2, '--i': activeTab === 'detect' ? 0 : 1 } as React.CSSProperties}
      >
        <div className="seg-thumb" />
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'detect'}
          onClick={() => onChangeTab('detect')}
        >
          <span className="emo">🎯</span>
          即時圖像辨識
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'automation'}
          onClick={() => onChangeTab('automation')}
        >
          <span className="emo">⚡</span>
          進階聯動 ＆ 計時器
        </button>
      </div>

      <div className="tools">
        {/* 擷取控制：沒開串流時只有一顆主要動作，開了之後換成暫停＋停止 */}
        {isStreamActive ? (
          <>
            <button
              type="button"
              onClick={onTogglePause}
              className={`btn ico-only${isPaused ? ' animate-pulse' : ''}`}
              style={isPaused ? PAUSED_TINT : undefined}
              aria-label={isPaused ? '繼續偵測' : '暫停偵測'}
              title={isPaused ? '點擊繼續偵測' : '點擊暫停偵測'}
            >
              {isPaused ? <Play /> : <Pause />}
            </button>

            <button
              type="button"
              onClick={onStopCapture}
              className="btn danger ico-only"
              aria-label="停止擷取"
              title="停止擷取畫面"
            >
              <VideoOff />
            </button>
          </>
        ) : (
          <button type="button" onClick={onStartCapture} className="btn pri" title="選擇要監看的視窗或螢幕">
            <Video />
            開始擷取視窗
          </button>
        )}

        <span className="navsep" />

        {/* 靜音快速切換 */}
        <button
          type="button"
          onClick={() => onUpdateSettings({ ...settings, enableAudio: !settings.enableAudio })}
          className="btn ghost ico-only"
          style={settings.enableAudio ? undefined : { color: 'var(--bad)' }}
          aria-label={settings.enableAudio ? '提示音效已開啟 (點擊靜音)' : '已靜音 (點擊開啟音效)'}
          title={settings.enableAudio ? '提示音效已開啟 (點擊靜音)' : '已靜音 (點擊開啟音效)'}
        >
          {settings.enableAudio ? <Volume2 /> : <VolumeX />}
        </button>

        {/* 匯入／匯出設定檔。n3＝頂列擠不下時最先讓位的一組 */}
        <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".json" className="hide" />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="btn ghost ico-only n3"
          aria-label="匯入目標設定檔 (JSON)"
          title="匯入目標設定檔 (JSON)"
        >
          <Upload />
        </button>
        <button
          type="button"
          onClick={onExportConfig}
          className="btn ghost ico-only n3"
          aria-label="匯出備份目前設定 (JSON)"
          title="匯出備份目前設定 (JSON)"
        >
          <Download />
        </button>

        {/* 使用者管理（僅管理員）。待審筆數改由角落的點表示 */}
        {currentUser && currentUser.role === 'admin' && onOpenUserManagement && (
          <button
            type="button"
            onClick={onOpenUserManagement}
            className="btn ghost ico-only"
            style={{ position: 'relative' }}
            aria-label={`使用者管理${pendingUsersCount > 0 ? `（${pendingUsersCount} 筆待處理）` : ''}`}
            title={`開啟使用者審核管理後台${pendingUsersCount > 0 ? `（${pendingUsersCount} 筆待處理）` : ''}`}
          >
            <Users />
            {pendingUsersCount > 0 && <span className="dotbadge" />}
          </button>
        )}

        <button
          type="button"
          onClick={onOpenSettings}
          className="btn ghost ico-only"
          aria-label="全域設定"
          title="全域設定"
        >
          <Settings2 />
        </button>

        {currentUser && (
          <>
            <span className="navsep" />
            <div className="who" title={currentUser.role === 'admin' ? '目前登入：管理員' : '目前登入的帳號'}>
              {currentUser.role === 'admin' ? (
                <Shield style={{ color: 'var(--acc-txt)' }} />
              ) : (
                <User />
              )}
              <b>{currentUser.displayName || currentUser.username}</b>
            </div>

            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                className="btn ghost ico-only"
                aria-label="登出帳號"
                title="登出帳號"
              >
                <LogOut />
              </button>
            )}
          </>
        )}
      </div>
    </header>
  );
};
