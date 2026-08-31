/**
 * 帳號與授權 —— 雲端版客戶端。
 *
 * 舊版把帳號、審核狀態與開通紀錄全存在每台電腦自己的 localStorage 裡，所以同一組帳密在
 * 另一台電腦其實是另一筆資料，管理端也只看得到自己電腦上註冊的人。現在這些全部改由
 * `server/` 的 Cloudflare Worker 保管，這個檔案只負責呼叫 API 與快取登入狀態。
 *
 * 本機只留兩樣東西：登入憑證 (token) 與最後一次驗證成功的帳號資料。快取的用途是離線寬限
 * ——後端連不上時仍能撐 GRACE_DAYS 天，不會因為網路斷線就把人鎖在外面。
 */
import { ActivationCode, UserAccount, UserRole, UserStatus } from '../types';

const SESSION_KEY = 'screen_detector_cloud_session_v1';

/** 舊版的資料一律清掉：帳號改為集中管理，所有人都必須重新註冊。 */
const LEGACY_KEYS = [
  'screen_detector_users_v3',
  'screen_detector_session_v3',
  'screen_detector_auto_approve_v3',
  'screen_detector_admin_secret_v3',
  'screen_detector_machine_id_v3',
  'screen_detector_license_records_v3',
];

const DEFAULT_GRACE_DAYS = 7;
const REQUEST_TIMEOUT_MS = 12_000;
const DAY_MS = 86_400_000;

/**
 * 後端網址。打包時由 .env 的 VITE_API_BASE 注入；若 exe 同層放了 api-server.txt，
 * 主行程會把檔案裡的網址用 ?api= 帶進來並優先採用，換伺服器就不必重新打包。
 */
const readApiOverride = (): string => {
  try {
    return new URLSearchParams(window.location.search).get('api')?.trim() ?? '';
  } catch {
    return '';
  }
};

export const API_BASE = (readApiOverride() || import.meta.env?.VITE_API_BASE || '')
  .trim()
  .replace(/\/+$/, '');

export const isBackendConfigured = (): boolean => /^https?:\/\/.+/.test(API_BASE);

export const BACKEND_MISSING_MESSAGE =
  '還沒設定帳號伺服器網址，無法登入。請在程式所在的資料夾放一個 api-server.txt，' +
  '裡面填上帳號伺服器網址（https://…），存檔後重新開啟程式即可。';

/** 管理端常用的開通期限選項；days 為 null 代表永久。 */
export const DURATION_PRESETS: { label: string; days: number | null }[] = [
  { label: '7 天', days: 7 },
  { label: '30 天', days: 30 },
  { label: '90 天', days: 90 },
  { label: '365 天', days: 365 },
  { label: '永久', days: null },
];

interface CachedSession {
  token: string;
  user: UserAccount;
  /** 最後一次跟後端確認成功的時間，離線寬限從這裡算。 */
  verifiedAt: number;
  graceDays: number;
}

interface ApiResult {
  success: boolean;
  message?: string;
  reason?: string;
  [key: string]: unknown;
}

/** 網路層失敗（連不上、逾時）與後端回的業務失敗要分開，前者才觸發離線寬限。 */
class NetworkError extends Error {}

export function clearLegacyLocalData(): void {
  try {
    LEGACY_KEYS.forEach((key) => localStorage.removeItem(key));
  } catch {
    /* localStorage 不可用時忽略 */
  }
}

// ---------------------------------------------------------------------------
// 本機快取
// ---------------------------------------------------------------------------

function readCache(): CachedSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedSession;
    if (!parsed?.token || !parsed?.user?.id) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(session: CachedSession): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch (err) {
    console.error('無法保存登入狀態：', err);
  }
}

/** 同步取用快取的帳號，給畫面第一次渲染用；真正的有效性由 revalidateSession 確認。 */
export function loadCachedSession(): UserAccount | null {
  const cached = readCache();
  if (!cached) return null;
  if (!isWithinGrace(cached)) return null;
  if (cached.user.expiresAt !== null && cached.user.expiresAt <= Date.now()) return null;
  return cached.user;
}

export function getSessionToken(): string | null {
  return readCache()?.token ?? null;
}

export function clearCurrentSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch (err) {
    console.error('無法清除登入狀態：', err);
  }
}

