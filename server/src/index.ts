/**
 * 六月幫你顧 — 帳號與授權後端 (Cloudflare Worker + D1)
 *
 * 為什麼要有這個服務：舊版的帳號、審核狀態與開通紀錄全部存在每台電腦自己的
 * localStorage 裡，所以「同一組帳號」在另一台電腦上其實是另一筆資料，管理端也只看得到
 * 在自己電腦上註冊的人。帳號資料集中到這裡之後，同一組帳密才真的能跨電腦登入，停用與
 * 到期也才會即時生效。
 *
 * 安全性上刻意做的幾件事：
 *   - 密碼只存 PBKDF2 雜湊，資料庫外流也拿不到明文。
 *   - 登入憑證 (token) 只存 SHA-256，且存在資料庫裡，所以停用帳號能立刻讓所有裝置失效。
 *   - 管理員的第二道金鑰放在 Worker secret，客戶端程式與 exe 裡都不再有任何金鑰。
 */

export interface Env {
  DB: D1Database;
  /** 管理員登入時必須額外輸入的金鑰，用 `wrangler secret put ADMIN_MASTER_KEY` 設定。 */
  ADMIN_MASTER_KEY: string;
  /** 只用於建立第一個管理員帳號，建完應立即刪除。 */
  BOOTSTRAP_TOKEN?: string;
  GRACE_DAYS?: string;
  SESSION_DAYS?: string;
}

type Role = 'admin' | 'user';
type Status = 'pending' | 'approved' | 'rejected' | 'disabled';

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  role: Role;
  status: Status;
  expires_at: number | null;
  created_at: number;
  last_login_at: number | null;
  approved_at: number | null;
  approved_by: string | null;
  note: string | null;
}

const PBKDF2_ITERATIONS = 100_000;
const MIN_USERNAME = 3;
const MIN_PASSWORD = 6;

const CORS_HEADERS: Record<string, string> = {
  // 客戶端是 Electron，從 file:// 載入，送出的 Origin 是 null，因此不能用白名單比對。
  // 這裡沒有任何 cookie 或瀏覽器自動附帶的憑證，一切都靠 body 裡的 token，所以開放來源
  // 不會造成 CSRF。
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Bootstrap-Token',
  'Access-Control-Max-Age': '86400',
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
  });

/** 一律回 200 加上 success:false，讓前端只需要看 success 這個欄位。 */
const fail = (message: string): Response => json({ success: false, message });
const ok = (extra: Record<string, unknown> = {}): Response => json({ success: true, ...extra });

// ---------------------------------------------------------------------------
// 雜湊與隨機值
// ---------------------------------------------------------------------------

const toBase64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));

const fromBase64 = (text: string): Uint8Array =>
  Uint8Array.from(atob(text), (ch) => ch.charCodeAt(0));

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

/** 產生 `pbkdf2$<iterations>$<salt_b64>$<hash_b64>`，迭代次數寫在字串裡以便日後調高。 */
async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

