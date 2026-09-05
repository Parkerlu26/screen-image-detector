/**
 * 管理端後台 —— 雲端版。
 *
 * 帳號與開通碼都存在後端，所以這裡每個動作都是一次 API 呼叫，成功後重新拉一次清單。
 * 兩個頁籤：使用者帳號（審核／期限／狀態／角色／密碼／備註／刪除）與開通碼紀錄
 * （產生、複製、作廢、刪除，並看得到是誰用掉了哪一組）。
 *
 * 外觀走 components.css 的元件名（.modal／.seg／.box／.tbl／.tag／.btn），
 * 這一份不再出現任何 slate／emerald／amber 顏色 class：深淺與強調色由使用者在設定裡選。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivationCode, UserAccount, UserRole, UserStatus } from '../types';
import {
  DURATION_PRESETS,
  adminApproveUser,
  adminCreateCodes,
  adminDeleteCode,
  adminDeleteUser,
  adminExtendUser,
  adminListCodes,
  adminListUsers,
  adminResetPassword,
  adminRevokeCode,
  adminSetUserNote,
  adminSetUserRole,
  adminSetUserStatus,
  describeExpiry,
  formatTimestamp,
} from '../utils/auth';
import {
  AlertCircle,
  Ban,
  CalendarClock,
  Check,
  CheckCircle,
  Clock,
  Copy,
  Crown,
  Key,
  Loader2,
  Lock,
  RefreshCw,
  Search,
  Shield,
  StickyNote,
  Trash2,
  User,
  UserCheck,
  UserX,
  Users,
  X,
  XCircle,
} from 'lucide-react';

interface UserManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentAdmin: UserAccount;
}

/** 期限選項：沿用共用的常用天數，最後再補一個「自訂」。 */
const DURATION_CHOICES: { label: string; value: string }[] = [
  ...DURATION_PRESETS.map((preset) => ({
    label: preset.label,
    value: preset.days === null ? 'permanent' : String(preset.days),
  })),
  { label: '自訂', value: 'custom' },
];

/** 把選到的期限換成 API 要的 days；回傳 undefined 代表自訂天數填錯了。 */
function resolveDays(choice: string, customDays: string): number | null | undefined {
  if (choice === 'permanent') return null;
  if (choice !== 'custom') return Number(choice);
  const parsed = Number(customDays.trim());
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 36_500) return undefined;
  return parsed;
}

const describeDays = (days: number | null): string => (days === null ? '永久' : `${days} 天`);

/** 開通碼狀態直接對到藥丸配色：可使用＝好、已使用＝中性、已作廢＝壞。 */
const CODE_STATUS_STYLE: Record<ActivationCode['status'], string> = {
  active: 'tag ok',
  used: 'tag',
  revoked: 'tag bad',
};

const CODE_STATUS_TEXT: Record<ActivationCode['status'], string> = {
  active: '可使用',
  used: '已使用',
  revoked: '已作廢',
};

