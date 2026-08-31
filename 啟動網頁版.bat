@echo off
chcp 65001 >nul
title 啟動視窗螢幕圖像偵測與提醒器
echo ========================================================
echo   正在啟動 視窗螢幕圖像偵測與提醒器...
echo ========================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [錯誤] 系統未找到 Node.js！
    echo 請先至 https://nodejs.org/ 下載並安裝 Node.js (LTS 版本)。
    pause
    exit /b 1
)

echo 啟動本機伺服器中...
start http://localhost:3000
call npm run dev
pause
