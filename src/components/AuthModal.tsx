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

type AuthTab = 'login' | 'register' | 'activate';

/** .seg 的滑塊靠 --i 定位，跟頂列的分頁同一套做法（不是三顆各自上色的按鈕）。 */
const TAB_INDEX: Record<AuthTab, number> = { login: 0, register: 1, activate: 2 };

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onLoginSuccess, notice }) => {
  const [tab, setTab] = useState<AuthTab>('login');
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

  const switchTab = (next: AuthTab) => {
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
    // 登入視窗蓋在所有 modal 之上（其餘 60、更新視窗 70）：沒登入就什麼都不能做，
    // 所以它也是唯一沒有關閉鈕、沒有 footer 的視窗。
    <div className="scrim" style={{ zIndex: 100 }}>
      <div
        className="modal"
        style={{ '--mw': '448px' } as React.CSSProperties}
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-title"
      >
        <header className="hero">
          <div className="mtile">
            <ShieldCheck />
          </div>
          <div className="htxt">
            <h3 id="auth-title">六月幫你顧</h3>
            <p className="tagline">視窗螢幕即時圖像偵測與自動提醒系統</p>
            <p className="cloud">
              <Cloud />
              帳號為雲端帳號，同一組帳密可在多台電腦登入
            </p>
          </div>

          <div
            className="seg"
            role="tablist"
            style={{ '--n': 3, '--i': TAB_INDEX[tab] } as React.CSSProperties}
          >
            <div className="seg-thumb" />
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'login'}
              onClick={() => switchTab('login')}
            >
              <LogIn />
              帳號登入
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'register'}
              onClick={() => switchTab('register')}
            >
              <UserPlus />
              註冊帳號
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'activate'}
              onClick={() => switchTab('activate')}
            >
              <Key />
              輸入開通碼
            </button>
          </div>
        </header>

        <div className="body">
          {/* 沒設定後端網址就直接講清楚，不要讓使用者一直試登入 */}
          {!backendReady && (
            <div className="banner bad">
              <AlertCircle />
              <p>{BACKEND_MISSING_MESSAGE}</p>
            </div>
          )}

          {notice && !errorMsg && (
            <div className="banner warn">
              <AlertCircle />
              <p>{notice}</p>
            </div>
          )}

          {errorMsg && (
            <div className="banner bad">
              <AlertCircle />
              <p>{errorMsg}</p>
            </div>
          )}

          {successMsg && (
            <div className="banner ok">
              <CheckCircle2 />
              <p>{successMsg}</p>
            </div>
          )}

          {/* ── TAB 1: 帳號登入 ── */}
          {tab === 'login' && (
            <form onSubmit={handleLoginSubmit} className="form stack">
              <div className="fgroup">
                <label htmlFor="auth-username">
                  <User />
                  帳號名稱
                </label>
                <input
                  id="auth-username"
                  type="text"
                  className="field lg"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="請輸入帳號"
                  disabled={busy}
                  autoFocus
                />
              </div>

              <div className="fgroup">
                <label htmlFor="auth-password">
                  <Lock />
                  帳號密碼
                </label>
                <input
                  id="auth-password"
                  type="password"
                  className="field lg"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="請輸入密碼"
                  disabled={busy}
                />
              </div>

              {showMasterKey ? (
                <div className="fbox">
                  <div className="fgroup">
                    <label htmlFor="auth-master">
                      <KeyRound />
                      管理員安全金鑰 (Master Key)
                    </label>
                    <input
                      id="auth-master"
                      type="password"
                      className="field lg"
                      value={masterKey}
                      onChange={(e) => setMasterKey(e.target.value)}
                      placeholder="僅管理員需要填寫"
                      disabled={busy}
                    />
                    <p className="hint">金鑰保存在伺服器端，程式檔案裡不含任何金鑰，反編譯也拿不到。</p>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn mini"
                  style={{ justifySelf: 'start' }}
                  onClick={() => setShowMasterKey(true)}
                >
                  <KeyRound />
                  我是管理員（需輸入安全金鑰）
                </button>
              )}

              <button type="submit" className="btn pri wide" disabled={busy || !backendReady}>
                {busy ? <Loader2 className="animate-spin" /> : <LogIn />}
                {busy ? '驗證中…' : '確認登入'}
              </button>
            </form>
          )}

          {/* ── TAB 2: 註冊新帳號 ── */}
          {tab === 'register' && (
            <form onSubmit={handleRegisterSubmit} className="form stack">
              <div className="fgroup">
                <label htmlFor="reg-username">
                  <User />
                  欲註冊之帳號 <b className="req">*</b>
                </label>
                <input
                  id="reg-username"
                  type="text"
                  className="field lg"
                  value={regUsername}
                  onChange={(e) => setRegUsername(e.target.value)}
                  placeholder="英文、數字或 _ . -（至少 3 碼）"
                  disabled={busy}
                />
              </div>

              <div className="fgrid">
                <div className="fgroup">
                  <label htmlFor="reg-password">
                    <Lock />
                    設定密碼 <b className="req">*</b>
                  </label>
                  <input
                    id="reg-password"
                    type="password"
                    className="field lg"
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    placeholder="至少 6 碼"
                    disabled={busy}
                  />
                </div>
                <div className="fgroup">
                  <label htmlFor="reg-confirm">
                    <Lock />
                    確認密碼 <b className="req">*</b>
                  </label>
                  <input
                    id="reg-confirm"
                    type="password"
                    className="field lg"
                    value={regConfirm}
                    onChange={(e) => setRegConfirm(e.target.value)}
                    placeholder="再次輸入密碼"
                    disabled={busy}
                  />
                </div>
              </div>

              <div className="fgroup">
                <label htmlFor="reg-nick">顯示暱稱 (選填)</label>
                <input
                  id="reg-nick"
                  type="text"
                  className="field lg"
                  value={regDisplayName}
                  onChange={(e) => setRegDisplayName(e.target.value)}
                  placeholder="例如：小明"
                  disabled={busy}
                />
              </div>

              <div className="fgroup">
                <label htmlFor="reg-code">
                  <Key />
                  開通碼 (選填)
                </label>
                <input
                  id="reg-code"
                  type="text"
                  className="field lg code"
                  value={regCode}
                  onChange={(e) => setRegCode(e.target.value.toUpperCase())}
                  placeholder="例如：JUNE-7K3M-P2QX-9WD4"
                  disabled={busy}
                />
                <p className="hint">
                  有開通碼就直接填，註冊完可立刻登入；沒有的話送出後由管理員審核開通。
                </p>
              </div>

              <button type="submit" className="btn pri wide" disabled={busy || !backendReady}>
                {busy ? <Loader2 className="animate-spin" /> : <UserPlus />}
                {busy ? '送出中…' : '送出註冊'}
              </button>
            </form>
          )}

          {/* ── TAB 3: 用開通碼自助開通 ── */}
          {tab === 'activate' && (
            <form onSubmit={handleActivateSubmit} className="form stack">
              <div className="fbox">
                <p>已經註冊、但還在等待審核或使用期限到了，可以在這裡輸入管理員給的開通碼直接開通或續期。</p>
              </div>

              <div className="fgroup">
                <label htmlFor="act-username">
                  <User />
                  帳號名稱
                </label>
                <input
                  id="act-username"
                  type="text"
                  className="field lg"
                  value={actUsername}
                  onChange={(e) => setActUsername(e.target.value)}
                  placeholder="請輸入已註冊的帳號"
                  disabled={busy}
                  autoFocus
                />
              </div>

              <div className="fgroup">
                <label htmlFor="act-password">
                  <Lock />
                  帳號密碼
                </label>
                <input
                  id="act-password"
                  type="password"
                  className="field lg"
                  value={actPassword}
                  onChange={(e) => setActPassword(e.target.value)}
                  placeholder="用來確認是你本人"
                  disabled={busy}
                />
              </div>

              <div className="fgroup">
                <label htmlFor="act-code">
                  <Key />
                  管理員給的開通碼
                </label>
                <input
                  id="act-code"
                  type="text"
                  className="field lg code"
                  value={actCode}
                  onChange={(e) => setActCode(e.target.value.toUpperCase())}
                  placeholder="例如：JUNE-7K3M-P2QX-9WD4"
                  disabled={busy}
                />
              </div>

              <button type="submit" className="btn pri wide" disabled={busy || !backendReady}>
                {busy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
                {busy ? '驗證中…' : '驗證並立即開通'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
