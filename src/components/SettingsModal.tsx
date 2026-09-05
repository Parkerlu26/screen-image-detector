import React from 'react';
import { GlobalSettings } from '../types';
import {
  Activity,
  AlertTriangle,
  Bell,
  CheckCircle2,
  Crosshair,
  Download,
  Eye,
  Mic,
  Monitor,
  SlidersHorizontal,
  Sparkles,
  Target,
  Volume2,
  X,
  XCircle,
  Zap,
} from 'lucide-react';
import { speakAlert } from '../utils/audio';
import { ACCENT_OPTIONS, THEME_OPTIONS } from '../utils/appearance';

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

/** 桌面通知授權狀態 → 藥丸的顏色與文字。'unsupported' 也要有自己一格，
    否則不支援通知的環境會顯示「未設定」，旁邊還配一顆按了不會有反應的授權鈕。 */
const PERMISSION_TAG: Record<
  NotificationPermission | 'unsupported',
  { cls: string; text: string; icon: React.ReactNode }
> = {
  granted: { cls: 'tag ok', text: '已授權', icon: <CheckCircle2 /> },
  denied: { cls: 'tag bad', text: '已拒絕', icon: <XCircle /> },
  default: { cls: 'tag warn', text: '未設定', icon: <AlertTriangle /> },
  unsupported: { cls: 'tag bad', text: '不支援', icon: <XCircle /> },
};

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

  // 語音音量沒設定過時視為 100%：滑桿的位置、讀數與試聽用的音量必須吃同一個值，
  // 不能一邊 ?? 1.0 一邊讀原始的 undefined。
  const speechVolume = settings.speechVolume ?? 1.0;
  const perm = PERMISSION_TAG[notificationPermission] ?? PERMISSION_TAG.default;

  return (
    <div className="scrim">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header>
          <div className="htxt">
            <h3 id="settings-title">全域設定</h3>
            <p>自訂外觀、辨識效能、提示反饋與畫面覆蓋層顯示</p>
          </div>
          <div className="hact">
            <button
              type="button"
              className="btn ghost ico-only"
              onClick={onClose}
              aria-label="關閉設定"
              title="關閉設定"
            >
              <X />
            </button>
          </div>
        </header>

        <div className="body">
          {/* 外觀：唯一被點名要能在 app 裡隨時改的外觀設定。
              其餘四項（圓角、密度、材質、圖示）已經定案寫死在 src/styles/tokens.css，
              不做成選項——選項越多越容易被調成不好看的組合。 */}
          <div>
            <h4 className="sect" style={{ marginBottom: 6 }}>
              <Monitor />
              外觀
            </h4>
            <div className="list">
              <div className="row">
                <span className="lab">
                  <Monitor />
                  主題深淺
                </span>
                <div style={{ flex: 1 }} />
                <div className="opts" role="group" aria-label="主題深淺">
                  {THEME_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      aria-pressed={settings.theme === option.id}
                      onClick={() => handleChange('theme', option.id)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="row">
                <span className="lab">
                  <Sparkles />
                  顏色
                </span>
                <div style={{ flex: 1 }} />
                <div className="opts" role="group" aria-label="顏色">
                  {ACCENT_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      aria-pressed={settings.accent === option.id}
                      onClick={() => handleChange('accent', option.id)}
                    >
                      <i className="swatch" style={{ background: option.swatch }} />
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <p className="hint">改了立刻生效，會記在設定檔裡，下次開啟沿用。</p>
          </div>

          {/* 辨識效能與掃描頻率 */}
          <div>
            <h4 className="sect" style={{ marginBottom: 6 }}>
              <Zap />
              辨識效能與掃描頻率
            </h4>
            <div className="list">
              <div className="row stack">
                <div className="head">
                  <span className="lab">
                    <Activity />
                    偵測掃描頻率
                  </span>
                  <span className="val num">
                    <b>{settings.scanFps >= 60 ? '60 FPS (極致高刷)' : `${settings.scanFps} FPS`}</b>
                  </span>
                </div>
                <div className="opts" style={{ justifyContent: 'flex-end' }}>
                  {[15, 30, 60].map((fpsVal) => (
                    <button
                      key={fpsVal}
                      type="button"
                      aria-pressed={settings.scanFps === fpsVal}
                      onClick={() => handleChange('scanFps', fpsVal)}
                    >
                      {fpsVal} FPS
                    </button>
                  ))}
                </div>
                <input
                  type="range"
                  min="5"
                  max="60"
                  step="5"
                  value={settings.scanFps}
                  onChange={(e) => handleChange('scanFps', Number(e.target.value))}
                  aria-label="偵測掃描頻率"
                  style={{ '--p': `${((settings.scanFps - 5) / 55) * 100}%` } as React.CSSProperties}
                />
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 6,
                    fontSize: 10,
                    color: 'var(--dim2)',
                  }}
                >
                  <span>5 FPS (省電)</span>
                  <span>30 FPS (流暢)</span>
                  <span>60 FPS (極致電競 &amp; 毫秒級低延遲)</span>
                </div>
              </div>

              <div className="row stack">
                <div className="head">
                  <span className="lab">
                    <SlidersHorizontal />
                    比對演算法模式
                  </span>
                </div>
                <select
                  className="field"
                  value={settings.matchAlgorithm}
                  onChange={(e) =>
                    handleChange('matchAlgorithm', e.target.value as 'ncc' | 'fast_color')
                  }
                  aria-label="比對演算法模式"
                >
                  <option value="ncc">歸一化互相關 (NCC/ZNCC) － 抗亮度變化的精準比對（推薦）</option>
                  <option value="fast_color">快速色彩差值 (Color SAD) － 顏色敏感型圖示極速比對</option>
                </select>
              </div>
            </div>
          </div>

          {/* 畫面視覺標籤與特效：四個開關。旋鈕位置本身就是狀態，
              所以列上只留敘述，不再寫「開／關」。 */}
          <div>
            <h4 className="sect" style={{ marginBottom: 6 }}>
              <Eye />
              畫面視覺標籤與特效
            </h4>
            <div className="list">
              <div className="row">
                <span className="lab">
                  <Target />
                  在即時預覽畫面上繪製「辨識成功框」
                </span>
                <div style={{ flex: 1 }} />
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings.showBoundingBoxesOnStream}
                  aria-label="在即時預覽畫面上繪製辨識成功框"
                  className="sw sm"
                  onClick={() =>
                    handleChange('showBoundingBoxesOnStream', !settings.showBoundingBoxesOnStream)
                  }
                >
                  <i />
                </button>
              </div>

              <div className="row">
                <span className="lab">
                  <Crosshair />
                  顯示「自選偵測區域 (ROI)」虛線框
                </span>
                <div style={{ flex: 1 }} />
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings.showRoiOnStream}
                  aria-label="在畫面上顯示目標的自選偵測區域虛線框"
                  className="sw sm"
                  onClick={() => handleChange('showRoiOnStream', !settings.showRoiOnStream)}
                >
                  <i />
                </button>
              </div>

              <div className="row">
                <span className="lab">
                  <Zap />
                  命中時畫面向外閃爍光暈
                </span>
                <div style={{ flex: 1 }} />
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings.flashScreenOnHit}
                  aria-label="辨識命中時畫面向外閃爍光暈"
                  className="sw sm"
                  onClick={() => handleChange('flashScreenOnHit', !settings.flashScreenOnHit)}
                >
                  <i />
                </button>
              </div>

              <div className="row">
                <span className="lab">
                  <Sparkles />
                  命中時施放慶祝彩帶特效
                </span>
                <div style={{ flex: 1 }} />
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings.confettiOnHit}
                  aria-label="辨識命中時施放慶祝彩帶特效"
                  className="sw sm"
                  onClick={() => handleChange('confettiOnHit', !settings.confettiOnHit)}
                >
                  <i />
                </button>
              </div>
            </div>
          </div>

          {/* 聲音與瀏覽器系統通知 */}
          <div>
            <h4 className="sect" style={{ marginBottom: 6 }}>
              <Volume2 />
              聲音與瀏覽器系統通知
            </h4>
            <div className="list">
              <div className="row stack">
                <div className="head">
                  <span className="lab">
                    <Volume2 />
                    提示音效音量
                  </span>
                  <span className="val num">{Math.round(settings.masterVolume * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={settings.masterVolume}
                  onChange={(e) => handleChange('masterVolume', Number(e.target.value))}
                  aria-label="提示音效音量"
                  style={{ '--p': `${settings.masterVolume * 100}%` } as React.CSSProperties}
                />
              </div>

              <div className="row stack">
                <div className="head">
                  <span className="lab">
                    <Mic />
                    語音朗讀音量
                  </span>
                  <span className="val num">{Math.round(speechVolume * 100)}%</span>
                  <i className="s" />
                  <button
                    type="button"
                    className="btn mini"
                    onClick={() => speakAlert('語音音量測試', speechVolume)}
                  >
                    <Volume2 />
                    試聽語音
                  </button>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={speechVolume}
                  onChange={(e) => handleChange('speechVolume', Number(e.target.value))}
                  aria-label="語音朗讀音量"
                  style={{ '--p': `${speechVolume * 100}%` } as React.CSSProperties}
                />
              </div>

              <div className="row">
                <span className="lab">
                  <Bell />
                  瀏覽器桌面推播通知
                </span>
                <div style={{ flex: 1 }} />
                <span className={perm.cls}>
                  {perm.icon}
                  {perm.text}
                </span>
                {notificationPermission !== 'granted' && (
                  <button type="button" className="btn mini" onClick={onRequestBrowserNotification}>
                    請求授權
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* 軟體更新：沒有帶 onCheckForUpdate 進來就整段不顯示（瀏覽器版沒有更新器） */}
          {onCheckForUpdate && (
            <div>
              <h4 className="sect" style={{ marginBottom: 6 }}>
                <Download />
                軟體更新
              </h4>
              <div className="list">
                <div className="row">
                  <span className="lab">
                    <Download />
                    檢查是否有新版本
                  </span>
                  <div style={{ flex: 1 }} />
                  <button type="button" className="btn mini" onClick={onCheckForUpdate}>
                    <Download />
                    檢查更新
                  </button>
                </div>
              </div>
              <p className="hint">每次啟動會自動檢查一次，有新版可以直接一鍵下載更新。</p>
            </div>
          )}
        </div>

        <footer>
          <button type="button" className="btn ghost" onClick={onClose}>
            關閉設定
          </button>
        </footer>
      </div>
    </div>
  );
};