const isWithinGrace = (cached: CachedSession): boolean =>
  Date.now() - cached.verifiedAt <= (cached.graceDays || DEFAULT_GRACE_DAYS) * DAY_MS;

/** 離線寬限還剩幾天，UI 用來提示「再過 N 天必須連上網」。 */
export function getOfflineGraceRemainingDays(): number | null {
  const cached = readCache();
  if (!cached) return null;
  const remaining = (cached.graceDays || DEFAULT_GRACE_DAYS) * DAY_MS - (Date.now() - cached.verifiedAt);
  return remaining <= 0 ? 0 : Math.ceil(remaining / DAY_MS);
}

// ---------------------------------------------------------------------------
// 呼叫後端
// ---------------------------------------------------------------------------

async function callApi(path: string, body: Record<string, unknown> = {}, headers: Record<string, string> = {}): Promise<ApiResult> {
  if (!isBackendConfigured()) throw new NetworkError(BACKEND_MISSING_MESSAGE);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(API_BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    // 伺服器內部錯誤沒有 JSON body 的話也要有可讀訊息。
    const text = await response.text();
    let parsed: ApiResult;
    try {
      parsed = JSON.parse(text) as ApiResult;
    } catch {
      throw new NetworkError(`伺服器回應異常 (HTTP ${response.status})。`);
    }
    return parsed;
  } catch (err) {
    if (err instanceof NetworkError) throw err;
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new NetworkError('連線帳號伺服器逾時，請確認網路狀況。');
    }
    throw new NetworkError('連不上帳號伺服器，請確認網路是否正常。');
  } finally {
    clearTimeout(timer);
  }
}

/** 管理端呼叫都要附 token，缺 token 直接當成登入失效。 */
async function callAdminApi(path: string, body: Record<string, unknown> = {}): Promise<ApiResult> {
  const token = getSessionToken();
  if (!token) return { success: false, message: '登入已失效，請重新登入。' };
  return callApi(path, { ...body, token });
}

/** 把丟出來的錯誤轉成可以直接顯示的訊息。 */
const errorMessage = (err: unknown): string =>
  err instanceof Error && err.message ? err.message : '發生未預期的錯誤，請稍後再試。';

const asUser = (value: unknown): UserAccount | undefined =>
  value && typeof value === 'object' ? (value as UserAccount) : undefined;

// ---------------------------------------------------------------------------
// 註冊 / 登入 / 開通
// ---------------------------------------------------------------------------

export interface AuthOutcome {
  success: boolean;
  message: string;
  user?: UserAccount;
}

export async function registerUser(
  username: string,
  password: string,
  displayName?: string,
  activationCode?: string,
): Promise<AuthOutcome> {
  try {
    const result = await callApi('/api/register', {
      username: username.trim(),
      password,
      displayName: displayName?.trim() || undefined,
      code: activationCode?.trim() || undefined,
    });
    return {
      success: Boolean(result.success),
      message: result.message ?? (result.success ? '註冊完成。' : '註冊失敗，請稍後再試。'),
      user: asUser(result.user),
    };
  } catch (err) {
    return { success: false, message: errorMessage(err) };
  }
}

/**
 * 登入。管理員必須額外輸入金鑰，但金鑰是拿到後端比對的，程式裡不再有任何金鑰。
 * 成功後才寫入本機快取，所以待審核／到期／停用的帳號不會留下任何可用狀態。
 */
export async function loginUser(username: string, password: string, masterKey?: string): Promise<AuthOutcome> {
  try {
    const result = await callApi('/api/login', {
      username: username.trim(),
      password,
      masterKey: masterKey?.trim() || undefined,
    });
    const user = asUser(result.user);
    if (!result.success || !user || typeof result.token !== 'string') {
      return { success: false, message: result.message ?? '帳號或密碼不正確。' };
    }
    clearLegacyLocalData();
    writeCache({
      token: result.token,
      user,
      verifiedAt: Date.now(),
      graceDays: typeof result.graceDays === 'number' ? result.graceDays : DEFAULT_GRACE_DAYS,
    });
    return { success: true, message: result.message ?? '登入成功！', user };
  } catch (err) {
    return { success: false, message: errorMessage(err) };
  }
}

/**
 * 兌換開通碼。已登入的人用 token；待審核的人拿不到 token，所以改用帳密驗證。
 */
