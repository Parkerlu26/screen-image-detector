import React, { useState, useEffect } from 'react';
import { UserAccount, UserStatus, UserRole, LicenseRecord } from '../types';
import {
  loadAllUsers,
  updateUserStatus,
  updateUserRole,
  deleteUserAccount,
  resetUserPassword,
  getAutoApproveSetting,
  setAutoApproveSetting,
  generateActivationKey,
  generateUserRequestCode,
  loadLicenseRecords,
  recordLicenseIssued,
  deleteLicenseRecord,
  updateLicenseRecord,
} from '../utils/auth';
import {
  Users,
  X,
  CheckCircle,
  XCircle,
  Shield,
  UserCheck,
  UserX,
  Trash2,
  KeyRound,
  Search,
  Clock,
  Sparkles,
  ToggleLeft,
  ToggleRight,
  Key,
  Copy,
  Check,
  Plus,
  Edit2,
  Lock,
  Save,
  BadgeCheck,
} from 'lucide-react';

interface UserManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentAdmin: UserAccount;
}

export const UserManagementModal: React.FC<UserManagementModalProps> = ({
  isOpen,
  onClose,
  currentAdmin,
}) => {
  const [activeTab, setActiveTab] = useState<'licenses' | 'users'>('licenses');

  // Users State
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'disabled'>('all');
  const [autoApprove, setAutoApprove] = useState(false);
  const [resetPwdUserId, setResetPwdUserId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // License Records State (Permanent Key History)
  const [licenses, setLicenses] = useState<LicenseRecord[]>([]);
  const [licenseSearch, setLicenseSearch] = useState('');
  const [clientNameInput, setClientNameInput] = useState('');
  const [inputReqCode, setInputReqCode] = useState('');
  const [clientNoteInput, setClientNoteInput] = useState('');
  const [generatedActKey, setGeneratedActKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const refreshData = () => {
    setUsers(loadAllUsers());
    setAutoApprove(getAutoApproveSetting());
    setLicenses(loadLicenseRecords());
  };

  useEffect(() => {
    if (isOpen) {
      refreshData();
      setFeedback(null);
      setGeneratedActKey(null);
      setInputReqCode('');
      setClientNameInput('');
      setClientNoteInput('');
      setResetPwdUserId(null);
      setNewPassword('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // ── Key Generator & Permanent Storage ──
  const handleGenerateAndSaveKey = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanReq = inputReqCode.trim().toUpperCase();
    if (!cleanReq) {
      setFeedback({ type: 'error', text: '請輸入欲開通的使用者「申請代碼」(例如 REQ-USER-XXXX)！' });
      return;
    }

    const key = generateActivationKey(cleanReq);
    setGeneratedActKey(key);

    // Permanently record into License Record history
    const record = recordLicenseIssued(
      clientNameInput.trim() || '客戶帳號',
      cleanReq,
      key,
      clientNoteInput.trim() || '正常核發開通金鑰'
    );

    refreshData();
    setFeedback({
      type: 'success',
      text: `🎉 已成功生成並永久儲存開通金鑰：[${key}]，可隨時點擊複製提供給客戶！`,
    });
  };

  const handleCopyKey = (keyText: string) => {
    navigator.clipboard.writeText(keyText);
    setCopiedKey(keyText);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleDeleteLicense = (id: string, clientName: string) => {
    if (confirm(`確定要刪除客戶「${clientName}」的這筆開通金鑰記錄嗎？`)) {
      deleteLicenseRecord(id);
      refreshData();
      setFeedback({ type: 'success', text: `已成功刪除客戶 [${clientName}] 的金鑰記錄。` });
    }
  };

  // ── User Management Handlers ──
  const handleStatusChange = (userId: string, newStatus: UserStatus, username: string) => {
    if (userId === currentAdmin.id && newStatus !== 'approved') {
      setFeedback({ type: 'error', text: '您無法停用或變更自己的目前帳號狀態！' });
      return;
    }
    updateUserStatus(userId, newStatus, currentAdmin.username);
    refreshData();
    setFeedback({
      type: 'success',
      text: `已更新使用者 [${username}] 的狀態為：${
        newStatus === 'approved'
          ? '✅ 已同意開通'
          : newStatus === 'rejected'
          ? '❌ 已拒絕'
          : '⚠️ 已停用'
      }`,
    });
  };

  const handleRoleToggle = (userId: string, currentRole: UserRole, username: string) => {
    if (userId === currentAdmin.id) {
      setFeedback({ type: 'error', text: '您無法更改自己的管理員權限！' });
      return;
    }
    const nextRole: UserRole = currentRole === 'admin' ? 'user' : 'admin';
    updateUserRole(userId, nextRole);
    refreshData();
    setFeedback({
      type: 'success',
      text: `已將使用者 [${username}] 角色設定為：${nextRole === 'admin' ? '👑 管理員' : '👤 一般使用者'}`,
    });
  };

  const handleDeleteUser = (userId: string, username: string) => {
    if (userId === currentAdmin.id) {
      setFeedback({ type: 'error', text: '無法刪除目前正在登入的管理員帳號！' });
      return;
    }
    if (confirm(`確定要永久刪除使用者「${username}」的帳號資料嗎？此操作無法還原。`)) {
      deleteUserAccount(userId);
      refreshData();
      setFeedback({ type: 'success', text: `已成功刪除使用者帳號 [${username}]。` });
    }
  };

  const handleResetPasswordSubmit = (userId: string, username: string) => {
    if (!newPassword || newPassword.length < 4) {
      setFeedback({ type: 'error', text: '新密碼長度至少需 4 個字元！' });
      return;
    }
    resetUserPassword(userId, newPassword);
    setResetPwdUserId(null);
    setNewPassword('');
    refreshData();
    setFeedback({ type: 'success', text: `已成功將使用者 [${username}] 的密碼修改為新密碼！` });
  };

  const handleToggleAutoApprove = () => {
    const next = !autoApprove;
    setAutoApprove(next);
    setAutoApproveSetting(next);
    setFeedback({
      type: 'success',
      text: next
        ? '⚡ 已開啟「新註冊免審核自動開通」：後續新註冊人員可直接登入使用。'
        : '🔒 已關閉自動開通：所有新註冊人員皆需經由管理員審核同意後方可使用。',
    });
  };

  const filteredUsers = users.filter((u) => {
    const matchesQuery =
      u.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (u.note && u.note.toLowerCase().includes(searchQuery.toLowerCase()));

    if (!matchesQuery) return false;
    if (statusFilter === 'all') return true;
    return u.status === statusFilter;
  });

  const filteredLicenses = licenses.filter((l) => {
    const q = licenseSearch.toLowerCase();
    return (
      l.clientUsername.toLowerCase().includes(q) ||
      (l.clientDisplayName && l.clientDisplayName.toLowerCase().includes(q)) ||
      l.requestCode.toLowerCase().includes(q) ||
      l.activationKey.toLowerCase().includes(q) ||
      (l.note && l.note.toLowerCase().includes(q))
    );
  });

  const pendingCount = users.filter((u) => u.status === 'pending').length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-5xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-150">
        {/* Top Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white">管理端授權後台</h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/40">
                  管理員: {currentAdmin.displayName || currentAdmin.username}
                </span>
                {pendingCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse">
                    {pendingCount} 人待審核
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">
                核發並永久記錄客戶端開通金鑰、管理客戶端帳號、密碼重設與審核權限
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Tab Selector */}
            <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800 text-xs">
              <button
                type="button"
                onClick={() => setActiveTab('licenses')}
                className={`px-3 py-1.5 rounded-lg font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeTab === 'licenses'
                    ? 'bg-amber-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Key className="w-3.5 h-3.5" />
                已核發客戶開通金鑰庫 ({licenses.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('users')}
                className={`px-3 py-1.5 rounded-lg font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeTab === 'users'
                    ? 'bg-emerald-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                使用者帳號與密碼管理 ({users.length})
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Feedback Alert */}
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
              className="p-0.5 text-slate-400 hover:text-white cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            TAB 1: 客戶開通金鑰永久記錄庫 (License Vault)
        ═══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'licenses' && (
          <div className="flex-1 overflow-y-auto p-6 space-y-4 min-h-0">
            {/* Quick Key Generator & Auto-Saver Form */}
            <form
              onSubmit={handleGenerateAndSaveKey}
              className="p-4 bg-slate-950/80 border border-amber-500/40 rounded-2xl space-y-3 shadow-xl"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                  <Key className="w-4 h-4" />
                  生成並永久儲存客戶端開通金鑰
                </h3>
                <span className="text-[11px] text-slate-400">
                  輸入客戶端給您的「申請代碼」，系統將生成開通金鑰並永久保存在下方清單中
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">
                    客戶申請代碼 (必填)：
                  </label>
                  <input
                    type="text"
                    value={inputReqCode}
                    onChange={(e) => setInputReqCode(e.target.value.toUpperCase())}
                    placeholder="貼上客戶申請碼 (如 REQ-USER123-XXXX)"
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-cyan-300 font-mono focus:outline-none focus:border-amber-500"
                    required
                  />
                </div>

                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">
                    客戶名稱 / 帳號 (選填)：
                  </label>
                  <input
                    type="text"
                    value={clientNameInput}
                    onChange={(e) => setClientNameInput(e.target.value)}
                    placeholder="例如：王小明 / player1"
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">
                    核發備註 (選填)：
                  </label>
                  <input
                    type="text"
                    value={clientNoteInput}
                    onChange={(e) => setClientNoteInput(e.target.value)}
                    placeholder="例如：永久版授權、月費客戶"
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-2">
                  {generatedActKey && (
                    <div className="flex items-center gap-2 bg-amber-950/60 px-3 py-1 rounded-lg border border-amber-500/50">
                      <span className="text-slate-300 font-mono text-[11px]">最新開通金鑰:</span>
                      <span className="text-amber-300 font-mono font-bold text-xs">{generatedActKey}</span>
                      <button
                        type="button"
                        onClick={() => handleCopyKey(generatedActKey)}
                        className="p-1 rounded bg-amber-500/30 hover:bg-amber-500/50 text-amber-200 text-[10px] flex items-center gap-1 transition-colors cursor-pointer"
                        title="複製最新開通金鑰"
                      >
                        {copiedKey === generatedActKey ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        {copiedKey === generatedActKey ? '已複製' : '複製'}
                      </button>
                    </div>
                  )}
                </div>

                <button
                  type="submit"
                  className="px-4 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-bold shadow-md transition-all cursor-pointer flex items-center gap-1.5 shadow-amber-950/50"
                >
                  <Key className="w-3.5 h-3.5" />
                  生成並永久記錄開通金鑰
                </button>
              </div>
            </form>

            {/* License Search Toolbar */}
            <div className="flex items-center justify-between gap-4 pt-2">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  value={licenseSearch}
                  onChange={(e) => setLicenseSearch(e.target.value)}
                  placeholder="搜尋客戶帳號、申請碼、開通金鑰或備註..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="text-xs text-slate-400 font-medium">
                已累計記錄 <span className="text-amber-400 font-bold">{licenses.length}</span> 組授權金鑰
              </div>
            </div>

            {/* License Records Table */}
            <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/50">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/80">
                    <th className="p-3 font-semibold">客戶名稱 / 帳號</th>
                    <th className="p-3 font-semibold">申請代碼 (Request Code)</th>
                    <th className="p-3 font-semibold">開通授權金鑰 (Activation Key)</th>
                    <th className="p-3 font-semibold">核發備註</th>
                    <th className="p-3 font-semibold">核發時間</th>
                    <th className="p-3 font-semibold text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredLicenses.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-500">
                        {licenses.length === 0
                          ? '尚未生成任何開通金鑰。在上方輸入客戶申請代碼即可立即生成並永久記錄！'
                          : '沒有找到符合搜尋條件的授權記錄'}
                      </td>
                    </tr>
                  ) : (
                    filteredLicenses.map((lic) => (
                      <tr key={lic.id} className="hover:bg-slate-900/60 transition-colors">
                        <td className="p-3">
                          <div className="font-bold text-white flex items-center gap-1.5">
                            <BadgeCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                            {lic.clientUsername}
                          </div>
                        </td>

                        <td className="p-3">
                          <span className="font-mono text-[11px] text-cyan-300 bg-cyan-950/40 px-2 py-0.5 rounded border border-cyan-800/40">
                            {lic.requestCode}
                          </span>
                        </td>

                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[11px] font-bold text-amber-300 bg-amber-950/40 px-2 py-0.5 rounded border border-amber-800/40 select-all">
                              {lic.activationKey}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleCopyKey(lic.activationKey)}
                              className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] flex items-center gap-1 transition-colors cursor-pointer"
                              title="複製開通金鑰給客戶"
                            >
                              {copiedKey === lic.activationKey ? (
                                <Check className="w-3 h-3 text-emerald-400" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                              {copiedKey === lic.activationKey ? '已複製' : '複製'}
                            </button>
                          </div>
                        </td>

                        <td className="p-3 text-[11px] text-slate-400">
                          {lic.note || '—'}
                        </td>

                        <td className="p-3 text-[11px] text-slate-400">
                          {new Date(lic.issuedAt).toLocaleDateString('zh-TW', {
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>

                        <td className="p-3 text-right">
                          <button
                            type="button"
                            onClick={() => handleDeleteLicense(lic.id, lic.clientUsername)}
                            className="p-1 text-slate-500 hover:text-rose-400 rounded transition-colors cursor-pointer"
                            title="刪除這筆授權記錄"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            TAB 2: 使用者帳號與密碼管理 (User Accounts Management)
        ═══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'users' && (
          <div className="flex-1 overflow-y-auto p-6 space-y-4 min-h-0">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-4 p-3 bg-slate-950/60 rounded-xl border border-slate-800">
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

              {/* Status Filter */}
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-slate-400 text-[11px]">篩選:</span>
                {(['all', 'pending', 'approved', 'disabled'] as const).map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setStatusFilter(st)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                      statusFilter === st
                        ? 'bg-emerald-600 text-white shadow'
                        : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                    }`}
                  >
                    {st === 'all' && '全部'}
                    {st === 'pending' && `待審核 (${pendingCount})`}
                    {st === 'approved' && '已開通'}
                    {st === 'disabled' && '已停用'}
                  </button>
                ))}
              </div>

              {/* Auto-Approval Toggle */}
              <div className="flex items-center gap-2 bg-slate-900 px-3 py-1.5 rounded-xl border border-slate-800">
                <span className="text-xs text-slate-300 font-medium flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  免審核開通:
                </span>
                <button
                  type="button"
                  onClick={handleToggleAutoApprove}
                  className="text-xs font-bold transition-colors cursor-pointer"
                >
                  {autoApprove ? (
                    <span className="flex items-center gap-1 text-emerald-400">
                      <ToggleRight className="w-5 h-5" />
                      開啟
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-slate-500">
                      <ToggleLeft className="w-5 h-5" />
                      手動
                    </span>
                  )}
                </button>
              </div>
            </div>

            {/* Reset Password Inline Modal */}
            {resetPwdUserId && (
              <div className="p-3 bg-indigo-950/60 border border-indigo-500/40 rounded-xl flex items-center justify-between gap-3 animate-in fade-in">
                <div className="flex items-center gap-2 flex-1">
                  <Lock className="w-4 h-4 text-indigo-400 shrink-0" />
                  <span className="text-xs text-indigo-200 font-bold">
                    修改 [
                    {users.find((u) => u.id === resetPwdUserId)?.username}
                    ] 的密碼：
                  </span>
                  <input
                    type="text"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="輸入新密碼 (至少 4 字元)"
                    className="flex-1 max-w-xs bg-slate-950 border border-indigo-700 rounded-lg px-2.5 py-1 text-xs text-white focus:outline-none"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const u = users.find((x) => x.id === resetPwdUserId);
                      if (u) handleResetPasswordSubmit(u.id, u.username);
                    }}
                    className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer"
                  >
                    儲存新密碼
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setResetPwdUserId(null);
                      setNewPassword('');
                    }}
                    className="px-2 py-1 bg-slate-800 text-slate-400 hover:text-white rounded-lg text-xs"
                  >
                    取消
                  </button>
                </div>
              </div>
            )}

            {/* User Table */}
            <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/50">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/80">
                    <th className="p-3 font-semibold">帳號名稱 / 暱稱</th>
                    <th className="p-3 font-semibold">角色權限</th>
                    <th className="p-3 font-semibold">目前狀態</th>
                    <th className="p-3 font-semibold">申請代碼 (開通用)</th>
                    <th className="p-3 font-semibold">註冊時間</th>
                    <th className="p-3 font-semibold text-right">管理與操作 (修改密碼/刪除)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-500">
                        沒有符合條件的使用者帳號
                      </td>
                    </tr>
                  ) : (
                    filteredUsers.map((user) => {
                      const isSelf = user.id === currentAdmin.id;
                      const reqCode = generateUserRequestCode(user.username);

                      return (
                        <tr key={user.id} className="hover:bg-slate-900/60 transition-colors">
                          {/* Username & DisplayName */}
                          <td className="p-3">
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300 font-bold">
                                {user.displayName.charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <div className="font-bold text-white flex items-center gap-1.5">
                                  {user.username}
                                  {isSelf && (
                                    <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                                      目前登入
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-slate-400">
                                  {user.displayName} {user.note && `• ${user.note}`}
                                </div>
                              </div>
                            </div>
                          </td>

                          {/* Role */}
                          <td className="p-3">
                            <button
                              type="button"
                              onClick={() => handleRoleToggle(user.id, user.role, user.username)}
                              disabled={isSelf}
                              className={`px-2 py-0.5 rounded-md text-[11px] font-bold border transition-colors ${
                                user.role === 'admin'
                                  ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40 hover:bg-indigo-500/30'
                                  : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
                              } ${isSelf ? 'cursor-default' : 'cursor-pointer'}`}
                              title={isSelf ? '無法修改目前登入帳號的角色' : '點擊切換管理員/一般使用者身分'}
                            >
                              {user.role === 'admin' ? '👑 管理員' : '👤 一般使用者'}
                            </button>
                          </td>

                          {/* Status Badge */}
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

                          {/* Request Code */}
                          <td className="p-3">
                            <button
                              type="button"
                              onClick={() => {
                                setActiveTab('licenses');
                                setInputReqCode(reqCode);
                                setClientNameInput(user.displayName || user.username);
                              }}
                              className="font-mono text-[10px] text-cyan-300 hover:text-cyan-200 bg-cyan-950/50 hover:bg-cyan-900/50 px-2 py-1 rounded border border-cyan-800/50 transition-colors flex items-center gap-1 cursor-pointer"
                              title="點擊前往金鑰庫為此帳號生成開通金鑰"
                            >
                              <Key className="w-2.5 h-2.5 text-cyan-400" />
                              {reqCode}
                            </button>
                          </td>

                          {/* Registered At */}
                          <td className="p-3 text-[11px] text-slate-400">
                            {new Date(user.createdAt).toLocaleDateString('zh-TW', {
                              month: '2-digit',
                              day: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </td>

                          {/* Actions */}
                          <td className="p-3 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {/* Approve Button */}
                              {user.status !== 'approved' && (
                                <button
                                  type="button"
                                  onClick={() => handleStatusChange(user.id, 'approved', user.username)}
                                  className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[11px] font-bold transition-colors flex items-center gap-1 cursor-pointer"
                                  title="核准並開通帳號"
                                >
                                  <UserCheck className="w-3 h-3" />
                                  開通
                                </button>
                              )}

                              {/* Disable / Enable Button */}
                              {user.status === 'approved' && !isSelf && (
                                <button
                                  type="button"
                                  onClick={() => handleStatusChange(user.id, 'disabled', user.username)}
                                  className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-lg text-[11px] transition-colors cursor-pointer"
                                  title="停用此帳號"
                                >
                                  停用
                                </button>
                              )}
                              {user.status === 'disabled' && (
                                <button
                                  type="button"
                                  onClick={() => handleStatusChange(user.id, 'approved', user.username)}
                                  className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-emerald-400 rounded-lg text-[11px] transition-colors cursor-pointer"
                                  title="重新啟用此帳號"
                                >
                                  啟用
                                </button>
                              )}

                              {/* Reset Password Button */}
                              <button
                                type="button"
                                onClick={() => {
                                  setResetPwdUserId(user.id);
                                  setNewPassword('');
                                }}
                                className="p-1.5 text-slate-400 hover:text-indigo-300 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                                title="修改此帳號密碼"
                              >
                                <Lock className="w-3.5 h-3.5" />
                              </button>

                              {/* Delete User Button */}
                              {!isSelf && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteUser(user.id, user.username)}
                                  className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                                  title="刪除此帳號"
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
      </div>
    </div>
  );
};
