/**
 * Vite 在建置時把 `VITE_` 開頭的環境變數注入 `import.meta.env`。
 * 專案的 tsconfig 沒有引入 vite/client，所以在這裡自己補上型別。
 */
interface ImportMetaEnv {
  /** 帳號後端網址，例如 https://june-watcher-auth.xxx.workers.dev */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