export async function redeemActivationCode(params: {
  code: string;
  username?: string;
  password?: string;
}): Promise<AuthOutcome> {
  try {
    const token = getSessionToken();
    const result = await callApi('/api/redeem', {
      code: params.code.trim().toUpperCase(),
      token: token ?? undefined,
      username: params.username?.trim() || undefined,
      password: params.password || undefined,
    });
    const user = asUser(result.user);
    if (result.success && user && token) {
      const cached = readCache();
      if (cached) writeCache({ ...cached, user, verifiedAt: Date.now() });
    }
    return {
      success: Boolean(result.success),
      message: result.message ?? (result.success ? '開通成功。' : '開通失敗。'),
      user,
    };
  } catch (err) {
    return { success: false, message: errorMessage(err) };
  }
}

export async function logoutUser(): Promise<void> {
  const token = getSessionToken();
  clearCurrentSession();
  if (!token) return;
  try {
    await callApi('/api/logout', { token });
  } catch {
    // 本機已經清掉了，伺服器端的 session 會在到期後自己消失。
  }
}

export async function changeOwnPassword(currentPassword: string, newPassword: string): Promise<AuthOutcome> {
  const token = getSessionToken();
  if (!token) return { success: false, message: '登入已失效，請重新登入。' };
  try {
    const result = await callApi('/api/change-password', { token, currentPassword, newPassword });
    return { success: Boolean(result.success), message: result.message ?? '密碼已更新。' };
  } catch (err) {
    return { success: false, message: errorMessage(err) };
  }
}

// ---------------------------------------------------------------------------
// 重新驗證（啟動時與定期執行）
// ---------------------------------------------------------------------------

export interface RevalidateOutcome {
  /** 目前可以使用程式的帳號；null 代表必須重新登入。 */
  user: UserAccount | null;
  /** true 表示這次是連不上後端、靠離線寬限放行的。 */
  offline: boolean;
  /** 被擋下來的原因（到期、停用…），可直接顯示。 */
  message?: string;
  /** 離線寬限還剩幾天。 */
  graceRemainingDays?: number;
}

/**
 * 跟後端確認登入是否還有效。這是「停用後其他電腦立刻失效」以及「到期就不能用」真正生效的地方。
 * 連不上後端時不會把人踢掉，而是在寬限期內沿用上次的結果。
 */
export async function revalidateSession(): Promise<RevalidateOutcome> {
  const cached = readCache();
  if (!cached) return { user: null, offline: false };

  try {
    const result = await callApi('/api/me', { token: cached.token });
    const user = asUser(result.user);
    if (result.success && user) {
      writeCache({
        token: cached.token,
        user,
        verifiedAt: Date.now(),
        graceDays: typeof result.graceDays === 'number' ? result.graceDays : cached.graceDays,
      });
      return { user, offline: false };
    }
    // 後端明確說不行（停用、到期、憑證失效）就立刻清掉，不套用寬限。
    clearCurrentSession();
    return { user: null, offline: false, message: result.message ?? '登入已失效，請重新登入。' };
  } catch (err) {
    if (!isWithinGrace(cached)) {
      clearCurrentSession();
      return {
        user: null,
        offline: true,
        message: `離線超過 ${cached.graceDays || DEFAULT_GRACE_DAYS} 天，請連上網路重新登入。`,
      };
    }
    if (cached.user.expiresAt !== null && cached.user.expiresAt <= Date.now()) {
      clearCurrentSession();
      return { user: null, offline: true, message: '使用期限已到期，請連上網路並向管理員申請延長。' };
    }
    return {
      user: cached.user,
      offline: true,
      message: errorMessage(err),
      graceRemainingDays: getOfflineGraceRemainingDays() ?? 0,
    };
  }
}

// ---------------------------------------------------------------------------
// 管理端
// ---------------------------------------------------------------------------

export interface AdminResult<T = undefined> {
  success: boolean;
  message: string;
  data?: T;
}

const adminOutcome = (result: ApiResult, fallback: string): AdminResult =>
  ({ success: Boolean(result.success), message: result.message ?? (result.success ? fallback : '操作失敗。') });

async function adminCall(path: string, body: Record<string, unknown>, okMessage: string): Promise<AdminResult> {
  try {
    return adminOutcome(await callAdminApi(path, body), okMessage);
  } catch (err) {
    return { success: false, message: errorMessage(err) };
  }
}

