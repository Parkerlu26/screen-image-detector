@echo off
chcp 65001 >nul
title 視窗螢幕圖像偵測與提醒器 - 一鍵打包工具
echo ========================================================
echo   視窗螢幕圖像偵測與提醒器 - Windows EXE 自動打包工具
echo ========================================================
echo.

echo [1/3] 檢查 Node.js 環境...
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [錯誤] 系統未找到 Node.js！
    echo 請先至 https://nodejs.org/ 下載並安裝 Node.js (LTS 版本) 後再執行此腳本。
    echo.
    pause
    exit /b 1
)

echo [2/3] 正在安裝與檢查依賴套件 (npm install)...
call npm install
if %errorlevel% neq 0 (
    echo [錯誤] 套件安裝失敗，請檢查網路連線。
    pause
    exit /b 1
)

echo.
echo [3/3] 正在編譯前端並封裝為 Windows EXE 執行檔...
echo 此過程需耗時約 1~2 分鐘，請稍候...
call npm run build:portable
if %errorlevel% neq 0 (
    echo.
    echo 正在嘗試標準封裝模式...
    call npm run build:exe
)

if %errorlevel% equ 0 (
    echo.
    echo ========================================================
    echo   [成功] EXE 打包完成！
    echo   檔案已輸出至 release 資料夾。
    echo ========================================================
    echo.
    if exist release (
        explorer release
    )
) else (
    echo.
    echo [錯誤] 打包過程發生錯誤，請檢查上方提示訊息。
)

echo.
pause
