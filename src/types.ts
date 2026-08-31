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

/**
 * 帳號資料一律由後端提供，客戶端不再保存密碼（連雜湊都拿不到）。
 */
export interface UserAccount {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  /** null 代表永久開通；數字為到期時間 (epoch ms)。 */
  expiresAt: number | null;
  createdAt: number;
  lastLoginAt?: number | null;
  approvedAt?: number | null;
  /** 管理員帳號名稱，或 `code:JUNE-...` 代表是用開通碼自助開通的。 */
  approvedBy?: string | null;
  note?: string | null;
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

// ── 開通碼紀錄（由後端管理，管理員可查誰用掉了哪一組） ──
export interface ActivationCode {
  /** 例如 JUNE-7K3M-P2QX-9WD4。 */
  code: string;
  /** 開通天數；null 代表這組碼是永久開通。 */
  days: number | null;
  status: 'active' | 'used' | 'revoked';
  createdAt: number;
  /** 產生這組碼的管理員帳號。 */
  createdBy?: string | null;
  usedAt?: number | null;
  /** 用掉這組碼的使用者帳號。 */
  usedBy?: string | null;
  note?: string | null;
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
