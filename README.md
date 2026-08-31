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