export async function adminListUsers(): Promise<AdminResult<UserAccount[]>> {
  try {
    const result = await callAdminApi('/api/admin/users/list');
    if (!result.success) return { success: false, message: result.message ?? '無法載入使用者清單。' };
    return { success: true, message: '', data: (result.users as UserAccount[]) ?? [] };
  } catch (err) {
    return { success: false, message: errorMessage(err) };
  }
}

export async function adminListCodes(): Promise<AdminResult<ActivationCode[]>> {
  try {
    const result = await callAdminApi('/api/admin/codes/list');
    if (!result.success) return { success: false, message: result.message ?? '無法載入開通碼紀錄。' };
    return { success: true, message: '', data: (result.codes as ActivationCode[]) ?? [] };
  } catch (err) {
    return { success: false, message: errorMessage(err) };
  }
}

/** 審核通過並同時決定開通多久；days 為 null 代表永久。 */
export const adminApproveUser = (userId: string, days: number | null): Promise<AdminResult> =>
  adminCall('/api/admin/users/approve', { userId, days }, '已開通。');

/** mode='add' 從原到期日往後加，'set' 從今天重新算。 */
export const adminExtendUser = (userId: string, days: number | null, mode: 'add' | 'set' = 'add'): Promise<AdminResult> =>
  adminCall('/api/admin/users/extend', { userId, days, mode }, '已更新使用期限。');

export const adminSetUserStatus = (userId: string, status: UserStatus): Promise<AdminResult> =>
  adminCall('/api/admin/users/status', { userId, status }, '已更新狀態。');

export const adminSetUserRole = (userId: string, role: UserRole): Promise<AdminResult> =>
  adminCall('/api/admin/users/role', { userId, role }, '已更新身分。');

export const adminResetPassword = (userId: string, newPassword: string): Promise<AdminResult> =>
  adminCall('/api/admin/users/password', { userId, newPassword }, '已重設密碼。');

export const adminSetUserNote = (userId: string, note: string): Promise<AdminResult> =>
  adminCall('/api/admin/users/note', { userId, note }, '已更新備註。');

export const adminDeleteUser = (userId: string): Promise<AdminResult> =>
  adminCall('/api/admin/users/delete', { userId }, '已刪除帳號。');

export async function adminCreateCodes(
  days: number | null,
  count = 1,
  note?: string,
): Promise<AdminResult<ActivationCode[]>> {
  try {
    const result = await callAdminApi('/api/admin/codes/create', { days, count, note: note?.trim() || undefined });
    if (!result.success) return { success: false, message: result.message ?? '產生開通碼失敗。' };
    const codes = (result.codes as ActivationCode[]) ?? [];
    return { success: true, message: `已產生 ${codes.length} 組開通碼。`, data: codes };
  } catch (err) {
    return { success: false, message: errorMessage(err) };
  }
}

export const adminRevokeCode = (code: string): Promise<AdminResult> =>
  adminCall('/api/admin/codes/revoke', { code }, '已作廢這組開通碼。');

export const adminDeleteCode = (code: string): Promise<AdminResult> =>
  adminCall('/api/admin/codes/delete', { code }, '已刪除紀錄。');

// ---------------------------------------------------------------------------
// 顯示用的小工具
// ---------------------------------------------------------------------------

const formatDate = (ms: number): string =>
  new Date(ms).toLocaleString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

export const formatTimestamp = (ms?: number | null): string => (ms ? formatDate(ms) : '—');

/** 把到期時間講成人看得懂的話，例如「剩 6 天（2026/09/07 12:00）」。 */
export function describeExpiry(expiresAt: number | null | undefined): string {
  if (expiresAt === null || expiresAt === undefined) return '永久';
  const remaining = expiresAt - Date.now();
  if (remaining <= 0) return `已到期（${formatDate(expiresAt)}）`;
  const days = Math.ceil(remaining / DAY_MS);
  return `剩 ${days} 天（${formatDate(expiresAt)}）`;
}

export const isExpired = (user: UserAccount): boolean =>
  user.expiresAt !== null && user.expiresAt !== undefined && user.expiresAt <= Date.now();

/** 能不能實際使用程式：已核准且未到期。 */
export const isUsableAccount = (user: UserAccount): boolean => user.status === 'approved' && !isExpired(user);



