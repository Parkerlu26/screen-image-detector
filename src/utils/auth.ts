import { UserAccount, UserRole, UserStatus } from '../types';

const USERS_STORAGE_KEY = 'screen_detector_users_v3';
const SESSION_STORAGE_KEY = 'screen_detector_session_v3';
const AUTO_APPROVE_STORAGE_KEY = 'screen_detector_auto_approve_v3';
const ADMIN_SECRET_KEY_STORAGE = 'screen_detector_admin_secret_v3';
const MACHINE_ID_STORAGE = 'screen_detector_machine_id_v3';

// Official Master Admin Secret Key (Only known to the Creator)
export const OFFICIAL_MASTER_SECRET = 'REMOVED_LEGACY_VALUE';
export const OFFICIAL_ADMIN_PASSWORD = 'REMOVED_LEGACY_VALUE';

/**
 * Get or create unique Machine Identifier
 */
export function getMachineId(): string {
  try {
    let id = localStorage.getItem(MACHINE_ID_STORAGE);
    if (!id) {
      id = 'MCH-' + Math.random().toString(36).substring(2, 8).toUpperCase() + '-' + Date.now().toString(36).substring(3, 7).toUpperCase();
      localStorage.setItem(MACHINE_ID_STORAGE, id);
    }
    return id;
  } catch {
    return 'MCH-DEFAULT-888';
  }
}

/**
 * Get Master Admin Secret Key
 */
export function getMasterAdminSecret(): string {
  try {
    return localStorage.getItem(ADMIN_SECRET_KEY_STORAGE) || OFFICIAL_MASTER_SECRET;
  } catch {
    return OFFICIAL_MASTER_SECRET;
  }
}

export function setMasterAdminSecret(secret: string): void {
  try {
    localStorage.setItem(ADMIN_SECRET_KEY_STORAGE, secret.trim());
  } catch (err) {
    console.error('Failed to set master admin secret:', err);
  }
}

/**
 * Seed initial root admin
 */
function createDefaultAdmin(): UserAccount {
  return {
    id: 'user_admin_root',
    username: 'admin',
    password: OFFICIAL_ADMIN_PASSWORD,
    displayName: '系統管理員 (六月)',
    role: 'admin',
    status: 'approved',
    createdAt: Date.now(),
    note: '六月幫你顧 官方超級管理員',
  };
}

/**
 * Load all user accounts from storage
 */
export function loadAllUsers(): UserAccount[] {
  try {
    const raw = localStorage.getItem(USERS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (err) {
    console.warn('Failed to parse users from localStorage:', err);
  }

  // Seed initial admin
  const initial = [createDefaultAdmin()];
  saveAllUsers(initial);
  return initial;
}

/**
 * Save all users to storage
 */
export function saveAllUsers(users: UserAccount[]): void {
  try {
    localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users));
  } catch (err) {
    console.error('Failed to save users to localStorage:', err);
  }
}

/**
 * Check and get auto-approval setting
 */
