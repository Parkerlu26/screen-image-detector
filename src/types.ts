export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type SoundType = 'chime' | 'beep' | 'siren' | 'coin' | 'scifi' | 'fanfare' | 'double_ding' | 'custom';

export interface Target {
  id: string;
  name: string;
  enabled: boolean;
  color: string; // Hex color for bounding boxes (e.g. #10B981)
  imageDataUrl: string; // Base64 PNG
  imageWidth: number;
  imageHeight: number;

  /**
   * Which 子目錄 (group) this target belongs to. Null/undefined = 未分類.
   * Order inside a group follows the order of the `targets` array itself, so
   * dragging a card only ever rewrites that array plus this one field.
   */
  groupId?: string | null;
  
  // Per-target settings
  threshold: number; // 0.50 to 0.99 (similarity percentage)
  cooldownSeconds: number; // Cooldown before next trigger
  
  // Independent detection region (ROI). If undefined or null, search entire screen.
  normalizedRoi?: {
    x: number; // 0..1
    y: number; // 0..1
    width: number; // 0..1
    height: number; // 0..1
  } | null;

  // Notification settings (with per-target volume)
  soundType: SoundType;
  volume?: number; // 0..1 (單獨提示音量)
  customSoundDataUrl?: string;
  speakName: boolean; // Text-to-speech announcement
  speechVolume?: number; // 0..1 (單獨語音朗讀音量，未設定時沿用全域語音音量)
  browserNotification: boolean;
  
  // Runtime tracking
  lastTriggeredAt?: number; // timestamp
  currentSimilarity?: number; // Real-time match confidence (0..1)
  isMatching?: boolean;
}

export interface MatchResult {
  targetId: string;
  targetName: string;
  color: string;
  similarity: number; // 0..1
  box: Rect; // Pixel coordinates on the video frame
  normalizedBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  timestamp: number;
  snapshotDataUrl?: string;
}

export interface MatchLogEntry {
  id: string;
  targetId: string;
  targetName: string;
  color: string;
  similarity: number;
  timestamp: number;
  snapshotDataUrl?: string;
  box: Rect;
}

export interface GlobalSettings {
  scanFps: number; // 5 to 60 FPS (or 0 for uncapped max speed)
  matchAlgorithm: 'ncc' | 'fast_color'; // Normalized Cross Correlation vs Fast Color SAD
  enableAudio: boolean;
  masterVolume: number; // 0..1
  speechVolume: number; // 0..1
  flashScreenOnHit: boolean;
  showBoundingBoxesOnStream: boolean;
  showRoiOnStream: boolean;
  confettiOnHit: boolean;
  autoScrollLogs: boolean;
}

/** A 子目錄 in the target list. Membership is by `Target.groupId`. */
export interface TargetGroup {
  id: string;
  name: string;
  color?: string;
  /** Collapsed groups hide their cards but keep detecting. */
  collapsed?: boolean;
}

export interface AppConfig {
  version: string;
  targets: Target[];
  groups?: TargetGroup[];
  settings: GlobalSettings;
}

// User Registration & Approval Types
export type UserRole = 'admin' | 'user';
export type UserStatus = 'pending' | 'approved' | 'rejected' | 'disabled';

export interface UserAccount {
  id: string;
  username: string;
  password: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  createdAt: number;
  lastLoginAt?: number;
  approvedAt?: number;
  approvedBy?: string;
  note?: string;
}

// ── Multi-Condition Image Automation Rule (with multi-target A, hotkey & per-rule sound) ──
export interface ImageComboRule {
  id: string;
  name: string;
  enabled: boolean;
  targetIdA?: string; // Target 1 (Legacy single target)
  targetIdsA?: string[]; // Target A (Multi-select: any of these triggers the action)
  targetIdB?: string; // Target 2 (Optional AND condition)
  action: 'right_click_and_center' | 'left_click_and_center' | 'sound_only';
  hotkey?: string; // 快捷按鍵 (例如：F5，按一下切換開關)
  soundType?: SoundType;
  volume?: number; // 0..1 (單獨提示音量)
  cooldownSeconds: number;
  lastTriggeredAt?: number;
  returnToCenter: boolean;
}

// ── Admin License & Client Account Record ──
export interface LicenseRecord {
  id: string;
  clientUsername: string; // 註冊帳號
  clientDisplayName?: string; // 客戶暱稱 / 備註
  requestCode: string; // 申請代碼 (例如 REQ-USER123-A9F2)
  activationKey: string; // 開通金鑰 (例如 ACT-...)
  status: 'active' | 'revoked'; // 狀態
  issuedAt: number; // 核發時間
  note?: string; // 備註
}

export interface CooldownTimer {
  id: string;
  name: string; // 計時名稱 (例如：魔消)
  enabled?: boolean; // 獨立開關 (true: 啟用 / false: 停用)
  hotkey: string; // 快捷鍵 (例如：W)
  mode: 'loop' | 'stop_on_zero' | 'two_phase'; // 倒數模式 (自動循環 / 倒數後停止 / 雙回合切換)
  durationSeconds: number; // 倒數時間 (秒，例如：80.0)
  displayMode: 'default' | 'cooldown' | 'original_only'; // 圖示效果模式 (預設 / 冷卻模式 / 僅用原圖)
  
  // 圖片 (僅作為懸浮窗與計時圖示，不作偵測)
  imageDataUrl?: string;
  
  // 完成提示音效與語音 (含單獨音量調整)
  soundOnComplete: boolean;
  soundType: SoundType;
  volume?: number; // 0..1 (完成音效單獨音量)
  customSoundDataUrl?: string;
  speakOnComplete: boolean;
  customSpeakText?: string; // 自訂朗讀文字 (例如："魔消 計時完成")

  // 提前幾秒提示音效與語音 (含單獨音量調整)
  leadSeconds: number; // 提前秒數 (0 代表停用)
  soundOnLead: boolean;
  leadSoundType: SoundType;
  leadVolume?: number; // 0..1 (提前音效單獨音量)
  speakOnLead: boolean;
  customLeadSpeakText?: string; // 自訂提前朗讀文字 (例如："魔消 快好了")
  leadTriggered?: boolean; // 內部運行標記

  // 運行精確時間戳
  remainingSeconds: number;
  isRunning: boolean;
  startedAt?: number;
  endsAt?: number; // 精確結束時間戳 (Date.now() + duration * 1000)
  color?: string;
}
