/**
 * 管理端後台 —— 雲端版。
 *
 * 帳號與開通碼都存在後端，所以這裡每個動作都是一次 API 呼叫，成功後重新拉一次清單。
 * 兩個頁籤：使用者帳號（審核／期限／狀態／角色／密碼／備註／刪除）與開通碼紀錄
 * （產生、複製、作廢、刪除，並看得到是誰用掉了哪一組）。
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
  Ban,
  CalendarClock,
  Check,
  CheckCircle,
  Clock,
  Copy,
  Key,
  Loader2,
  Lock,
  RefreshCw,
  Search,
  Shield,
  StickyNote,
  Trash2,
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

const INPUT_CLASS =
  'bg-slate-900 border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 disabled:opacity-50';

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

const CODE_STATUS_STYLE: Record<ActivationCode['status'], string> = {
  active: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  used: 'bg-slate-800 text-slate-400 border-slate-700',
  revoked: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
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

  /** 期限選擇器；使用者頁籤用綠色、開通碼頁籤用琥珀色。 */
  const renderDurationPicker = (
    choice: string,
    setChoice: (value: string) => void,
    custom: string,
    setCustom: (value: string) => void,
    accent: 'emerald' | 'amber',
  ): React.ReactNode => (
    <div className="flex flex-wrap items-center gap-1.5">
      {DURATION_CHOICES.map((option) => {
        const selected = choice === option.value;
        const selectedClass =
          accent === 'emerald'
            ? 'bg-emerald-600 border-emerald-500 text-white shadow'
            : 'bg-amber-600 border-amber-500 text-white shadow';
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => setChoice(option.value)}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors cursor-pointer ${
              selected ? selectedClass : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white'
            }`}
          >
            {option.label}
          </button>
        );
      })}
      {choice === 'custom' && (
        <input
          type="number"
          min={1}
          max={36500}
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="天數"
          className={`w-24 ${INPUT_CLASS}`}
        />
      )}
    </div>
  );

  const tabClass = (active: boolean, accent: 'emerald' | 'amber'): string =>
    `px-3 py-1.5 rounded-lg font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
      active
        ? accent === 'emerald'
          ? 'bg-emerald-600 text-white shadow-md'
          : 'bg-amber-600 text-white shadow-md'
        : 'text-slate-400 hover:text-white'
    }`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-6xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950 gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
              <Shield className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-bold text-white">雲端帳號管理後台</h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/40">
                  管理員: {currentAdmin.displayName || currentAdmin.username}
                </span>
                {pendingCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse">
                    {pendingCount} 人待審核
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 truncate">
                審核帳號、決定開通多久、產生與追蹤開通碼；所有資料都存在伺服器，換電腦一樣看得到。
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800 text-xs">
              <button type="button" onClick={() => setActiveTab('users')} className={tabClass(activeTab === 'users', 'emerald')}>
                <Users className="w-3.5 h-3.5" />
                使用者帳號 ({users.length})
              </button>
              <button type="button" onClick={() => setActiveTab('codes')} className={tabClass(activeTab === 'codes', 'amber')}>
                <Key className="w-3.5 h-3.5" />
                開通碼紀錄 ({codes.length})
              </button>
            </div>

            <button
              type="button"
              onClick={() => void refresh()}
              disabled={loading}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
              title="重新載入"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* 操作結果 */}
        {feedback && (
          <div
            className={`mx-6 mt-3 p-3 rounded-xl text-xs flex items-center justify-between gap-2 animate-in fade-in ${
              feedback.type === 'success'
                ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
                : 'bg-rose-500/10 border border-rose-500/30 text-rose-300'
            }`}
          >
            <span className="font-medium">{feedback.text}</span>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="p-0.5 text-slate-400 hover:text-white cursor-pointer shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* ═══ 頁籤一：使用者帳號 ═══ */}
        {activeTab === 'users' && (
          <div className="flex-1 overflow-y-auto p-6 space-y-4 min-h-0">
            {/* 期限設定：先選好天數，再按下每一列的「開通 / 延長」 */}
            <div className="p-4 bg-slate-950/80 border border-emerald-500/30 rounded-2xl space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <h3 className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                  <CalendarClock className="w-4 h-4" />
                  開通 / 延長期限
                </h3>
                <span className="text-[11px] text-slate-400">
                  先在這裡選好天數，再按下方帳號的「開通」或「延長」，該帳號就套用這個期限。
                </span>
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                {renderDurationPicker(userDuration, setUserDuration, userCustomDays, setUserCustomDays, 'emerald')}

                <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800">
                  {(['add', 'set'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setExtendMode(mode)}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors cursor-pointer ${
                        extendMode === mode ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'
                      }`}
                      title={mode === 'add' ? '從原本的到期日往後加' : '不管原本到期日，從今天重新算'}
                    >
                      {mode === 'add' ? '延長：往後加' : '延長：重新算'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 搜尋與狀態篩選 */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-slate-950/60 rounded-xl border border-slate-800">
              <div className="relative flex-1 min-w-[200px] max-w-xs">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜尋帳號、暱稱或備註..."
                  className="w-full bg-slate-900 border border-slate-700/80 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-slate-400 text-[11px]">篩選:</span>
                {(['all', 'pending', 'approved', 'disabled'] as const).map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => setStatusFilter(status)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                      statusFilter === status
                        ? 'bg-emerald-600 text-white shadow'
                        : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                    }`}
                  >
                    {status === 'all' && '全部'}
                    {status === 'pending' && `待審核 (${pendingCount})`}
                    {status === 'approved' && '已開通'}
                    {status === 'disabled' && '已停用'}
                  </button>
                ))}
              </div>
            </div>

            {/* 重設密碼 */}
            {resetPwdUserId && (
              <div className="p-3 bg-indigo-950/60 border border-indigo-500/40 rounded-xl flex items-center gap-3 flex-wrap animate-in fade-in">
                <Lock className="w-4 h-4 text-indigo-400 shrink-0" />
                <span className="text-xs text-indigo-200 font-bold">
                  重設 [{users.find((u) => u.id === resetPwdUserId)?.username}] 的密碼：
                </span>
                <input
                  type="text"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="輸入新密碼 (至少 6 字元)"
                  className={`flex-1 max-w-xs ${INPUT_CLASS}`}
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => {
                    const target = users.find((u) => u.id === resetPwdUserId);
                    if (target) handleResetPassword(target);
                  }}
                  disabled={busyKey === `password:${resetPwdUserId}`}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer"
                >
                  儲存新密碼
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setResetPwdUserId(null);
                    setNewPassword('');
                  }}
                  className="px-2 py-1.5 bg-slate-800 text-slate-400 hover:text-white rounded-lg text-xs cursor-pointer"
                >
                  取消
                </button>
              </div>
            )}

            {/* 備註 */}
            {noteUserId && (
              <div className="p-3 bg-slate-950/80 border border-slate-700 rounded-xl flex items-center gap-3 flex-wrap animate-in fade-in">
                <StickyNote className="w-4 h-4 text-amber-400 shrink-0" />
                <span className="text-xs text-slate-200 font-bold">
                  [{users.find((u) => u.id === noteUserId)?.username}] 的備註：
                </span>
                <input
                  type="text"
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  placeholder="例如：月費客戶、朋友、試用中"
                  className={`flex-1 max-w-sm ${INPUT_CLASS}`}
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => {
                    const target = users.find((u) => u.id === noteUserId);
                    if (target) handleSaveNote(target);
                  }}
                  disabled={busyKey === `note:${noteUserId}`}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer"
                >
                  儲存備註
                </button>
                <button
                  type="button"
                  onClick={() => setNoteUserId(null)}
                  className="px-2 py-1.5 bg-slate-800 text-slate-400 hover:text-white rounded-lg text-xs cursor-pointer"
                >
                  取消
                </button>
              </div>
            )}

            {/* 使用者清單 */}
            <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/50">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/80">
                    <th className="p-3 font-semibold">帳號名稱 / 暱稱</th>
                    <th className="p-3 font-semibold">角色權限</th>
                    <th className="p-3 font-semibold">目前狀態</th>
                    <th className="p-3 font-semibold">使用期限</th>
                    <th className="p-3 font-semibold">最後登入</th>
                    <th className="p-3 font-semibold text-right">管理與操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-500">
                        {loading ? '正在向伺服器讀取帳號清單…' : '沒有符合條件的使用者帳號'}
                      </td>
                    </tr>
                  ) : (
                    filteredUsers.map((user) => {
                      const isSelf = user.id === currentAdmin.id;
                      const rowBusy = busyKey?.endsWith(`:${user.id}`) ?? false;

                      return (
                        <tr key={user.id} className="hover:bg-slate-900/60 transition-colors">
                          <td className="p-3">
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300 font-bold shrink-0">
                                {(user.displayName || user.username).charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <div className="font-bold text-white flex items-center gap-1.5">
                                  {user.username}
                                  {isSelf && (
                                    <span className="px-1.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                                      目前登入
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-slate-400">
                                  {user.displayName}
                                  {user.note ? ` • ${user.note}` : ''}
                                </div>
                              </div>
                            </div>
                          </td>

                          <td className="p-3">
                            <button
                              type="button"
                              onClick={() => handleRoleToggle(user)}
                              disabled={isSelf || rowBusy}
                              className={`px-2 py-0.5 rounded-md text-[11px] font-bold border transition-colors ${
                                user.role === 'admin'
                                  ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40 hover:bg-indigo-500/30'
                                  : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
                              } ${isSelf ? 'cursor-default' : 'cursor-pointer'}`}
                              title={isSelf ? '無法修改自己的身分' : '點擊切換管理員／一般使用者'}
                            >
                              {user.role === 'admin' ? '👑 管理員' : '👤 一般使用者'}
                            </button>
                          </td>

                          <td className="p-3">
                            {user.status === 'approved' && (
                              <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1 w-fit">
                                <CheckCircle className="w-3 h-3 text-emerald-400" />
                                已開通
                              </span>
                            )}
                            {user.status === 'pending' && (
                              <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-1 w-fit animate-pulse">
                                <Clock className="w-3 h-3 text-amber-400" />
                                待審核開通
                              </span>
                            )}
                            {user.status === 'disabled' && (
                              <span className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-800 text-slate-400 border border-slate-700 flex items-center gap-1 w-fit">
                                <UserX className="w-3 h-3 text-slate-500" />
                                已停用
                              </span>
                            )}
                            {user.status === 'rejected' && (
                              <span className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-rose-500/20 text-rose-300 border border-rose-500/40 flex items-center gap-1 w-fit">
                                <XCircle className="w-3 h-3 text-rose-400" />
                                已拒絕
                              </span>
                            )}
                          </td>

                          <td className="p-3">
                            <div className="text-[11px] font-medium text-slate-300">{describeExpiry(user.expiresAt)}</div>
                            {user.approvedBy && (
                              <div className="text-[10px] text-slate-500">
                                {user.approvedBy.startsWith('code:')
                                  ? `開通碼自助開通（${user.approvedBy.slice(5)}）`
                                  : `由 ${user.approvedBy} 開通`}
                              </div>
                            )}
                          </td>

                          <td className="p-3 text-[11px] text-slate-400">
                            <div>{formatTimestamp(user.lastLoginAt)}</div>
                            <div className="text-[10px] text-slate-500">註冊 {formatTimestamp(user.createdAt)}</div>
                          </td>

                          <td className="p-3 text-right">
                            <div className="flex items-center justify-end gap-1.5 flex-wrap">
                              {user.status !== 'approved' ? (
                                <button
                                  type="button"
                                  onClick={() => handleApprove(user)}
                                  disabled={rowBusy}
                                  className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-[11px] font-bold transition-colors flex items-center gap-1 cursor-pointer"
                                  title="用上方選好的期限開通這個帳號"
                                >
                                  {busyKey === `approve:${user.id}` ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <UserCheck className="w-3 h-3" />
                                  )}
                                  開通
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleExtend(user)}
                                  disabled={rowBusy}
                                  className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-emerald-300 rounded-lg text-[11px] font-bold transition-colors flex items-center gap-1 cursor-pointer"
                                  title="用上方選好的期限延長這個帳號"
                                >
                                  {busyKey === `extend:${user.id}` ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <CalendarClock className="w-3 h-3" />
                                  )}
                                  延長
                                </button>
                              )}

                              {user.status === 'approved' && !isSelf && (
                                <button
                                  type="button"
                                  onClick={() => handleStatus(user, 'disabled')}
                                  disabled={rowBusy}
                                  className="px-2 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-400 hover:text-white rounded-lg text-[11px] transition-colors cursor-pointer"
                                  title="停用此帳號（其他電腦會立刻登出）"
                                >
                                  停用
                                </button>
                              )}
                              {(user.status === 'disabled' || user.status === 'rejected') && (
                                <button
                                  type="button"
                                  onClick={() => handleStatus(user, 'approved')}
                                  disabled={rowBusy}
                                  className="px-2 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-emerald-400 rounded-lg text-[11px] transition-colors cursor-pointer"
                                  title="重新啟用此帳號"
                                >
                                  啟用
                                </button>
                              )}
                              {user.status === 'pending' && (
                                <button
                                  type="button"
                                  onClick={() => handleStatus(user, 'rejected')}
                                  disabled={rowBusy}
                                  className="px-2 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-rose-300 rounded-lg text-[11px] transition-colors cursor-pointer"
                                  title="拒絕這筆註冊申請"
                                >
                                  拒絕
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={() => {
                                  setNoteUserId(user.id);
                                  setNoteDraft(user.note ?? '');
                                }}
                                className="p-1.5 text-slate-400 hover:text-amber-300 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                                title="編輯備註"
                              >
                                <StickyNote className="w-3.5 h-3.5" />
                              </button>

                              <button
                                type="button"
                                onClick={() => {
                                  setResetPwdUserId(user.id);
                                  setNewPassword('');
                                }}
                                className="p-1.5 text-slate-400 hover:text-indigo-300 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                                title="重設此帳號密碼"
                              >
                                <Lock className="w-3.5 h-3.5" />
                              </button>

                              {!isSelf && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteUser(user)}
                                  disabled={rowBusy}
                                  className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
                                  title="永久刪除此帳號"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
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
          </div>
        )}

        {/* ═══ 頁籤二：開通碼紀錄 ═══ */}
        {activeTab === 'codes' && (
          <div className="flex-1 overflow-y-auto p-6 space-y-4 min-h-0">
            <form
              onSubmit={(e) => void handleCreateCodes(e)}
              className="p-4 bg-slate-950/80 border border-amber-500/40 rounded-2xl space-y-3 shadow-xl"
            >
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <h3 className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                  <Key className="w-4 h-4" />
                  產生開通碼
                </h3>
                <span className="text-[11px] text-slate-400">
                  開通碼一組只能用一次，客戶可在註冊時直接填，或在「輸入開通碼」頁自助開通／續期。
                </span>
              </div>

              <div className="space-y-2">
                <label className="text-[11px] text-slate-400 block">開通期限：</label>
                {renderDurationPicker(codeDuration, setCodeDuration, codeCustomDays, setCodeCustomDays, 'amber')}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">產生組數 (1～50)：</label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={codeCount}
                    onChange={(e) => setCodeCount(e.target.value)}
                    className={`w-full ${INPUT_CLASS}`}
                  />
                </div>

                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">備註 (選填)：</label>
                  <input
                    type="text"
                    value={codeNote}
                    onChange={(e) => setCodeNote(e.target.value)}
                    placeholder="例如：8 月團購、朋友試用"
                    className={`w-full ${INPUT_CLASS}`}
                  />
                </div>

                <button
                  type="submit"
                  disabled={busyKey === 'create-codes'}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-md shadow-amber-950/50 transition-all cursor-pointer flex items-center justify-center gap-1.5"
                >
                  {busyKey === 'create-codes' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Key className="w-3.5 h-3.5" />
                  )}
                  產生開通碼
                </button>
              </div>
            </form>

            <div className="flex items-center justify-between gap-4 pt-1 flex-wrap">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  value={codeSearch}
                  onChange={(e) => setCodeSearch(e.target.value)}
                  placeholder="搜尋開通碼、使用者或備註..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                />
              </div>
              <div className="text-xs text-slate-400 font-medium">
                共 <span className="text-amber-400 font-bold">{codes.length}</span> 組，其中{' '}
                <span className="text-emerald-400 font-bold">{activeCodeCount}</span> 組還沒被使用
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/50">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/80">
                    <th className="p-3 font-semibold">開通碼</th>
                    <th className="p-3 font-semibold">開通期限</th>
                    <th className="p-3 font-semibold">狀態</th>
                    <th className="p-3 font-semibold">使用者 / 使用時間</th>
                    <th className="p-3 font-semibold">備註</th>
                    <th className="p-3 font-semibold">產生時間</th>
                    <th className="p-3 font-semibold text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredCodes.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-500">
                        {loading
                          ? '正在向伺服器讀取開通碼紀錄…'
                          : codes.length === 0
                          ? '還沒有任何開通碼，在上面選好期限就能產生。'
                          : '沒有找到符合搜尋條件的紀錄'}
                      </td>
                    </tr>
                  ) : (
                    filteredCodes.map((record) => (
                      <tr key={record.code} className="hover:bg-slate-900/60 transition-colors">
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[11px] font-bold text-amber-300 bg-amber-950/40 px-2 py-0.5 rounded border border-amber-800/40 select-all">
                              {record.code}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleCopy(record.code)}
                              className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] flex items-center gap-1 transition-colors cursor-pointer"
                              title="複製開通碼給客戶"
                            >
                              {copied === record.code ? (
                                <Check className="w-3 h-3 text-emerald-400" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                              {copied === record.code ? '已複製' : '複製'}
                            </button>
                          </div>
                        </td>

                        <td className="p-3 text-[11px] text-slate-300 font-medium">{describeDays(record.days)}</td>

                        <td className="p-3">
                          <span
                            className={`px-2 py-0.5 rounded-md text-[11px] font-bold border w-fit inline-block ${CODE_STATUS_STYLE[record.status]}`}
                          >
                            {CODE_STATUS_TEXT[record.status]}
                          </span>
                        </td>

                        <td className="p-3 text-[11px] text-slate-400">
                          {record.usedBy ? (
                            <>
                              <div className="text-white font-bold">{record.usedBy}</div>
                              <div className="text-[10px] text-slate-500">{formatTimestamp(record.usedAt)}</div>
                            </>
                          ) : (
                            '—'
                          )}
                        </td>

                        <td className="p-3 text-[11px] text-slate-400">{record.note || '—'}</td>

                        <td className="p-3 text-[11px] text-slate-400">
                          <div>{formatTimestamp(record.createdAt)}</div>
                          {record.createdBy && <div className="text-[10px] text-slate-500">by {record.createdBy}</div>}
                        </td>

                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {record.status === 'active' && (
                              <button
                                type="button"
                                onClick={() => handleRevokeCode(record)}
                                disabled={busyKey === `revoke:${record.code}`}
                                className="px-2 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-rose-300 rounded-lg text-[11px] transition-colors cursor-pointer flex items-center gap-1"
                                title="作廢這組開通碼"
                              >
                                <Ban className="w-3 h-3" />
                                作廢
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleDeleteCode(record)}
                              disabled={busyKey === `delete-code:${record.code}`}
                              className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-slate-800 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
                              title="刪除這筆紀錄"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

