import { AccentColor, GlobalSettings, ThemeMode } from '../types';
import { DEFAULT_SETTINGS, loadConfigFromStorage } from './storage';

/**
 * 外觀是全 app 唯一會動到 <html> class 的地方，樣式本體在 src/styles/tokens.css：
 * `html.acc-emerald|acc-indigo|acc-blue|acc-graphite` 決定顏色，`html.light` 決定深淺。
 * 圓角、密度、材質、圖示是定案值，直接寫死在代幣層，不做成設定。
 */

/** 選項的順序＝設定視窗裡按鈕的順序。swatch 是按鈕上那顆小色塊，取每組最飽和的那個色。 */
export const ACCENT_OPTIONS: { id: AccentColor; label: string; swatch: string }[] = [
  { id: 'emerald', label: '綠', swatch: '#10b981' },
  { id: 'indigo', label: '紫', swatch: '#5e6ad2' },
  { id: 'blue', label: '藍', swatch: '#0a84ff' },
  { id: 'graphite', label: '灰', swatch: '#8a8f98' },
];

export const THEME_OPTIONS: { id: ThemeMode; label: string }[] = [
  { id: 'dark', label: '深色' },
  { id: 'light', label: '淺色' },
];

/**
 * Windows 原生視窗按鈕（縮小／放大／關閉）不吃 CSS，只能把顏色交給主行程。
 * 這兩組值必須跟 tokens.css 的 --bg 與 --dim 一致，換深淺時整條標題列才不會分成兩色。
 */
export const TITLEBAR_OVERLAY: Record<ThemeMode, { color: string; symbolColor: string }> = {
  dark: { color: '#08090a', symbolColor: '#9ca3ad' },
  light: { color: '#f4f4f6', symbolColor: '#4a4f57' },
};

/** 設定檔可能是手改過的舊檔，認不出來的值一律退回預設，不要把 acc-<亂碼> 掛到 html 上。 */
export function normalizeAccent(value: unknown): AccentColor {
  return ACCENT_OPTIONS.some((o) => o.id === value)
    ? (value as AccentColor)
    : DEFAULT_SETTINGS.accent;
}

export function normalizeTheme(value: unknown): ThemeMode {
  return THEME_OPTIONS.some((o) => o.id === value) ? (value as ThemeMode) : DEFAULT_SETTINGS.theme;
}

/**
 * 把顏色與深淺套到 <html>。可以重複呼叫（每次都先清掉四個 acc-*），
 * 因為只留一個 class 是必要條件：兩組同時掛著的話贏的是 tokens.css 裡寫在後面的那組，
 * 跟使用者選的無關。
 */
export function applyAppearance(accent: unknown, theme: unknown): void {
  const acc = normalizeAccent(accent);
  const mode = normalizeTheme(theme);
  const root = document.documentElement;

  for (const option of ACCENT_OPTIONS) {
    root.classList.toggle(`acc-${option.id}`, option.id === acc);
  }
  root.classList.toggle('light', mode === 'light');

  // 沒有原生標題列的視窗（浮動視窗、浮動計時器）呼叫這個會被主行程忽略，不必在這裡分辨。
  window.electronAPI?.setTitleBarOverlay?.(TITLEBAR_OVERLAY[mode]);
}

/**
 * 開機時（main.tsx，畫面還沒畫出來之前）用的。這裡多讀一次設定檔是刻意的：
 * 換成淺色的人如果等到 App 掛載後才套，會先閃一下深色。
 * 只有 App 內的設定變更走 props/state，不再回頭讀這裡。
 */
export function readStoredAppearance(): Pick<GlobalSettings, 'accent' | 'theme'> {
  try {
    const { settings } = loadConfigFromStorage();
    return { accent: normalizeAccent(settings.accent), theme: normalizeTheme(settings.theme) };
  } catch {
    return { accent: DEFAULT_SETTINGS.accent, theme: DEFAULT_SETTINGS.theme };
  }
}
