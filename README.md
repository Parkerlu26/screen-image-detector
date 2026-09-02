# 視窗螢幕圖像偵測與提醒器 (Screen Image Detector & Alert)

一個具備即時視窗螢幕擷取、自選截圖目標、獨立相似度/冷卻時間設定、即時辨識框標註與多元聲音提示的桌面/網頁工具。

---

## 🛠️ 如何打包成 Windows `.exe` 獨立執行檔

專案已內建完整的 **Electron + Electron Builder** 自動封裝系統：

### 方法一：點擊一鍵批次檔（最簡單）
1. 在本專案資料夾內，直接**連按兩下執行 `打包成EXE.bat`**。
2. 程式會自動檢查環境、編譯前端並完成打包。
3. 完成後會自動打開 `release` 資料夾，裡面的 `.exe`（免安裝綠色版或安裝檔）即可直接傳給任何人使用！

### 方法二：透過命令列打包
開啟 PowerShell 或 CMD 終端機：
```powershell
# 1. 安裝套件
npm install

# 2. 打包為免安裝獨立執行檔 (.exe)
npm run build:portable

# 或打包為標準安裝檔 (.exe)
npm run build:exe
```
打包完成後檔案會位於 `release/` 目錄中。

---

## 🚀 日常開發與本機執行

- **網頁版快速啟動**：點擊 `啟動網頁版.bat` 或執行 `npm run dev`，瀏覽器開啟 `http://localhost:3000`。
- **桌面版除錯模式**：執行 `npm run electron:dev`。

---

## 🔐 帳號系統（`server/`）

帳號是雲端帳號，同一組帳密可以在不同電腦登入。後端是一支 Cloudflare Worker 搭配 D1 資料庫，
原始碼在 `server/`，部署步驟見 [`server/部署說明.md`](server/部署說明.md)。

- 使用者自行註冊後需經管理員開通，或直接輸入管理員發出的開通碼自助開通與續期。
- 開通期限可選 7 / 30 / 90 / 365 天或永久，也可自訂天數；停用帳號後所有裝置會立刻失效。
- 管理員金鑰與 bootstrap token 只存在 Cloudflare 的 secret 裡，程式碼與打包檔中都不含任何機密。
- 程式啟動時會讀取 exe 旁邊的 `api-server.txt` 取得後端網址，換伺服器不需要重新打包；
  也可以在 `.env` 設定 `VITE_API_BASE` 在打包時寫進程式（見 `.env.example`）。