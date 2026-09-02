/**
 * 快捷鍵名稱的唯一產生處。
 *
 * 計時器側錄、條件觸發側錄、以及視窗內的 keydown 觸發，過去各自寫了一份
 * 「這顆鍵叫什麼」的邏輯（前兩份逐字相同，第三份直接用 e.key），結果同一顆鍵
 * 在不同路徑會得到不同名字。名字要對得上儲存的值才會觸發，所以三邊必須共用這裡。
 *
 * 產生出來的名字必須是 electron/keymap.cjs 的 VK_MAP 認得的字串，否則主程序
 * 無法把那顆鍵加進監看清單 —— 使用者按下去不會有任何反應。
 * scratch/keymaptest.mts 會走完整塊鍵盤，強制兩邊一致。
 *
 * 一律先看 e.code（實體位置），對不到才退回 e.key。理由是輸入法：
 * 新注音開著的時候，被輸入法吃掉的按鍵 e.key 會變成 'Process'，於是
 * 「Delete」會被側錄成 'PROCESS' 這種對不到任何按鍵的名字，跟修好前一樣不會觸發。
 * e.code 是實體按鍵位置，跟輸入法、鍵盤配置、Shift 狀態都無關。
 * 這也順便讓 Shift 一起按時不會變成上排字元（'/' 不會變 '?'）。
 */

// e.code → 快捷鍵名稱。字母（KeyA）、數字（Digit1）、數字鍵台（Numpad4）、
// 功能鍵（F1，code 與 key 同字）都有規則可循，不列在這裡。
// 左右成對的修飾鍵刻意收斂成同一個名字：Windows 的 GetAsyncKeyState 用的是
// VK_SHIFT/VK_CONTROL/VK_MENU，本來就分不出左右，分開命名只會做出一個
// 「顯示綁了右 Shift、其實左右都會觸發」的假承諾。
const CODE_TO_NAME: Record<string, string> = {
  Space: 'SPACE',
  Enter: 'ENTER',
  Tab: 'TAB',
  Backspace: 'BACKSPACE',
  Escape: 'ESCAPE',
  Delete: 'DELETE',
  Insert: 'INSERT',
  Home: 'HOME',
  End: 'END',
  PageUp: 'PAGEUP',
  PageDown: 'PAGEDOWN',
  ArrowUp: 'ARROWUP',
  ArrowDown: 'ARROWDOWN',
  ArrowLeft: 'ARROWLEFT',
  ArrowRight: 'ARROWRIGHT',
  CapsLock: 'CAPSLOCK',
  NumLock: 'NUMLOCK',
  ScrollLock: 'SCROLLLOCK',
  PrintScreen: 'PRINTSCREEN',
  Pause: 'PAUSE',
  ContextMenu: 'CONTEXTMENU',
  ShiftLeft: 'SHIFT',
  ShiftRight: 'SHIFT',
  ControlLeft: 'CONTROL',
  ControlRight: 'CONTROL',
  AltLeft: 'ALT',
  AltRight: 'ALT',
  MetaLeft: 'META',
  MetaRight: 'META',
  // 主鍵盤區標點。名字用鍵面上未按 Shift 的那個字元，跟 VK_MAP 的 OEM 那一組對應。
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
};

// 輸入法把按鍵吃掉時 e.key 會變成這些佔位字（新注音是 'Process'），它們不是任何一顆
// 實體按鍵。只有在瀏覽器連 e.code 都沒給的時候才會落到它們身上，這時候唯一誠實的答案
// 是「這一下不算」，不能存成 'PROCESS' —— 那是一個註冊得起來、卻永遠不會被按到的名字。
const IME_PLACEHOLDERS = new Set(['PROCESS', 'UNIDENTIFIED', 'DEAD']);

/**
 * 回傳這顆按鍵的快捷鍵名稱；認不出來就回空字串（呼叫端要當成沒按）。
 */
export function normalizeHotkeyName(e: Pick<KeyboardEvent, 'key' | 'code'>): string {
  const code = e.code || '';

  if (code.startsWith('Key')) return code.slice(3).toUpperCase();
  if (code.startsWith('Digit')) return code.slice(5);
  // 數字鍵台跟主鍵盤是不同的實體按鍵（虛擬鍵碼也不同），名字必須分得開。
  // NumpadEnter 也走這條，得到 'NUMENTER'。
  if (code.startsWith('Numpad')) return 'NUM' + code.slice(6).toUpperCase();
  if (CODE_TO_NAME[code]) return CODE_TO_NAME[code];
  // F1–F24 的 code 與 key 同字；多媒體鍵的 code 也是可直接大寫的英文名。
  if (code) return code.toUpperCase();

  // 走到這裡表示瀏覽器沒給 code（虛擬鍵盤、部分遠端桌面工具）。
  if (e.key === ' ') return 'SPACE';
  const fromKey = (e.key || '').toUpperCase();
  return IME_PLACEHOLDERS.has(fromKey) ? '' : fromKey;
}