/** 用常數時間比對，避免用回應時間猜出密碼前綴。 */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]);
  if (!Number.isFinite(iterations) || iterations <= 0) return false;
  try {
    const expected = fromBase64(parts[3]);
    const actual = await pbkdf2(password, fromBase64(parts[2]), iterations);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function timingSafeEqualText(a: string, b: string): boolean {
  const enc = new TextEncoder();
  return timingSafeEqual(enc.encode(a), enc.encode(b));
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return toHex(new Uint8Array(digest));
}

const newId = (prefix: string): string => `${prefix}_${crypto.randomUUID()}`;

/** 登入憑證：32 bytes 亂數轉 hex，只有客戶端持有明文。 */
const newToken = (): string => toHex(crypto.getRandomValues(new Uint8Array(32)));

/** 開通碼避開容易看錯的 0/O/1/I，方便口述或抄寫。 */
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function newActivationCode(): string {
  const pick = (n: number): string => {
    const bytes = crypto.getRandomValues(new Uint8Array(n));
    return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  };
  return `JUNE-${pick(4)}-${pick(4)}-${pick(4)}`;
}

// ---------------------------------------------------------------------------
// 共用邏輯
// ---------------------------------------------------------------------------

const num = (text: string | undefined, fallback: number): number => {
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

/** 回給客戶端的使用者資料，永遠不含 password_hash。 */
const publicUser = (row: UserRow) => ({
  id: row.id,
  username: row.username,
  displayName: row.display_name,
  role: row.role,
  status: row.status,
  expiresAt: row.expires_at,
  createdAt: row.created_at,
  lastLoginAt: row.last_login_at,
  approvedAt: row.approved_at,
  approvedBy: row.approved_by,
  note: row.note,
});

/** 能不能使用程式：已核准，且沒有到期。 */
const isUsable = (row: UserRow, now: number): boolean =>
  row.status === 'approved' && (row.expires_at === null || row.expires_at > now);

function statusMessage(row: UserRow, now: number): string {
  if (row.status === 'pending') return '帳號尚在等待管理員審核，審核通過後即可使用。';
  if (row.status === 'rejected') return '此帳號的申請已被拒絕，請聯絡管理員。';
  if (row.status === 'disabled') return '此帳號已被停用，請聯絡管理員。';
  if (row.expires_at !== null && row.expires_at <= now) {
    return '使用期限已到期，請向管理員索取新的開通碼或申請延長。';
  }
  return '';
}

const findUserByName = (env: Env, username: string) =>
  env.DB.prepare('SELECT * FROM users WHERE username = ?')
    .bind(username.trim().toLowerCase())
    .first<UserRow>();

const findUserById = (env: Env, id: string) =>
  env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();

interface SessionRow {
  token_hash: string;
  user_id: string;
  expires_at: number;
}

/**
 * 由 token 換回使用者。順手更新 last_seen_at，並在憑證過期時直接刪掉，
 * 這樣 sessions 表不會無限長大。
 */
async function resolveSession(env: Env, token: unknown, now: number): Promise<UserRow | null> {
  if (typeof token !== 'string' || token.length < 32) return null;
  const tokenHash = await sha256Hex(token);
  const session = await env.DB.prepare(
    'SELECT token_hash, user_id, expires_at FROM sessions WHERE token_hash = ?',
  )
    .bind(tokenHash)
    .first<SessionRow>();
  if (!session) return null;
  if (session.expires_at <= now) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
    return null;
  }
  const user = await findUserById(env, session.user_id);
  if (!user) return null;
  await env.DB.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?')
    .bind(now, tokenHash)
    .run();
  return user;
}

/** 管理端 API 的守門：必須是仍可使用的 admin。 */
async function requireAdmin(env: Env, token: unknown, now: number): Promise<UserRow | null> {
  const user = await resolveSession(env, token, now);
  if (!user || user.role !== 'admin' || !isUsable(user, now)) return null;
  return user;
}

/** 把「開通天數」換成到期時間；null / 空值代表永久。 */
function resolveExpiry(days: unknown, from: number): number | null | undefined {
  if (days === null || days === undefined || days === '' || days === 'permanent') return null;
  const value = Number(days);
  if (!Number.isFinite(value) || value <= 0 || value > 36500) return undefined;
  return from + Math.round(value) * 86_400_000;
}

interface CodeRow {
  code: string;
  days: number | null;
  status: 'active' | 'used' | 'revoked';
  created_at: number;
  created_by: string | null;
  used_at: number | null;
  used_by: string | null;
  note: string | null;
}

const publicCode = (row: CodeRow) => ({
  code: row.code,
  days: row.days,
  status: row.status,
  createdAt: row.created_at,
  createdBy: row.created_by,
  usedAt: row.used_at,
  usedBy: row.used_by,
  note: row.note,
});

/**
 * 兌換開通碼：把碼標記為已使用，並依碼上的天數把帳號設為已開通。
 * 已經開通且還沒到期的帳號，天數會從原到期日往後加，不會被砍短。
 */
async function redeemCode(
  env: Env,
  user: UserRow,
  rawCode: unknown,
  now: number,
): Promise<{ ok: true; expiresAt: number | null } | { ok: false; message: string }> {
  if (typeof rawCode !== 'string' || !rawCode.trim()) return { ok: false, message: '請輸入開通碼。' };
  const code = rawCode.trim().toUpperCase();
  const row = await env.DB.prepare('SELECT * FROM codes WHERE code = ?').bind(code).first<CodeRow>();
  if (!row) return { ok: false, message: '開通碼不存在，請確認是否輸入正確。' };
  if (row.status === 'used') return { ok: false, message: '這組開通碼已經被使用過了。' };
  if (row.status === 'revoked') return { ok: false, message: '這組開通碼已被管理員作廢。' };

  const base =
    user.expires_at !== null && user.expires_at > now && user.status === 'approved'
      ? user.expires_at
      : now;
  const expiresAt = row.days === null ? null : base + row.days * 86_400_000;

  // 先鎖定開通碼再改帳號：萬一 code 已被別人搶走，changes 會是 0，帳號就不會被動到。
  const claimed = await env.DB.prepare(
    "UPDATE codes SET status = 'used', used_at = ?, used_by = ? WHERE code = ? AND status = 'active'",
  )
    .bind(now, user.username, code)
    .run();
  if (!claimed.meta.changes) return { ok: false, message: '這組開通碼剛剛已被使用，請再確認。' };

  await env.DB.prepare(
    "UPDATE users SET status = 'approved', expires_at = ?, approved_at = ?, approved_by = ? WHERE id = ?",
  )
    .bind(expiresAt, now, `code:${code}`, user.id)
    .run();
  return { ok: true, expiresAt };
}

// ---------------------------------------------------------------------------
// 公開端點
// ---------------------------------------------------------------------------

type Body = Record<string, unknown>;

function validateCredentials(username: unknown, password: unknown): string | null {
  if (typeof username !== 'string' || username.trim().length < MIN_USERNAME) {
    return `帳號至少要 ${MIN_USERNAME} 個字。`;
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(username.trim())) {
    return '帳號只能使用英文、數字與 _ . - 這幾種符號。';
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
    return `密碼至少要 ${MIN_PASSWORD} 個字。`;
  }
  return null;
}

/** 建立第一個管理員。需要 BOOTSTRAP_TOKEN，且系統裡還沒有任何管理員。 */
async function handleBootstrap(env: Env, request: Request, body: Body): Promise<Response> {
  const provided = request.headers.get('X-Bootstrap-Token') ?? '';
  if (!env.BOOTSTRAP_TOKEN || !timingSafeEqualText(provided, env.BOOTSTRAP_TOKEN)) {
    return fail('BOOTSTRAP_TOKEN 不正確，或尚未設定。');
  }
  const existing = await env.DB.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").first();
  if (existing) return fail('已經有管理員帳號，這個端點只能用一次；請刪除 BOOTSTRAP_TOKEN。');

  const invalid = validateCredentials(body.username, body.password);
  if (invalid) return fail(invalid);

  const username = String(body.username).trim().toLowerCase();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO users (id, username, display_name, password_hash, role, status, expires_at,
                        created_at, approved_at, approved_by)
     VALUES (?, ?, ?, ?, 'admin', 'approved', NULL, ?, ?, 'bootstrap')`,
  )
    .bind(
      newId('usr'),
      username,
      typeof body.displayName === 'string' && body.displayName.trim()
        ? body.displayName.trim()
        : username,
      await hashPassword(String(body.password)),
      now,
      now,
    )
    .run();
  return ok({ message: '管理員帳號已建立，請立刻刪除 BOOTSTRAP_TOKEN。' });
}

/** 註冊。預設為待審核；如果同時填了有效開通碼，就直接開通。 */
async function handleRegister(env: Env, body: Body): Promise<Response> {
  const invalid = validateCredentials(body.username, body.password);
  if (invalid) return fail(invalid);

  const username = String(body.username).trim().toLowerCase();
  if (await findUserByName(env, username)) return fail('這個帳號已經有人使用了，請換一個。');

  const now = Date.now();
  const id = newId('usr');
  await env.DB.prepare(
    `INSERT INTO users (id, username, display_name, password_hash, role, status, expires_at, created_at)
     VALUES (?, ?, ?, ?, 'user', 'pending', NULL, ?)`,
  )
    .bind(
      id,
      username,
      typeof body.displayName === 'string' && body.displayName.trim()
        ? body.displayName.trim()
        : username,
      await hashPassword(String(body.password)),
      now,
    )
    .run();

  const created = await findUserById(env, id);
  if (!created) return fail('建立帳號時發生錯誤，請再試一次。');

  if (typeof body.code === 'string' && body.code.trim()) {
    const redeemed = await redeemCode(env, created, body.code, now);
    if (!redeemed.ok) {
      // 帳號留著（待審核），只告訴他碼有問題，不然他得重新想一組帳號。
      return ok({
        user: publicUser(created),
        message: `帳號已建立，但開通碼無法使用：${redeemed.message}目前狀態為等待管理員審核。`,
      });
    }
    const after = await findUserById(env, id);
    return ok({ user: publicUser(after ?? created), message: '註冊完成，開通碼已生效，可以直接登入。' });
  }

  return ok({ user: publicUser(created), message: '註冊完成，等待管理員審核通過後即可登入。' });
}

/**
 * 登入。管理員必須額外通過 ADMIN_MASTER_KEY（存在 Worker secret，客戶端不再有任何金鑰）。
 * 只有真的可以使用的帳號才會拿到 token，待審核／到期／停用都不發。
 */
async function handleLogin(env: Env, body: Body): Promise<Response> {
  if (typeof body.username !== 'string' || typeof body.password !== 'string') {
    return fail('請輸入帳號與密碼。');
  }
  const now = Date.now();
  const user = await findUserByName(env, body.username);
  // 帳號不存在時也跑一次雜湊，讓「帳號存在」無法用回應時間推測出來。
  if (!user) {
    await hashPassword(body.password);
    return fail('帳號或密碼不正確。');
  }
  if (!(await verifyPassword(body.password, user.password_hash))) {
    return fail('帳號或密碼不正確。');
  }
  if (user.role === 'admin') {
    const key = typeof body.masterKey === 'string' ? body.masterKey : '';
    if (!env.ADMIN_MASTER_KEY || !timingSafeEqualText(key, env.ADMIN_MASTER_KEY)) {
      return fail('管理員金鑰不正確。');
    }
  }
  if (!isUsable(user, now)) return fail(statusMessage(user, now));

  const token = newToken();
  const sessionDays = num(env.SESSION_DAYS, 30);
  // 帳號本身的到期日若比憑證短，憑證就跟著縮短，避免到期後還能靠舊 token 撐一段時間。
  let expiresAt = now + sessionDays * 86_400_000;
  if (user.expires_at !== null && user.expires_at < expiresAt) expiresAt = user.expires_at;

  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(await sha256Hex(token), user.id, now, expiresAt, now),
    env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(now, user.id),
    env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now),
  ]);

  return ok({
    token,
    tokenExpiresAt: expiresAt,
    user: publicUser({ ...user, last_login_at: now }),
    graceDays: num(env.GRACE_DAYS, 7),
  });
}

async function handleLogout(env: Env, body: Body): Promise<Response> {
  if (typeof body.token === 'string') {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?')
      .bind(await sha256Hex(body.token))
      .run();
  }
  return ok();
}

/** 客戶端每次啟動與定期呼叫，用來即時反映停用與到期。 */
async function handleMe(env: Env, body: Body): Promise<Response> {
  const now = Date.now();
  const user = await resolveSession(env, body.token, now);
  if (!user) return json({ success: false, reason: 'invalid_token', message: '登入已失效，請重新登入。' });
  if (!isUsable(user, now)) {
    return json({
      success: false,
      reason: 'not_usable',
      message: statusMessage(user, now),
      user: publicUser(user),
    });
  }
  return ok({ user: publicUser(user), graceDays: num(env.GRACE_DAYS, 7) });
}

/** 已登入（或已註冊但待審核）的人自己輸入開通碼。 */
async function handleRedeem(env: Env, body: Body): Promise<Response> {
  const now = Date.now();
  let user: UserRow | null = null;

  if (typeof body.token === 'string' && body.token) {
    user = await resolveSession(env, body.token, now);
  } else if (typeof body.username === 'string' && typeof body.password === 'string') {
    // 待審核的人拿不到 token，所以允許用帳密直接兌換。
    const candidate = await findUserByName(env, body.username);
    if (candidate && (await verifyPassword(body.password, candidate.password_hash))) user = candidate;
  }
  if (!user) return fail('請先登入，或確認帳號密碼是否正確。');
  if (user.status === 'disabled' || user.status === 'rejected') return fail(statusMessage(user, now));

  const redeemed = await redeemCode(env, user, body.code, now);
  if (!redeemed.ok) return fail(redeemed.message);

  const after = await findUserById(env, user.id);
  return ok({
    user: after ? publicUser(after) : undefined,
    message:
      redeemed.expiresAt === null
        ? '開通成功，此帳號為永久使用。'
        : `開通成功，使用期限到 ${new Date(redeemed.expiresAt).toLocaleDateString('zh-TW')}。`,
  });
}

async function handleChangePassword(env: Env, body: Body): Promise<Response> {
  const now = Date.now();
  const user = await resolveSession(env, body.token, now);
  if (!user) return fail('登入已失效，請重新登入。');
  if (typeof body.currentPassword !== 'string' || !(await verifyPassword(body.currentPassword, user.password_hash))) {
    return fail('目前的密碼不正確。');
  }
  if (typeof body.newPassword !== 'string' || body.newPassword.length < MIN_PASSWORD) {
    return fail(`新密碼至少要 ${MIN_PASSWORD} 個字。`);
  }
  await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .bind(await hashPassword(body.newPassword), user.id)
    .run();
  // 改完密碼把其他裝置踢掉，只留現在這台。
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?')
    .bind(user.id, await sha256Hex(String(body.token)))
    .run();
  return ok({ message: '密碼已更新。' });
}

// ---------------------------------------------------------------------------
// 管理端點（都需要 admin 的 token）
// ---------------------------------------------------------------------------

async function countAdmins(env: Env): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'approved'",
  ).first<{ n: number }>();
  return row?.n ?? 0;
}

async function listUsers(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare('SELECT * FROM users ORDER BY created_at DESC').all<UserRow>();
  return ok({ users: (results ?? []).map(publicUser) });
}

/** 審核通過並同時決定開通多久。days = null 代表永久。 */
async function approveUser(env: Env, admin: UserRow, body: Body, now: number): Promise<Response> {
  const target = typeof body.userId === 'string' ? await findUserById(env, body.userId) : null;
  if (!target) return fail('找不到這個帳號。');
  const expiresAt = resolveExpiry(body.days, now);
  if (expiresAt === undefined) return fail('開通天數必須是 1 到 36500 之間的數字。');

  await env.DB.prepare(
    "UPDATE users SET status = 'approved', expires_at = ?, approved_at = ?, approved_by = ? WHERE id = ?",
  )
    .bind(expiresAt, now, admin.username, target.id)
    .run();
  return ok({ expiresAt });
}

/** 延長或改寫到期日。mode='add' 從原到期日往後加，'set' 從今天重新算。 */
async function extendUser(env: Env, body: Body, now: number): Promise<Response> {
  const target = typeof body.userId === 'string' ? await findUserById(env, body.userId) : null;
  if (!target) return fail('找不到這個帳號。');

  const mode = body.mode === 'set' ? 'set' : 'add';
  const base =
    mode === 'add' && target.expires_at !== null && target.expires_at > now ? target.expires_at : now;
  const expiresAt = resolveExpiry(body.days, base);
  if (expiresAt === undefined) return fail('開通天數必須是 1 到 36500 之間的數字。');

  await env.DB.prepare('UPDATE users SET expires_at = ? WHERE id = ?').bind(expiresAt, target.id).run();
  return ok({ expiresAt });
}

/** 改狀態。停用會順手刪掉該帳號所有 session，所以其他電腦會立刻被登出。 */
async function setUserStatus(env: Env, admin: UserRow, body: Body): Promise<Response> {
  const status = body.status;
  if (status !== 'pending' && status !== 'approved' && status !== 'rejected' && status !== 'disabled') {
    return fail('狀態不正確。');
  }
  const target = typeof body.userId === 'string' ? await findUserById(env, body.userId) : null;
  if (!target) return fail('找不到這個帳號。');
  if (target.id === admin.id && status !== 'approved') return fail('不能把自己停用或退回審核。');
  if (target.role === 'admin' && status !== 'approved' && (await countAdmins(env)) <= 1) {
    return fail('這是唯一的管理員帳號，不能停用。');
  }

  await env.DB.prepare('UPDATE users SET status = ? WHERE id = ?').bind(status, target.id).run();
  if (status !== 'approved') {
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(target.id).run();
  }
  return ok();
}

async function setUserRole(env: Env, admin: UserRow, body: Body): Promise<Response> {
  const role = body.role;
  if (role !== 'admin' && role !== 'user') return fail('身分不正確。');
  const target = typeof body.userId === 'string' ? await findUserById(env, body.userId) : null;
  if (!target) return fail('找不到這個帳號。');
  if (target.id === admin.id && role !== 'admin') return fail('不能把自己降成一般使用者。');
  if (target.role === 'admin' && role === 'user' && (await countAdmins(env)) <= 1) {
    return fail('這是唯一的管理員帳號，不能降級。');
  }

  await env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind(role, target.id).run();
  // 身分變了就重新登入，管理員金鑰的檢查才會在登入時重跑一次。
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(target.id).run();
  return ok();
}

async function resetUserPassword(env: Env, body: Body): Promise<Response> {
  const target = typeof body.userId === 'string' ? await findUserById(env, body.userId) : null;
  if (!target) return fail('找不到這個帳號。');
  if (typeof body.newPassword !== 'string' || body.newPassword.length < MIN_PASSWORD) {
    return fail(`新密碼至少要 ${MIN_PASSWORD} 個字。`);
  }
  await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .bind(await hashPassword(body.newPassword), target.id)
    .run();
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(target.id).run();
  return ok();
}

async function setUserNote(env: Env, body: Body): Promise<Response> {
  if (typeof body.userId !== 'string') return fail('找不到這個帳號。');
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null;
  const result = await env.DB.prepare('UPDATE users SET note = ? WHERE id = ?')
    .bind(note, body.userId)
    .run();
  return result.meta.changes ? ok() : fail('找不到這個帳號。');
}

async function deleteUser(env: Env, admin: UserRow, body: Body): Promise<Response> {
  const target = typeof body.userId === 'string' ? await findUserById(env, body.userId) : null;
  if (!target) return fail('找不到這個帳號。');
  if (target.id === admin.id) return fail('不能刪除自己的帳號。');
  if (target.role === 'admin' && (await countAdmins(env)) <= 1) {
    return fail('這是唯一的管理員帳號，不能刪除。');
  }
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(target.id).run();
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(target.id).run();
  return ok();
}

// --- 開通碼 ---------------------------------------------------------------

async function listCodes(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare('SELECT * FROM codes ORDER BY created_at DESC').all<CodeRow>();
  return ok({ codes: (results ?? []).map(publicCode) });
}

/** 一次可以產生多組同天數的碼，方便先印一批放著發。 */
async function createCodes(env: Env, admin: UserRow, body: Body, now: number): Promise<Response> {
  const days = body.days === null || body.days === undefined || body.days === '' ? null : Number(body.days);
  if (days !== null && (!Number.isFinite(days) || days <= 0 || days > 36500)) {
    return fail('開通天數必須是 1 到 36500 之間的數字，或留空代表永久。');
  }
  const count = Math.min(Math.max(Math.round(Number(body.count) || 1), 1), 50);
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null;

  const created: string[] = [];
  for (let i = 0; i < count; i += 1) {
    // 碰撞機率極低，但還是重試幾次，避免 PRIMARY KEY 衝突整批失敗。
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = newActivationCode();
      try {
        await env.DB.prepare(
          `INSERT INTO codes (code, days, status, created_at, created_by, note)
           VALUES (?, ?, 'active', ?, ?, ?)`,
        )
          .bind(code, days === null ? null : Math.round(days), now, admin.username, note)
          .run();
        created.push(code);
        break;
      } catch {
        if (attempt === 4) return fail('產生開通碼失敗，請再試一次。');
      }
    }
  }

  if (!created.length) return fail('產生開通碼失敗，請再試一次。');

  const { results } = await env.DB.prepare(
    `SELECT * FROM codes WHERE code IN (${created.map(() => '?').join(',')})`,
  )
    .bind(...created)
    .all<CodeRow>();
  return ok({ codes: (results ?? []).map(publicCode) });
}

/** 作廢：碼還沒被用掉就讓它失效，紀錄留著方便日後查。 */
async function revokeCode(env: Env, body: Body): Promise<Response> {
  if (typeof body.code !== 'string') return fail('找不到這組開通碼。');
  const code = body.code.trim().toUpperCase();
  const result = await env.DB.prepare(
    "UPDATE codes SET status = 'revoked' WHERE code = ? AND status = 'active'",
  )
    .bind(code)
    .run();
  return result.meta.changes ? ok() : fail('這組開通碼不存在，或已經被使用／作廢。');
}

async function deleteCode(env: Env, body: Body): Promise<Response> {
  if (typeof body.code !== 'string') return fail('找不到這組開通碼。');
  const result = await env.DB.prepare('DELETE FROM codes WHERE code = ?')
    .bind(body.code.trim().toUpperCase())
    .run();
  return result.meta.changes ? ok() : fail('找不到這組開通碼。');
}

async function handleAdmin(env: Env, path: string, body: Body): Promise<Response> {
  const now = Date.now();
  const admin = await requireAdmin(env, body.token, now);
  if (!admin) return json({ success: false, reason: 'not_admin', message: '需要管理員權限，請重新登入。' });

  switch (path) {
    case '/api/admin/users/list':
      return listUsers(env);
    case '/api/admin/users/approve':
      return approveUser(env, admin, body, now);
    case '/api/admin/users/extend':
      return extendUser(env, body, now);
    case '/api/admin/users/status':
      return setUserStatus(env, admin, body);
    case '/api/admin/users/role':
      return setUserRole(env, admin, body);
    case '/api/admin/users/password':
      return resetUserPassword(env, body);
    case '/api/admin/users/note':
      return setUserNote(env, body);
    case '/api/admin/users/delete':
      return deleteUser(env, admin, body);
    case '/api/admin/codes/list':
      return listCodes(env);
    case '/api/admin/codes/create':
      return createCodes(env, admin, body, now);
    case '/api/admin/codes/revoke':
      return revokeCode(env, body);
    case '/api/admin/codes/delete':
      return deleteCode(env, body);
    default:
      return json({ success: false, message: '不存在的管理端點。' }, 404);
  }
}

// ---------------------------------------------------------------------------
// 路由
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });

    if (path === '/' || path === '/api/health') {
      return json({ success: true, service: 'june-watcher-auth', time: Date.now() });
    }

    if (request.method !== 'POST') {
      return json({ success: false, message: '只接受 POST。' }, 405);
    }

    let body: Body;
    try {
      body = (await request.json()) as Body;
      if (!body || typeof body !== 'object') body = {};
    } catch {
      return fail('請求格式不正確。');
    }

    try {
      if (path.startsWith('/api/admin/')) return await handleAdmin(env, path, body);

      switch (path) {
        case '/api/bootstrap':
          return await handleBootstrap(env, request, body);
        case '/api/register':
          return await handleRegister(env, body);
        case '/api/login':
          return await handleLogin(env, body);
        case '/api/logout':
          return await handleLogout(env, body);
        case '/api/me':
          return await handleMe(env, body);
        case '/api/redeem':
          return await handleRedeem(env, body);
        case '/api/change-password':
          return await handleChangePassword(env, body);
        default:
          return json({ success: false, message: '不存在的端點。' }, 404);
      }
    } catch (error) {
      // 內部錯誤細節只留在 Worker log，不回給客戶端。
      console.error('unhandled error', path, error);
      return json({ success: false, message: '伺服器發生錯誤，請稍後再試。' }, 500);
    }
  },
};
