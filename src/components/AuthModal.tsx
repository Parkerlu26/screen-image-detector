import React, { useState } from 'react';
import { UserAccount } from '../types';
import {
  loginUser,
  registerUser,
  redeemActivationCode,
  isBackendConfigured,
  BACKEND_MISSING_MESSAGE,
} from '../utils/auth';
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
  Loader2,
  Cloud,
} from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onLoginSuccess: (user: UserAccount) => void;
  /** 由 App 傳進來的狀態說明，例如「帳號已被停用」或離線寬限到期。 */
  notice?: string;
}

const INPUT_CLASS =
  'w-full bg-slate-950 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition-colors disabled:opacity-50';

const SMALL_INPUT_CLASS =
  'w-full bg-slate-950 border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 disabled:opacity-50';

const TAB_CLASS = (active: boolean): string =>
  `py-2 rounded-lg font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
    active ? 'bg-emerald-600 text-white shadow-md' : 'text-slate-400 hover:text-white hover:bg-slate-900'
  }`;

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onLoginSuccess, notice }) => {
  const [tab, setTab] = useState<'login' | 'register' | 'activate'>('login');
  const [busy, setBusy] = useState(false);

  // 登入
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showMasterKey, setShowMasterKey] = useState(false);
  const [masterKey, setMasterKey] = useState('');

  // 註冊
  const [regUsername, setRegUsername] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirm, setRegConfirm] = useState('');
  const [regDisplayName, setRegDisplayName] = useState('');
  const [regCode, setRegCode] = useState('');

  // 開通
  const [actUsername, setActUsername] = useState('');
  const [actPassword, setActPassword] = useState('');
  const [actCode, setActCode] = useState('');

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const backendReady = isBackendConfigured();

  const switchTab = (next: 'login' | 'register' | 'activate') => {
    setTab(next);
    setErrorMsg(null);
    setSuccessMsg(null);
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!username.trim() || !password) {
      setErrorMsg('請輸入帳號與密碼！');
      return;
    }

    setBusy(true);
    const res = await loginUser(username, password, showMasterKey ? masterKey : undefined);
    setBusy(false);

    if (res.success && res.user) {
      onLoginSuccess(res.user);
      setPassword('');
      setMasterKey('');
      return;
    }
    setErrorMsg(res.message);
    // 管理員一定要金鑰，把欄位打開讓他知道少填了什麼。
    if (res.message.includes('管理員金鑰')) setShowMasterKey(true);
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!regUsername.trim()) {
      setErrorMsg('請輸入欲註冊的帳號！');
      return;
    }
    if (regPassword.length < 6) {
      setErrorMsg('密碼長度至少需 6 個字元！');
      return;
    }
    if (regPassword !== regConfirm) {
      setErrorMsg('兩次密碼輸入不一致，請重新確認！');
      return;
    }

    setBusy(true);
    const res = await registerUser(regUsername, regPassword, regDisplayName, regCode);
    setBusy(false);

    if (!res.success) {
      setErrorMsg(res.message);
      return;
    }
    setSuccessMsg(res.message);
    // 已經直接開通的話幫他跳去登入頁並把帳號帶過去，少打一次。
    if (res.user?.status === 'approved') {
      setUsername(regUsername.trim());
      setTimeout(() => switchTab('login'), 1500);
    }
    setRegPassword('');
    setRegConfirm('');
    setRegCode('');
  };

  const handleActivateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!actUsername.trim() || !actPassword || !actCode.trim()) {
      setErrorMsg('請輸入帳號、密碼與管理員給的開通碼！');
      return;
    }

    setBusy(true);
    const res = await redeemActivationCode({
      code: actCode,
      username: actUsername,
      password: actPassword,
    });
    setBusy(false);

    if (!res.success) {
      setErrorMsg(res.message);
      return;
    }
    setSuccessMsg(`${res.message} 請切換至「帳號登入」開始使用。`);
    setUsername(actUsername.trim());
    setActCode('');
    setActPassword('');
    setTimeout(() => switchTab('login'), 1800);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
        {/* Modal Header */}
        <div className="p-6 pb-4 text-center bg-gradient-to-b from-slate-950 to-slate-900 border-b border-slate-800">
          <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mx-auto mb-3 shadow-lg shadow-emerald-950/50">
            <ShieldCheck className="w-7 h-7" />
          </div>
          <h2 className="text-lg font-bold text-white tracking-wide">六月幫你顧</h2>
          <p className="text-xs text-slate-400 mt-1">視窗螢幕即時圖像偵測與自動提醒系統</p>
          <p className="text-[11px] text-slate-500 mt-1.5 flex items-center justify-center gap-1">
            <Cloud className="w-3 h-3" />
            帳號為雲端帳號，同一組帳密可在多台電腦登入
          </p>

          <div className="grid grid-cols-3 gap-1 bg-slate-950 p-1 rounded-xl mt-4 border border-slate-800 text-xs">
            <button type="button" onClick={() => switchTab('login')} className={TAB_CLASS(tab === 'login')}>
              <LogIn className="w-3.5 h-3.5" />
              帳號登入
            </button>
            <button type="button" onClick={() => switchTab('register')} className={TAB_CLASS(tab === 'register')}>
              <UserPlus className="w-3.5 h-3.5" />
              註冊帳號
            </button>
            <button type="button" onClick={() => switchTab('activate')} className={TAB_CLASS(tab === 'activate')}>
              <Key className="w-3.5 h-3.5" />
              輸入開通碼
            </button>
          </div>
        </div>

        {/* 沒設定後端網址就直接講清楚，不要讓使用者一直試登入 */}
        {!backendReady && (
          <div className="mx-6 mt-4 p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
            <div className="flex-1">{BACKEND_MISSING_MESSAGE}</div>
          </div>
        )}

        {notice && !errorMsg && (
          <div className="mx-6 mt-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs text-amber-200 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
            <div className="flex-1">{notice}</div>
          </div>
        )}

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
                className={INPUT_CLASS}
                disabled={busy}
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
                className={INPUT_CLASS}
                disabled={busy}
              />
            </div>

            {showMasterKey ? (
              <div className="space-y-1.5 p-3.5 bg-slate-950 rounded-xl border border-indigo-500/40 animate-in fade-in">
                <label className="text-xs font-bold text-indigo-300 flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-indigo-400" />
                  管理員安全金鑰 (Master Key)
                </label>
                <input
                  type="password"
                  value={masterKey}
                  onChange={(e) => setMasterKey(e.target.value)}
                  placeholder="僅管理員需要填寫"
                  className="w-full bg-slate-900 border border-indigo-500/50 rounded-lg px-3 py-2 text-xs text-indigo-200 placeholder-slate-500 focus:outline-none disabled:opacity-50"
                  disabled={busy}
                />
                <p className="text-[10px] text-slate-400">
                  🔒 金鑰保存在伺服器端，程式檔案裡不含任何金鑰，反編譯也拿不到。
                </p>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowMasterKey(true)}
                className="text-[11px] text-slate-500 hover:text-indigo-300 transition-colors cursor-pointer flex items-center gap-1"
              >
                <KeyRound className="w-3 h-3" />
                我是管理員（需輸入安全金鑰）
              </button>
            )}

            <button
              type="submit"
              disabled={busy || !backendReady}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:hover:bg-emerald-600 text-white rounded-xl text-sm font-bold transition-all shadow-lg shadow-emerald-950/50 flex items-center justify-center gap-2 cursor-pointer mt-2"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
              {busy ? '驗證中…' : '確認登入'}
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
                value={regUsername}
                onChange={(e) => setRegUsername(e.target.value)}
                placeholder="英文、數字或 _ . -（至少 3 碼）"
                className={SMALL_INPUT_CLASS}
                disabled={busy}
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
                  value={regPassword}
                  onChange={(e) => setRegPassword(e.target.value)}
                  placeholder="至少 6 碼"
                  className={SMALL_INPUT_CLASS}
                  disabled={busy}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-slate-400" />
                  確認密碼 <span className="text-rose-400">*</span>
                </label>
                <input
                  type="password"
                  value={regConfirm}
                  onChange={(e) => setRegConfirm(e.target.value)}
                  placeholder="再次輸入密碼"
                  className={SMALL_INPUT_CLASS}
                  disabled={busy}
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300">顯示暱稱 (選填)</label>
              <input
                type="text"
                value={regDisplayName}
                onChange={(e) => setRegDisplayName(e.target.value)}
                placeholder="例如：小明"
                className={SMALL_INPUT_CLASS}
                disabled={busy}
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-amber-300 flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-amber-400" />
                開通碼 (選填)
              </label>
              <input
                type="text"
                value={regCode}
                onChange={(e) => setRegCode(e.target.value.toUpperCase())}
                placeholder="例如：JUNE-7K3M-P2QX-9WD4"
                className="w-full bg-slate-950 border border-amber-500/40 rounded-xl px-3 py-2 text-xs text-amber-200 font-mono placeholder-slate-500 focus:outline-none disabled:opacity-50"
                disabled={busy}
              />
              <p className="text-[10px] text-slate-500 leading-relaxed">
                有開通碼就直接填，註冊完可立刻登入；沒有的話送出後由管理員審核開通。
              </p>
            </div>

            <button
              type="submit"
              disabled={busy || !backendReady}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-emerald-950/50 flex items-center justify-center gap-2 cursor-pointer mt-2"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
              {busy ? '送出中…' : '送出註冊'}
            </button>
          </form>
        )}

        {/* ── TAB 3: 用開通碼自助開通 ── */}
        {tab === 'activate' && (
          <form onSubmit={handleActivateSubmit} className="p-6 space-y-3.5">
            <p className="text-[11px] text-slate-400 leading-relaxed p-3 bg-slate-950 rounded-xl border border-slate-800">
              已經註冊、但還在等待審核或使用期限到了，可以在這裡輸入管理員給的開通碼直接開通或續期。
            </p>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-slate-400" />
                帳號名稱
              </label>
              <input
                type="text"
                value={actUsername}
                onChange={(e) => setActUsername(e.target.value)}
                placeholder="請輸入已註冊的帳號"
                className={SMALL_INPUT_CLASS}
                disabled={busy}
                autoFocus
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-slate-400" />
                帳號密碼
              </label>
              <input
                type="password"
                value={actPassword}
                onChange={(e) => setActPassword(e.target.value)}
                placeholder="用來確認是你本人"
                className={SMALL_INPUT_CLASS}
                disabled={busy}
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-amber-400" />
                管理員給的開通碼
              </label>
              <input
                type="text"
                value={actCode}
                onChange={(e) => setActCode(e.target.value.toUpperCase())}
                placeholder="例如：JUNE-7K3M-P2QX-9WD4"
                className="w-full bg-slate-950 border border-amber-500/50 rounded-xl px-3.5 py-2.5 text-xs text-amber-300 font-mono placeholder-slate-500 focus:outline-none disabled:opacity-50"
                disabled={busy}
              />
            </div>

            <button
              type="submit"
              disabled={busy || !backendReady}
              className="w-full py-3 bg-gradient-to-r from-amber-600 to-emerald-600 hover:from-amber-500 hover:to-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-lg flex items-center justify-center gap-2 cursor-pointer mt-2"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {busy ? '驗證中…' : '驗證並立即開通'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

