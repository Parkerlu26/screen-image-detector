-- 六月幫你顧 帳號與授權資料表 (Cloudflare D1 / SQLite)
--
-- 全新啟用，不從舊版 localStorage 匯入任何資料 —— 所有使用者都必須重新註冊。

DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS codes;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  -- 一律以小寫存放，登入時也轉小寫比對，避免同名帳號用大小寫繞過唯一性。
  username      TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  -- pbkdf2$<iterations>$<salt_b64>$<hash_b64>，永不存放明文密碼。
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',     -- 'admin' | 'user'
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected | disabled
  -- NULL 代表永久開通；否則為到期時間 (epoch ms)。
  expires_at    INTEGER,
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER,
  approved_at   INTEGER,
  approved_by   TEXT,
  note          TEXT
);

CREATE TABLE codes (
  -- 例如 JUNE-7K3M-P2QX-9WD4，一律大寫。
  code       TEXT PRIMARY KEY,
  -- NULL 代表這組碼開通後為永久。
  days       INTEGER,
  status     TEXT NOT NULL DEFAULT 'active',  -- active | used | revoked
  created_at INTEGER NOT NULL,
  created_by TEXT,
  used_at    INTEGER,
  used_by    TEXT,
  note       TEXT
);

CREATE TABLE sessions (
  -- 只存 token 的 SHA-256，資料庫外流也無法直接冒用登入。
  token_hash   TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  last_seen_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_sessions_user    ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
CREATE INDEX idx_users_status     ON users(status);
CREATE INDEX idx_codes_status     ON codes(status);