export function getAutoApproveSetting(): boolean {
  try {
    return localStorage.getItem(AUTO_APPROVE_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setAutoApproveSetting(enabled: boolean): void {
  try {
    localStorage.setItem(AUTO_APPROVE_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch (err) {
    console.error('Failed to save auto approve setting:', err);
  }
}

/**
 * Generate a Request Code for a user (e.g. REQ-TOMMY-A8B9C)
 */
export function generateUserRequestCode(username: string): string {
  const clean = username.trim().toUpperCase();
  const mch = getMachineId().replace('MCH-', '');
  let hash = 0;
  for (let i = 0; i < clean.length; i++) {
    hash = ((hash << 5) - hash) + clean.charCodeAt(i);
    hash |= 0;
  }
  const hex = Math.abs(hash).toString(16).padStart(4, '0').toUpperCase().substring(0, 4);
  return `REQ-${clean}-${hex}${mch.substring(0, 4)}`;
}

/**
 * Admin creates an Activation Key from a user's Request Code
 */
export function generateActivationKey(requestCode: string): string {
  const clean = requestCode.trim().toUpperCase();
  const secret = getMasterAdminSecret();
  let hash = 5381;
  const combined = clean + '#' + secret;
  for (let i = 0; i < combined.length; i++) {
    hash = ((hash << 5) + hash) + combined.charCodeAt(i);
    hash |= 0;
  }
  const hex = Math.abs(hash).toString(16).padStart(8, '0').toUpperCase().substring(0, 8);
  return `ACT-${hex.substring(0, 4)}-${hex.substring(4, 8)}`;
}

/**
 * Verify if an Activation Key matches the user's Request Code
 */
export function verifyActivationKey(requestCode: string, activationKey: string): boolean {
  const expected = generateActivationKey(requestCode);
  return expected.trim().toUpperCase() === activationKey.trim().toUpperCase();
}

/**
 * Register a new user
 */
export function registerUser(
  username: string,
  password: string,
  displayName?: string,
  note?: string
): { success: boolean; message: string; user?: UserAccount; requestCode?: string } {
  const cleanUsername = username.trim();
  if (!cleanUsername || cleanUsername.length < 3) {
    return { success: false, message: '使用者帳號長度至少需 3 個字元！' };
  }
  if (cleanUsername.toLowerCase() === 'admin') {
    return { success: false, message: '「admin」為系統保留管理員帳號，請使用其他帳號名稱註冊！' };
  }
  if (!password || password.length < 4) {
    return { success: false, message: '密碼長度至少需 4 個字元！' };
  }

  const users = loadAllUsers();
  const existing = users.find((u) => u.username.toLowerCase() === cleanUsername.toLowerCase());
  if (existing) {
    return { success: false, message: '該帳號名稱已被註冊，請更換其他帳號！' };
  }

  const autoApprove = getAutoApproveSetting();
  const initialStatus: UserStatus = autoApprove ? 'approved' : 'pending';

  const newUser: UserAccount = {
    id: `user_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    username: cleanUsername,
    password,
    displayName: displayName?.trim() || cleanUsername,
    role: 'user',
    status: initialStatus,
    createdAt: Date.now(),
    note: note?.trim() || '',
  };

  users.push(newUser);
  saveAllUsers(users);

  const reqCode = generateUserRequestCode(cleanUsername);

  return {
    success: true,
    message: autoApprove
      ? '註冊成功！系統已自動為您開通使用權限，請直接登入。'
      : '註冊申請已送出！您的帳號正在「等待管理員審核」，請將專屬「申請代碼」發送給管理員以獲取開通授權碼。',
    user: newUser,
    requestCode: reqCode,
  };
}

/**
 * Login verification
 */
export function authenticateUser(
  username: string,
  password: string,
  masterKeyInput?: string
): { success: boolean; message: string; user?: UserAccount; requestCode?: string; requiresMasterKey?: boolean } {
  const cleanUsername = username.trim();
  const users = loadAllUsers();

  // ── SPECIAL CHECK FOR ADMIN ACCOUNT ──
  if (cleanUsername.toLowerCase() === 'admin') {
    const adminUser = users.find((u) => u.username.toLowerCase() === 'admin') || createDefaultAdmin();
    const validPwd = password === adminUser.password || password === OFFICIAL_ADMIN_PASSWORD;

    if (!validPwd) {
      return { success: false, message: '管理員密碼錯誤，請重新輸入！', requiresMasterKey: true };
    }

    // ALWAYS REQUIRE MASTER SECRET KEY FOR ADMIN
    const inputKey = masterKeyInput?.trim();
    if (!inputKey || (inputKey !== getMasterAdminSecret() && inputKey !== OFFICIAL_MASTER_SECRET)) {
      return {
        success: false,
        message: '管理員登入需輸入正確的「管理員安全金鑰 (Master Key)」！他人無法登入管理員。',
        requiresMasterKey: true,
      };
    }

    adminUser.lastLoginAt = Date.now();
    saveAllUsers(users);
    saveCurrentSession(adminUser);
    return { success: true, message: '👑 管理員驗證成功，歡迎登入管理後台！', user: adminUser };
  }

  // ── NORMAL USER LOGIN ──
  const user = users.find(
    (u) => u.username.toLowerCase() === cleanUsername.toLowerCase() && u.password === password
  );

  if (!user) {
    return { success: false, message: '帳號或密碼輸入錯誤，請重新確認！' };
  }

  if (user.status === 'pending') {
    const reqCode = generateUserRequestCode(user.username);
    return {
      success: false,
      message: '您的帳號正在「等待管理員審核開通」，請將下方「申請代碼」發送給管理員獲取開通授權碼！',
      requestCode: reqCode,
    };
  }

  if (user.status === 'disabled') {
    return { success: false, message: '該帳號已被管理員停用，無法登入使用！' };
  }

  if (user.status === 'rejected') {
    return { success: false, message: '該帳號的註冊申請已被管理員拒絕！' };
  }

  user.lastLoginAt = Date.now();
  saveAllUsers(users);
  saveCurrentSession(user);

  return { success: true, message: '登入成功！', user };
}

/**
 * Activate user with an Activation Key
 */
export function activateUserWithKey(
  username: string,
  activationKey: string
): { success: boolean; message: string; user?: UserAccount } {
  const cleanUsername = username.trim();
  const users = loadAllUsers();
  const user = users.find((u) => u.username.toLowerCase() === cleanUsername.toLowerCase());

  if (!user) {
    return { success: false, message: '找不到該帳號，請先前往「註冊帳號」！' };
  }

  const reqCode = generateUserRequestCode(user.username);
  if (!verifyActivationKey(reqCode, activationKey)) {
    return { success: false, message: '開通授權金鑰不正確或無效！請確認管理員提供的金鑰無誤。' };
  }

  user.status = 'approved';
  user.approvedAt = Date.now();
  user.approvedBy = '管理員授權金鑰';
  saveAllUsers(users);

  return { success: true, message: '🎉 恭喜！帳號已成功開通授權，請立即切換至「帳號登入」使用。', user };
}

/**
 * Session persistence
 */
export function loadCurrentSession(): UserAccount | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.id) {
        const users = loadAllUsers();
        const freshUser = users.find((u) => u.id === parsed.id);
        if (freshUser && freshUser.status === 'approved') {
          return freshUser;
        }
      }
    }
  } catch (err) {
    console.error('Failed to load session:', err);
  }
  return null;
}

export function saveCurrentSession(user: UserAccount): void {
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(user));
  } catch (err) {
    console.error('Failed to save session:', err);
  }
}

export function clearCurrentSession(): void {
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch (err) {
    console.error('Failed to clear session:', err);
  }
}

/**
 * Admin User CRUD Management Operations
 */
export function updateUserStatus(
  userId: string,
  newStatus: UserStatus,
  adminUsername: string
): boolean {
  const users = loadAllUsers();
  const target = users.find((u) => u.id === userId);
  if (!target) return false;

  target.status = newStatus;
  if (newStatus === 'approved') {
    target.approvedAt = Date.now();
    target.approvedBy = adminUsername;
  }
  saveAllUsers(users);
  return true;
}

export function updateUserRole(userId: string, newRole: UserRole): boolean {
  const users = loadAllUsers();
  const target = users.find((u) => u.id === userId);
  if (!target) return false;

  target.role = newRole;
  saveAllUsers(users);
  return true;
}

export function resetUserPassword(userId: string, newPassword: string): boolean {
  const users = loadAllUsers();
  const target = users.find((u) => u.id === userId);
  if (!target || !newPassword) return false;

  target.password = newPassword;
  saveAllUsers(users);
  return true;
}

export function deleteUserAccount(userId: string): boolean {
  let users = loadAllUsers();
  const target = users.find((u) => u.id === userId);
  if (!target) return false;
  if (target.username === 'admin') return false; // Root admin cannot be deleted

  users = users.filter((u) => u.id !== userId);
  saveAllUsers(users);
  return true;
}

/**
 * License Records Management (Admin Key History & Client Management)
 */
const LICENSE_RECORDS_KEY = 'screen_detector_license_records_v3';

export function loadLicenseRecords(): import('../types').LicenseRecord[] {
  try {
    const raw = localStorage.getItem(LICENSE_RECORDS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (err) {
    console.error('Failed to load license records:', err);
  }
  return [];
}

export function saveAllLicenseRecords(records: import('../types').LicenseRecord[]): void {
  try {
    localStorage.setItem(LICENSE_RECORDS_KEY, JSON.stringify(records));
  } catch (err) {
    console.error('Failed to save license records:', err);
  }
}

export function recordLicenseIssued(
  clientUsername: string,
  requestCode: string,
  activationKey: string,
  note?: string
): import('../types').LicenseRecord {
  const records = loadLicenseRecords();
  const newRecord: import('../types').LicenseRecord = {
    id: `lic_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    clientUsername: clientUsername.trim() || '客戶帳號',
    requestCode: requestCode.trim().toUpperCase(),
    activationKey: activationKey.trim().toUpperCase(),
    status: 'active',
    issuedAt: Date.now(),
    note: note || '正常核發授權',
  };
  const updated = [newRecord, ...records.filter((r) => r.requestCode !== newRecord.requestCode)];
  saveAllLicenseRecords(updated);
  return newRecord;
}

export function deleteLicenseRecord(id: string): boolean {
  const records = loadLicenseRecords();
  const updated = records.filter((r) => r.id !== id);
  saveAllLicenseRecords(updated);
  return true;
}

export function updateLicenseRecord(record: import('../types').LicenseRecord): boolean {
  const records = loadLicenseRecords();
  const updated = records.map((r) => (r.id === record.id ? record : r));
  saveAllLicenseRecords(updated);
  return true;
}
