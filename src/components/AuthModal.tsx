import React, { useState } from 'react';
import { UserAccount } from '../types';
import { authenticateUser, registerUser, activateUserWithKey, OFFICIAL_MASTER_SECRET } from '../utils/auth';
import {
  ShieldCheck,
  UserPlus,
  LogIn,
  KeyRound,
  User,
  Lock,
  AlertCircle,
  CheckCircle2,
  Key,
  Copy,
  Check,
  HelpCircle,
  ShieldAlert,
} from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onLoginSuccess: (user: UserAccount) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onLoginSuccess }) => {
  const [tab, setTab] = useState<'login' | 'register' | 'activate'>('login');

  // Form State
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [note, setNote] = useState('');
  const [masterKey, setMasterKey] = useState('');

  // Activation Tab State
  const [actUsername, setActUsername] = useState('');
  const [activationKey, setActivationKey] = useState('');

  // Pending Request Code State
  const [pendingReqCode, setPendingReqCode] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  // Status & Feedback
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const isAdminUsername = username.trim().toLowerCase() === 'admin';

  const handleCopyReqCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    setPendingReqCode(null);

    if (!username.trim() || !password) {
      setErrorMsg('請輸入帳號與密碼！');
      return;
    }

    if (isAdminUsername && !masterKey.trim()) {
      setErrorMsg('登入管理員帳號 (admin) 必須輸入「管理員安全金鑰 (Master Key)」！');
      return;
    }

    const res = authenticateUser(username, password, masterKey);
    if (res.success && res.user) {
      onLoginSuccess(res.user);
    } else {
      setErrorMsg(res.message);
      if (res.requestCode) {
        setPendingReqCode(res.requestCode);
      }
    }
  };

  const handleRegisterSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    setPendingReqCode(null);

    if (!username.trim()) {
      setErrorMsg('請輸入欲註冊的帳號！');
      return;
    }
    if (password.length < 4) {
      setErrorMsg('密碼長度至少需 4 個字元！');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg('兩次密碼輸入不一致，請重新確認！');
      return;
    }

    const res = registerUser(username, password, displayName, note);
    if (res.success) {
      setSuccessMsg(res.message);
      if (res.requestCode) {
        setPendingReqCode(res.requestCode);
      }
      if (res.user && res.user.status === 'approved') {
        setTimeout(() => {
          setTab('login');
          setPassword('');
          setConfirmPassword('');
        }, 1200);
      } else {
        setPassword('');
        setConfirmPassword('');
      }
    } else {
      setErrorMsg(res.message);
    }
  };

  const handleActivateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!actUsername.trim() || !activationKey.trim()) {
      setErrorMsg('請輸入欲開通的帳號名稱與管理員給予的開通金鑰！');
      return;
    }

    const res = activateUserWithKey(actUsername, activationKey);
    if (res.success && res.user) {
      setSuccessMsg(res.message);
      setUsername(actUsername);
      setTimeout(() => {
        setTab('login');
      }, 1500);
    } else {
      setErrorMsg(res.message);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
        {/* Modal Header */}
        <div className="p-6 pb-4 text-center bg-gradient-to-b from-slate-950 to-slate-900 border-b border-slate-800">
          <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mx-auto mb-3 shadow-lg shadow-emerald-950/50">
            <ShieldCheck className="w-7 h-7" />
          </div>
          <h2 className="text-lg font-bold text-white tracking-wide">
            六月幫你顧
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            視窗螢幕即時圖像偵測與自動提醒系統
          </p>

          {/* Navigation Tabs */}
          <div className="grid grid-cols-3 gap-1 bg-slate-950 p-1 rounded-xl mt-4 border border-slate-800 text-xs">
            <button
              type="button"
              onClick={() => {
                setTab('login');
                setErrorMsg(null);
                setSuccessMsg(null);
              }}
              className={`py-2 rounded-lg font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                tab === 'login'
                  ? 'bg-emerald-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900'
              }`}
            >
              <LogIn className="w-3.5 h-3.5" />
              帳號登入
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('register');
                setErrorMsg(null);
                setSuccessMsg(null);
              }}
              className={`py-2 rounded-lg font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                tab === 'register'
                  ? 'bg-emerald-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900'
              }`}
            >
              <UserPlus className="w-3.5 h-3.5" />
              註冊帳號
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('activate');
                setErrorMsg(null);
                setSuccessMsg(null);
              }}
              className={`py-2 rounded-lg font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                tab === 'activate'
                  ? 'bg-emerald-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900'
              }`}
            >
              <Key className="w-3.5 h-3.5" />
              輸入開通碼
            </button>
          </div>
        </div>

        {/* Feedback Messages */}
        {errorMsg && (
          <div className="mx-6 mt-4 p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300 flex items-start gap-2 animate-in fade-in">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
            <div className="flex-1">{errorMsg}</div>
          </div>
        )}

        {successMsg && (
          <div className="mx-6 mt-4 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-xs text-emerald-300 flex items-start gap-2 animate-in fade-in">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400 mt-0.5" />
            <div className="flex-1">{successMsg}</div>
          </div>
        )}

        {/* Pending Approval Request Code Box */}
        {pendingReqCode && (
          <div className="mx-6 mt-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs space-y-2 animate-in fade-in">
            <div className="flex items-center justify-between text-amber-300 font-bold">
              <span className="flex items-center gap-1.5">
                <KeyRound className="w-4 h-4 text-amber-400" />
                您的專屬開通申請碼:
              </span>
              <button
                type="button"
                onClick={() => handleCopyReqCode(pendingReqCode)}
                className="px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-[11px] flex items-center gap-1 transition-colors cursor-pointer"
              >
                {copiedCode ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                {copiedCode ? '已複製！' : '複製代碼'}
              </button>
            </div>
            <div className="p-2 bg-slate-950 rounded-lg border border-amber-500/20 font-mono text-center text-amber-200 font-bold text-xs select-all">
              {pendingReqCode}
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              💡 <strong>開通方式</strong>：請將此「申請代碼」傳給管理員（六月），管理員在管理後台生成「開通金鑰」傳給您後，切換至上方「輸入開通碼」即可立即開通使用！
            </p>
          </div>
        )}

        {/* ── TAB 1: 帳號登入 ── */}
        {tab === 'login' && (
          <form onSubmit={handleLoginSubmit} className="p-6 space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-slate-400" />
                帳號名稱
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="請輸入帳號"
                className="w-full bg-slate-950 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition-colors"
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-slate-400" />
                帳號密碼
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="請輸入密碼"
                className="w-full bg-slate-950 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition-colors"
              />
            </div>

            {/* Master Key Input (Automatically shown when username is admin) */}
            {isAdminUsername && (
              <div className="space-y-1.5 p-3.5 bg-slate-950 rounded-xl border border-indigo-500/40 animate-in fade-in">
                <label className="text-xs font-bold text-indigo-300 flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-indigo-400" />
                  管理員安全金鑰 (Master Key) <span className="text-rose-400">*</span>
                </label>
                <input
                  type="password"
                  value={masterKey}
                  onChange={(e) => setMasterKey(e.target.value)}
                  placeholder="輸入管理員專屬安全金鑰"
                  className="w-full bg-slate-900 border border-indigo-500/50 rounded-lg px-3 py-2 text-xs text-indigo-200 placeholder-slate-500 focus:outline-none"
                />
                <p className="text-[10px] text-slate-400">
                  🔒 管理員權限受安全金鑰保護，他人無法以任何預設密碼登入管理員。
                </p>
              </div>
            )}

            <button
              type="submit"
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-bold transition-all shadow-lg shadow-emerald-950/50 flex items-center justify-center gap-2 cursor-pointer mt-2"
            >
              <LogIn className="w-4 h-4" />
              確認登入
            </button>
          </form>
        )}

        {/* ── TAB 2: 註冊新帳號 ── */}
        {tab === 'register' && (
          <form onSubmit={handleRegisterSubmit} className="p-6 space-y-3.5">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-slate-400" />
                欲註冊之帳號 <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="例如：user01"
                className="w-full bg-slate-950 border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-slate-400" />
                  設定密碼 <span className="text-rose-400">*</span>
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="至少 4 碼"
                  className="w-full bg-slate-950 border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-slate-400" />
                  確認密碼 <span className="text-rose-400">*</span>
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="再次輸入密碼"
                  className="w-full bg-slate-950 border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300">
                顯示暱稱 (選填)
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="例如：小明"
                className="w-full bg-slate-950 border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300">
                申請開通備註 (選填)
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="例如：用於遊戲自動監測"
                className="w-full bg-slate-950 border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <button
              type="submit"
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-emerald-950/50 flex items-center justify-center gap-2 cursor-pointer mt-2"
            >
              <UserPlus className="w-4 h-4" />
              送出註冊申請
            </button>
          </form>
        )}

        {/* ── TAB 3: 輸入開通授權碼 ── */}
        {tab === 'activate' && (
          <form onSubmit={handleActivateSubmit} className="p-6 space-y-3.5">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-slate-400" />
                帳號名稱
              </label>
              <input
                type="text"
                value={actUsername}
                onChange={(e) => setActUsername(e.target.value)}
                placeholder="請輸入註冊的帳號名稱"
                className="w-full bg-slate-950 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                autoFocus
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-amber-400" />
                管理員給予的開通授權金鑰 (Activation Key)
              </label>
              <input
                type="text"
                value={activationKey}
                onChange={(e) => setActivationKey(e.target.value)}
                placeholder="例如：ACT-XXXX-YYYY"
                className="w-full bg-slate-950 border border-amber-500/50 rounded-xl px-3.5 py-2.5 text-xs text-amber-300 font-mono placeholder-slate-500 focus:outline-none"
              />
            </div>

            <button
              type="submit"
              className="w-full py-3 bg-gradient-to-r from-amber-600 to-emerald-600 hover:from-amber-500 hover:to-emerald-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg flex items-center justify-center gap-2 cursor-pointer mt-2"
            >
              <CheckCircle2 className="w-4 h-4" />
              驗證並立即開通
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