export const UserManagementModal: React.FC<UserManagementModalProps> = ({
  isOpen,
  onClose,
  currentAdmin,
}) => {
  const [activeTab, setActiveTab] = useState<'users' | 'codes'>('users');
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [codes, setCodes] = useState<ActivationCode[]>([]);
  const [loading, setLoading] = useState(false);
  /** 正在執行的動作，用來只讓那一顆按鈕轉圈圈。 */
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // 使用者頁籤
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'disabled'>('all');
  const [userDuration, setUserDuration] = useState('30');
  const [userCustomDays, setUserCustomDays] = useState('');
  const [extendMode, setExtendMode] = useState<'add' | 'set'>('add');
  const [resetPwdUserId, setResetPwdUserId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [noteUserId, setNoteUserId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');

  // 開通碼頁籤
  const [codeDuration, setCodeDuration] = useState('30');
  const [codeCustomDays, setCodeCustomDays] = useState('');
  const [codeCount, setCodeCount] = useState('1');
  const [codeNote, setCodeNote] = useState('');
  const [codeSearch, setCodeSearch] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [userResult, codeResult] = await Promise.all([adminListUsers(), adminListCodes()]);
    setLoading(false);
    if (userResult.success && userResult.data) setUsers(userResult.data);
    if (codeResult.success && codeResult.data) setCodes(codeResult.data);
    const failure = !userResult.success ? userResult.message : !codeResult.success ? codeResult.message : null;
    if (failure) setFeedback({ type: 'error', text: failure });
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setFeedback(null);
    setResetPwdUserId(null);
    setNewPassword('');
    setNoteUserId(null);
    void refresh();
  }, [isOpen, refresh]);

  if (!isOpen) return null;

  /** 統一處理「送出 → 顯示結果 → 重新載入」，成功訊息可以自己蓋掉。 */
  const run = async (
    key: string,
    action: () => Promise<{ success: boolean; message: string }>,
    okText?: string,
  ): Promise<void> => {
    setBusyKey(key);
    const result = await action();
    setBusyKey(null);
    setFeedback({
      type: result.success ? 'success' : 'error',
      text: result.success && okText ? okText : result.message,
    });
    if (result.success) await refresh();
  };

  const invalidDaysMessage = '自訂天數請填 1～36500 之間的整數。';

  const handleApprove = (user: UserAccount): void => {
    const days = resolveDays(userDuration, userCustomDays);
    if (days === undefined) {
      setFeedback({ type: 'error', text: invalidDaysMessage });
      return;
    }
    void run(
      `approve:${user.id}`,
      () => adminApproveUser(user.id, days),
      `已開通 [${user.username}]，期限：${describeDays(days)}。`,
    );
  };

  const handleExtend = (user: UserAccount): void => {
    const days = resolveDays(userDuration, userCustomDays);
    if (days === undefined) {
      setFeedback({ type: 'error', text: invalidDaysMessage });
      return;
    }
    void run(
      `extend:${user.id}`,
      () => adminExtendUser(user.id, days, extendMode),
      `已更新 [${user.username}] 的使用期限（${extendMode === 'add' ? '往後加' : '重新算'} ${describeDays(days)}）。`,
    );
  };

  const handleStatus = (user: UserAccount, status: UserStatus): void => {
    if (user.id === currentAdmin.id && status !== 'approved') {
      setFeedback({ type: 'error', text: '不能停用或拒絕自己目前登入的帳號。' });
      return;
    }
    void run(`status:${user.id}`, () => adminSetUserStatus(user.id, status));
  };

  const handleRoleToggle = (user: UserAccount): void => {
    if (user.id === currentAdmin.id) {
      setFeedback({ type: 'error', text: '不能改自己的身分，請用另一個管理員帳號操作。' });
      return;
    }
    const nextRole: UserRole = user.role === 'admin' ? 'user' : 'admin';
    void run(`role:${user.id}`, () => adminSetUserRole(user.id, nextRole));
  };

  const handleDeleteUser = (user: UserAccount): void => {
    if (user.id === currentAdmin.id) {
      setFeedback({ type: 'error', text: '不能刪除自己目前登入的帳號。' });
      return;
    }
    if (!confirm(`確定要永久刪除帳號「${user.username}」嗎？此操作無法還原。`)) return;
    void run(`delete:${user.id}`, () => adminDeleteUser(user.id));
  };

  const handleResetPassword = (user: UserAccount): void => {
    if (newPassword.length < 6) {
      setFeedback({ type: 'error', text: '新密碼長度至少需 6 個字元。' });
      return;
    }
    void run(`password:${user.id}`, async () => {
      const result = await adminResetPassword(user.id, newPassword);
      if (result.success) {
        setResetPwdUserId(null);
        setNewPassword('');
      }
      return result;
    });
  };

  const handleSaveNote = (user: UserAccount): void => {
    void run(`note:${user.id}`, async () => {
      const result = await adminSetUserNote(user.id, noteDraft);
      if (result.success) setNoteUserId(null);
      return result;
    });
  };

  const handleCreateCodes = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const days = resolveDays(codeDuration, codeCustomDays);
    if (days === undefined) {
      setFeedback({ type: 'error', text: invalidDaysMessage });
      return;
    }
    const count = Number(codeCount.trim());
    if (!Number.isInteger(count) || count < 1 || count > 50) {
      setFeedback({ type: 'error', text: '一次可產生 1～50 組開通碼。' });
      return;
    }

    setBusyKey('create-codes');
    const result = await adminCreateCodes(days, count, codeNote);
    setBusyKey(null);
    if (!result.success) {
      setFeedback({ type: 'error', text: result.message });
      return;
    }
    setCodeNote('');
    setFeedback({
      type: 'success',
      text: `${result.message} 期限 ${describeDays(days)}，可在下方清單點「複製」把開通碼給客戶。`,
    });
    await refresh();
  };

  const handleRevokeCode = (record: ActivationCode): void => {
    if (!confirm(`確定要作廢開通碼「${record.code}」嗎？作廢後就不能再被兌換。`)) return;
    void run(`revoke:${record.code}`, () => adminRevokeCode(record.code));
  };

  const handleDeleteCode = (record: ActivationCode): void => {
    if (!confirm(`確定要刪除「${record.code}」這筆紀錄嗎？刪除後就查不到誰用過它了。`)) return;
    void run(`delete-code:${record.code}`, () => adminDeleteCode(record.code));
  };

  const handleCopy = (text: string): void => {
    void navigator.clipboard.writeText(text);
    setCopied(text);
    setTimeout(() => setCopied(null), 2000);
  };

  const keyword = searchQuery.trim().toLowerCase();
  const filteredUsers = users.filter((user) => {
    const matched =
      !keyword ||
      user.username.toLowerCase().includes(keyword) ||
      user.displayName.toLowerCase().includes(keyword) ||
      (user.note ?? '').toLowerCase().includes(keyword);
    if (!matched) return false;
    return statusFilter === 'all' ? true : user.status === statusFilter;
  });

  const codeKeyword = codeSearch.trim().toLowerCase();
  const filteredCodes = codes.filter((record) => {
    if (!codeKeyword) return true;
    return (
      record.code.toLowerCase().includes(codeKeyword) ||
      (record.usedBy ?? '').toLowerCase().includes(codeKeyword) ||
      (record.createdBy ?? '').toLowerCase().includes(codeKeyword) ||
      (record.note ?? '').toLowerCase().includes(codeKeyword)
    );
  });

  const pendingCount = users.filter((user) => user.status === 'pending').length;
  const activeCodeCount = codes.filter((record) => record.status === 'active').length;

  /**
   * 期限選擇器；兩個頁籤共用。
   * 舊版兩邊各用一個顏色（綠／琥珀）來分頁籤，新版強調色是使用者選的，
   * 所以只留一套 .opts：被按下的那顆吃強調色，其餘中性。
   * 自訂天數的輸入框寫 height:auto，讓它跟旁邊的按鈕一起被 flex 拉到同高。
   */
  const renderDurationPicker = (
    choice: string,
    setChoice: (value: string) => void,
    custom: string,
    setCustom: (value: string) => void,
  ): React.ReactNode => (
    <div className="opts">
      {DURATION_CHOICES.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={choice === option.value}
          onClick={() => setChoice(option.value)}
        >
          {option.label}
        </button>
      ))}
      {choice === 'custom' && (
        <input
          type="number"
          min={1}
          max={36500}
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="天數"
          className="field num"
          style={{ width: '96px', height: 'auto' }}
        />
      )}
    </div>
  );

  return (
    // 後台是最寬的視窗（1152），寬度仍走 inline --mw，.modal 自己會夾在畫面內。
    <div className="scrim">
      <div
        className="modal"
        style={{ '--mw': '1152px' } as React.CSSProperties}
        role="dialog"
        aria-modal="true"
        aria-labelledby="um-title"
      >
        <header>
          <div className="mtile">
            <Shield />
          </div>
          <div className="htxt">
            <div className="ttl">
              <h3 id="um-title">雲端帳號管理後台</h3>
              <span className="tag acc">
                <Crown />
                管理員: {currentAdmin.displayName || currentAdmin.username}
              </span>
              {pendingCount > 0 && (
                <span className="tag warn">
                  <Clock />
                  {pendingCount} 人待審核
                </span>
              )}
            </div>
            <p>審核帳號、決定開通多久、產生與追蹤開通碼；所有資料都存在伺服器，換電腦一樣看得到。</p>
          </div>

          <div className="hact">
            {/* 兩個頁籤用跟頂列同一顆滑塊；筆數改成 .count 小圓角，不再寫成括號 */}
            <div
              className="seg"
              role="tablist"
              style={{ '--n': 2, '--i': activeTab === 'users' ? 0 : 1 } as React.CSSProperties}
            >
              <div className="seg-thumb" />
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'users'}
                onClick={() => setActiveTab('users')}
              >
                <Users />
                使用者帳號
                <span className="count">{users.length}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'codes'}
                onClick={() => setActiveTab('codes')}
              >
                <Key />
                開通碼紀錄
                <span className="count">{codes.length}</span>
              </button>
            </div>

            <button
              type="button"
              className="btn ghost ico-only"
              onClick={() => void refresh()}
              disabled={loading}
              title="重新載入"
              aria-label="重新載入"
            >
              {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            </button>

            <button
              type="button"
              className="btn ghost ico-only"
              onClick={onClose}
              title="關閉帳號管理"
              aria-label="關閉帳號管理"
            >
              <X />
            </button>
          </div>
        </header>

        {/* .body 預設是會撐開的 grid；後台的清單筆數會變，所以改成靠上排，
            資料少的時候不要把區塊拉成一片空白。 */}
        <div className="body" style={{ alignContent: 'start' }}>
          {/* 操作結果 */}
          {feedback && (
            <div className={`banner ${feedback.type === 'success' ? 'ok' : 'bad'}`}>
              {feedback.type === 'success' ? <CheckCircle /> : <AlertCircle />}
              <p>{feedback.text}</p>
              <button
                type="button"
                className="btn mini ico-only x"
                onClick={() => setFeedback(null)}
                title="關閉訊息"
                aria-label="關閉訊息"
              >
                <X />
              </button>
            </div>
          )}

          {/* ═══ 頁籤一：使用者帳號 ═══ */}
          {activeTab === 'users' && (
            <>
              {/* 期限設定：先選好天數，再按下每一列的「開通 / 延長」 */}
              <section className="box">
                <h4 className="sect">
                  <CalendarClock />
                  開通 / 延長期限
                </h4>
                <div className="grid gap-2">
                  {renderDurationPicker(userDuration, setUserDuration, userCustomDays, setUserCustomDays)}
                  <div className="opts">
                    {(['add', 'set'] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        aria-pressed={extendMode === mode}
                        onClick={() => setExtendMode(mode)}
                        title={mode === 'add' ? '從原本的到期日往後加' : '不管原本到期日，從今天重新算'}
                      >
                        {mode === 'add' ? '延長：往後加' : '延長：重新算'}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="hint">
                  先在這裡選好天數，再按下方帳號的「開通」或「延長」，該帳號就套用這個期限。
                </p>
              </section>

              {/* 搜尋與狀態篩選：兩邊都是列上的工具，用一條 flex 排，窄的時候自己換行 */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="search" style={{ maxWidth: '260px' }}>
                  <Search />
                  <input
                    type="text"
                    className="field"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="搜尋帳號、暱稱或備註..."
                  />
                </div>

                <span className="hint" style={{ margin: 0, marginLeft: 'auto' }}>
                  篩選:
                </span>
                <div className="opts">
                  {(['all', 'pending', 'approved', 'disabled'] as const).map((status) => (
                    <button
                      key={status}
                      type="button"
                      aria-pressed={statusFilter === status}
                      onClick={() => setStatusFilter(status)}
                    >
                      {status === 'all' && '全部'}
                      {status === 'pending' && `待審核 (${pendingCount})`}
                      {status === 'approved' && '已開通'}
                      {status === 'disabled' && '已停用'}
                    </button>
                  ))}
                </div>
              </div>

              {/* 重設密碼：從表格上方長出來的一條，處理完就收起來 */}
              {resetPwdUserId && (
                <div className="editbar">
                  <Lock />
                  <b>重設 [{users.find((u) => u.id === resetPwdUserId)?.username}] 的密碼：</b>
                  <input
                    type="text"
                    className="field"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="輸入新密碼 (至少 6 字元)"
                    autoFocus
                  />
                  <button
                    type="button"
                    className="btn mini pri"
                    onClick={() => {
                      const target = users.find((u) => u.id === resetPwdUserId);
                      if (target) handleResetPassword(target);
                    }}
                    disabled={busyKey === `password:${resetPwdUserId}`}
                  >
                    儲存新密碼
                  </button>
                  <button
                    type="button"
                    className="btn mini"
                    onClick={() => {
                      setResetPwdUserId(null);
                      setNewPassword('');
                    }}
                  >
                    取消
                  </button>
                </div>
              )}

              {/* 備註 */}
              {noteUserId && (
                <div className="editbar">
                  <StickyNote />
                  <b>[{users.find((u) => u.id === noteUserId)?.username}] 的備註：</b>
                  <input
                    type="text"
                    className="field"
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    placeholder="例如：月費客戶、朋友、試用中"
                    autoFocus
                  />
                  <button
                    type="button"
                    className="btn mini pri"
                    onClick={() => {
                      const target = users.find((u) => u.id === noteUserId);
                      if (target) handleSaveNote(target);
                    }}
                    disabled={busyKey === `note:${noteUserId}`}
                  >
                    儲存備註
                  </button>
                  <button type="button" className="btn mini" onClick={() => setNoteUserId(null)}>
                    取消
                  </button>
                </div>
              )}

              {/* 使用者清單。.tblwrap 必須是那個會捲的容器，sticky 的欄名才黏得住，
                  所以這裡要給它高度上限，不能讓它一路長高把捲動交給 .body。 */}
              <div className="tblwrap" style={{ maxHeight: '56vh' }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>帳號名稱 / 暱稱</th>
                      <th>角色權限</th>
                      <th>目前狀態</th>
                      <th>使用期限</th>
                      <th>最後登入</th>
                      <th className="r">管理與操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="none">
                          {loading ? '正在向伺服器讀取帳號清單…' : '沒有符合條件的使用者帳號'}
                        </td>
                      </tr>
                    ) : (
                      filteredUsers.map((user) => {
                        const isSelf = user.id === currentAdmin.id;
                        const rowBusy = busyKey?.endsWith(`:${user.id}`) ?? false;

                        return (
                          <tr key={user.id}>
                            <td>
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="ava">
                                  {(user.displayName || user.username).charAt(0).toUpperCase()}
                                </span>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <b>{user.username}</b>
                                    {isSelf && <span className="tag acc">目前登入</span>}
                                  </div>
                                  <span className="fsub">
                                    {user.displayName}
                                    {user.note ? ` • ${user.note}` : ''}
                                  </span>
                                </div>
                              </div>
                            </td>

                            <td>
                              {/* 角色是「點下去就切換」的藥丸，所以用 button.tag 而不是 span */}
                              <button
                                type="button"
                                className={user.role === 'admin' ? 'tag acc' : 'tag'}
                                onClick={() => handleRoleToggle(user)}
                                disabled={isSelf || rowBusy}
                                title={isSelf ? '無法修改自己的身分' : '點擊切換管理員／一般使用者'}
                              >
                                {user.role === 'admin' ? <Crown /> : <User />}
                                {user.role === 'admin' ? '管理員' : '一般使用者'}
                              </button>
                            </td>

                            <td>
                              {user.status === 'approved' && (
                                <span className="tag ok">
                                  <CheckCircle />
                                  已開通
                                </span>
                              )}
                              {user.status === 'pending' && (
                                <span className="tag warn">
                                  <Clock />
                                  待審核開通
                                </span>
                              )}
                              {user.status === 'disabled' && (
                                <span className="tag">
                                  <UserX />
                                  已停用
                                </span>
                              )}
                              {user.status === 'rejected' && (
                                <span className="tag bad">
                                  <XCircle />
                                  已拒絕
                                </span>
                              )}
                            </td>

                            <td>
                              <b style={{ fontWeight: 500 }}>{describeExpiry(user.expiresAt)}</b>
                              {user.approvedBy && (
                                <span className="fsub">
                                  {user.approvedBy.startsWith('code:')
                                    ? `開通碼自助開通（${user.approvedBy.slice(5)}）`
                                    : `由 ${user.approvedBy} 開通`}
                                </span>
                              )}
                            </td>

                            <td>
                              <div>{formatTimestamp(user.lastLoginAt)}</div>
                              <span className="fsub">註冊 {formatTimestamp(user.createdAt)}</span>
                            </td>

                            <td className="r">
                              <div className="acts">
                                {user.status !== 'approved' ? (
                                  <button
                                    type="button"
                                    className="btn mini pri"
                                    onClick={() => handleApprove(user)}
                                    disabled={rowBusy}
                                    title="用上方選好的期限開通這個帳號"
                                  >
                                    {busyKey === `approve:${user.id}` ? (
                                      <Loader2 className="animate-spin" />
                                    ) : (
                                      <UserCheck />
                                    )}
                                    開通
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    className="btn mini"
                                    onClick={() => handleExtend(user)}
                                    disabled={rowBusy}
                                    title="用上方選好的期限延長這個帳號"
                                  >
                                    {busyKey === `extend:${user.id}` ? (
                                      <Loader2 className="animate-spin" />
                                    ) : (
                                      <CalendarClock />
                                    )}
                                    延長
                                  </button>
                                )}

                                {user.status === 'approved' && !isSelf && (
                                  <button
                                    type="button"
                                    className="btn mini"
                                    onClick={() => handleStatus(user, 'disabled')}
                                    disabled={rowBusy}
                                    title="停用此帳號（其他電腦會立刻登出）"
                                  >
                                    停用
                                  </button>
                                )}
                                {(user.status === 'disabled' || user.status === 'rejected') && (
                                  <button
                                    type="button"
                                    className="btn mini"
                                    onClick={() => handleStatus(user, 'approved')}
                                    disabled={rowBusy}
                                    title="重新啟用此帳號"
                                  >
                                    啟用
                                  </button>
                                )}
                                {user.status === 'pending' && (
                                  <button
                                    type="button"
                                    className="btn mini"
                                    style={{ color: 'var(--bad)' }}
                                    onClick={() => handleStatus(user, 'rejected')}
                                    disabled={rowBusy}
                                    title="拒絕這筆註冊申請"
                                  >
                                    拒絕
                                  </button>
                                )}

                                <button
                                  type="button"
                                  className="btn mini ico-only"
                                  onClick={() => {
                                    setNoteUserId(user.id);
                                    setNoteDraft(user.note ?? '');
                                  }}
                                  title="編輯備註"
                                  aria-label="編輯備註"
                                >
                                  <StickyNote />
                                </button>

                                <button
                                  type="button"
                                  className="btn mini ico-only"
                                  onClick={() => {
                                    setResetPwdUserId(user.id);
                                    setNewPassword('');
                                  }}
                                  title="重設此帳號密碼"
                                  aria-label="重設此帳號密碼"
                                >
                                  <Lock />
                                </button>

                                {!isSelf && (
                                  <button
                                    type="button"
                                    className="btn mini ico-only"
                                    style={{ color: 'var(--bad)' }}
                                    onClick={() => handleDeleteUser(user)}
                                    disabled={rowBusy}
                                    title="永久刪除此帳號"
                                    aria-label="永久刪除此帳號"
                                  >
                                    <Trash2 />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ═══ 頁籤二：開通碼紀錄 ═══ */}
          {activeTab === 'codes' && (
            <>
              <form className="box" onSubmit={(e) => void handleCreateCodes(e)}>
                <h4 className="sect">
                  <Key />
                  產生開通碼
                </h4>
                <p className="hint" style={{ margin: '0 0 var(--sp3)' }}>
                  開通碼一組只能用一次，客戶可在註冊時直接填，或在「輸入開通碼」頁自助開通／續期。
                </p>

                <div className="fgroup">
                  <label>開通期限：</label>
                  {renderDurationPicker(codeDuration, setCodeDuration, codeCustomDays, setCodeCustomDays)}
                </div>

                <div
                  className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end"
                  style={{ marginTop: 'var(--sp3)' }}
                >
                  <div className="fgroup">
                    <label htmlFor="code-count">產生組數 (1～50)：</label>
                    <input
                      id="code-count"
                      type="number"
                      min={1}
                      max={50}
                      className="field lg"
                      value={codeCount}
                      onChange={(e) => setCodeCount(e.target.value)}
                    />
                  </div>

                  <div className="fgroup">
                    <label htmlFor="code-note">備註 (選填)：</label>
                    <input
                      id="code-note"
                      type="text"
                      className="field lg"
                      value={codeNote}
                      onChange={(e) => setCodeNote(e.target.value)}
                      placeholder="例如：8 月團購、朋友試用"
                    />
                  </div>

                  <button type="submit" className="btn pri" disabled={busyKey === 'create-codes'}>
                    {busyKey === 'create-codes' ? <Loader2 className="animate-spin" /> : <Key />}
                    產生開通碼
                  </button>
                </div>
              </form>

              <div className="flex flex-wrap items-center gap-2">
                <div className="search" style={{ maxWidth: '300px' }}>
                  <Search />
                  <input
                    type="text"
                    className="field"
                    value={codeSearch}
                    onChange={(e) => setCodeSearch(e.target.value)}
                    placeholder="搜尋開通碼、使用者或備註..."
                  />
                </div>
                <p className="hint" style={{ margin: 0, marginLeft: 'auto' }}>
                  共 <b>{codes.length}</b> 組，其中{' '}
                  <b>{activeCodeCount}</b> 組還沒被使用
                </p>
              </div>

              <div className="tblwrap" style={{ maxHeight: '52vh' }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>開通碼</th>
                      <th>開通期限</th>
                      <th>狀態</th>
                      <th>使用者 / 使用時間</th>
                      <th>備註</th>
                      <th>產生時間</th>
                      <th className="r">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCodes.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="none">
                          {loading
                            ? '正在向伺服器讀取開通碼紀錄…'
                            : codes.length === 0
                            ? '還沒有任何開通碼，在上面選好期限就能產生。'
                            : '沒有找到符合搜尋條件的紀錄'}
                        </td>
                      </tr>
                    ) : (

                      filteredCodes.map((record) => (
                        <tr key={record.code}>
                          <td>
                            <div className="flex items-center gap-2">
                              <span className="codepill">{record.code}</span>
                              <button
                                type="button"
                                className="btn mini"
                                style={copied === record.code ? { color: 'var(--ok)' } : undefined}
                                onClick={() => handleCopy(record.code)}
                                title="複製開通碼給客戶"
                              >
                                {copied === record.code ? <Check /> : <Copy />}
                                {copied === record.code ? '已複製' : '複製'}
                              </button>
                            </div>
                          </td>

                          <td>
                            <b style={{ fontWeight: 500 }}>{describeDays(record.days)}</b>
                          </td>

                          <td>
                            <span className={CODE_STATUS_STYLE[record.status]}>
                              {CODE_STATUS_TEXT[record.status]}
                            </span>
                          </td>

                          <td>
                            {record.usedBy ? (
                              <>
                                <b>{record.usedBy}</b>
                                <span className="fsub">{formatTimestamp(record.usedAt)}</span>
                              </>
                            ) : (
                              '—'
                            )}
                          </td>

                          <td><div className="memo">{record.note || '—'}</div></td>

                          <td>
                            <div>{formatTimestamp(record.createdAt)}</div>
                            {record.createdBy && <span className="fsub">by {record.createdBy}</span>}
                          </td>
                          <td className="r">
                            <div className="acts">
                              {record.status === 'active' && (
                                <button
                                  type="button"
                                  className="btn mini"
                                  style={{ color: 'var(--bad)' }}
                                  onClick={() => handleRevokeCode(record)}
                                  disabled={busyKey === `revoke:${record.code}`}
                                  title="作廢這組開通碼"
                                >
                                  <Ban />
                                  作廢
                                </button>
                              )}
                              <button
                                type="button"
                                className="btn mini ico-only"
                                style={{ color: 'var(--bad)' }}
                                onClick={() => handleDeleteCode(record)}
                                disabled={busyKey === `delete-code:${record.code}`}
                                title="刪除這筆紀錄"
                                aria-label="刪除這筆紀錄"
                              >
                                <Trash2 />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

