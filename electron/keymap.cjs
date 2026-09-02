// 快捷鍵名稱 → Windows 虛擬鍵碼（Virtual-Key Code）。
//
// 這裡的鍵名必須跟 src/utils/hotkeys.ts 的 normalizeHotkeyName() 產生的字串完全一致：
// 側錄端存下什麼名字，這裡就得認得什麼名字。對不到的話 getVkCode() 回 null，
// 主程序就不會把那顆鍵加進監看清單，使用者按下去完全沒有反應 —— v1.4.0 之前
// 「計時器設 Delete 就不會開始」正是這個原因（VK_MAP 裡只有 A–Z、0–9、F1–F12、
// 空白、Tab、Shift、Ctrl、Alt，其餘全部落空）。
//
// scratch/keymaptest.mts 會把整塊實體鍵盤走一遍，強制兩邊對齊，跑法：
//   npx tsx scratch/keymaptest.mts
//
// 注意 GetAsyncKeyState 是用虛擬鍵碼問狀態，而 Windows 有幾組實體按鍵共用同一個碼：
// 左右 Shift/Ctrl/Alt 都是 0x10/0x11/0x12，數字鍵台的 Enter 跟主 Enter 都是 0x0D
// （差別只在擴充鍵旗標，這個 API 拿不到）。所以綁 NUMENTER 的計時器按主 Enter 也會觸發。
const VK_MAP = {
  // 主鍵盤字母、數字
  A: 0x41, B: 0x42, C: 0x43, D: 0x44, E: 0x45, F: 0x46, G: 0x47, H: 0x48, I: 0x49,
  J: 0x4a, K: 0x4b, L: 0x4c, M: 0x4d, N: 0x4e, O: 0x4f, P: 0x50, Q: 0x51, R: 0x52,
  S: 0x53, T: 0x54, U: 0x55, V: 0x56, W: 0x57, X: 0x58, Y: 0x59, Z: 0x5a,
  0: 0x30, 1: 0x31, 2: 0x32, 3: 0x33, 4: 0x34, 5: 0x35, 6: 0x36, 7: 0x37, 8: 0x38, 9: 0x39,

  // 功能鍵（F13–F24 只有部分鍵盤有，但對應上不花成本）
  F1: 0x70, F2: 0x71, F3: 0x72, F4: 0x73, F5: 0x74, F6: 0x75, F7: 0x76, F8: 0x77,
  F9: 0x78, F10: 0x79, F11: 0x7a, F12: 0x7b, F13: 0x7c, F14: 0x7d, F15: 0x7e, F16: 0x7f,
  F17: 0x80, F18: 0x81, F19: 0x82, F20: 0x83, F21: 0x84, F22: 0x85, F23: 0x86, F24: 0x87,

  // 修飾鍵與開關鍵
  SHIFT: 0x10, CONTROL: 0x11, ALT: 0x12, META: 0x5b, CONTEXTMENU: 0x5d,
  CAPSLOCK: 0x14, NUMLOCK: 0x90, SCROLLLOCK: 0x91,

  // 編輯與移動鍵 —— 這一整區以前全部對不到
  SPACE: 0x20, TAB: 0x09, ENTER: 0x0d, BACKSPACE: 0x08, ESCAPE: 0x1b,
  DELETE: 0x2e, INSERT: 0x2d, HOME: 0x24, END: 0x23, PAGEUP: 0x21, PAGEDOWN: 0x22,
  ARROWUP: 0x26, ARROWDOWN: 0x28, ARROWLEFT: 0x25, ARROWRIGHT: 0x27,
  PRINTSCREEN: 0x2c, PAUSE: 0x13,

  // 數字鍵台。跟主鍵盤的數字、標點是不同的實體按鍵，虛擬鍵碼也不同，
  // 所以名字前面一律帶 NUM，不能混用。
  NUM0: 0x60, NUM1: 0x61, NUM2: 0x62, NUM3: 0x63, NUM4: 0x64,
  NUM5: 0x65, NUM6: 0x66, NUM7: 0x67, NUM8: 0x68, NUM9: 0x69,
  NUMMULTIPLY: 0x6a, NUMADD: 0x6b, NUMSUBTRACT: 0x6d, NUMDECIMAL: 0x6e,
  NUMDIVIDE: 0x6f, NUMENTER: 0x0d, NUMCOMMA: 0x6c,

  // 主鍵盤區標點。這一組以前是「看起來有效、其實對到別人」：舊版對長度 1 的名字
  // 直接拿字碼當虛擬鍵，'.' 的 46 剛好是 VK_DELETE、"'" 的 39 是方向鍵右、
  // '[' 的 91 是左 Win，所以綁這些鍵的計時器會被完全不同的按鍵觸發。
  // 正確答案是 OEM 系列，跟字碼無關。
  '`': 0xc0, '-': 0xbd, '=': 0xbb, '[': 0xdb, ']': 0xdd, '\\': 0xdc,
  ';': 0xba, "'": 0xde, ',': 0xbc, '.': 0xbe, '/': 0xbf,
  // ISO 鍵盤左 Shift 旁邊多出來的那顆（VK_OEM_102）。ANSI／台灣鍵盤沒有這顆，
  // 但側錄拿到的 e.code 是 'IntlBackslash'，列進來就不會白白對不到。
  INTLBACKSLASH: 0xe2,
  // 按住 Shift 側錄時 e.key 會是上排字元，指向同一顆實體按鍵
  '~': 0xc0, _: 0xbd, '+': 0xbb, '{': 0xdb, '}': 0xdd, '|': 0xdc,
  ':': 0xba, '"': 0xde, '<': 0xbc, '>': 0xbe, '?': 0xbf,

  // 多媒體與瀏覽器鍵：鍵盤上真的有，e.key 就是這些字
  AUDIOVOLUMEMUTE: 0xad, AUDIOVOLUMEDOWN: 0xae, AUDIOVOLUMEUP: 0xaf,
  MEDIATRACKNEXT: 0xb0, MEDIATRACKPREVIOUS: 0xb1, MEDIASTOP: 0xb2, MEDIAPLAYPAUSE: 0xb3,
  BROWSERBACK: 0xa6, BROWSERFORWARD: 0xa7, BROWSERREFRESH: 0xa8, BROWSERSTOP: 0xa9,
  BROWSERSEARCH: 0xaa, BROWSERFAVORITES: 0xab, BROWSERHOME: 0xac,
};

/**
 * 回傳這個快捷鍵名稱對應的虛擬鍵碼，對不到就回 null。
 *
 * 刻意沒有後備。舊版是 `if (upper.length === 1) return upper.charCodeAt(0)`，
 * 那讓每一個沒列進表裡的標點都偷偷對到某顆真實存在的鍵（見上面標點那一段），
 * 表面上註冊成功，實際上監看的是別人。對不到就明確失敗，讓呼叫端知道。
 */
function getVkCode(key) {
  if (typeof key !== 'string') return null;
  const upper = key.trim().toUpperCase();
  if (!upper) return null;
  // 用 hasOwnProperty 而不是直接取值：'CONSTRUCTOR'、'TOSTRING' 這類名字
  // 從原型鏈上拿得到東西，不該被當成有效的虛擬鍵。
  if (!Object.prototype.hasOwnProperty.call(VK_MAP, upper)) return null;
  const vk = VK_MAP[upper];
  return typeof vk === 'number' ? vk : null;
}

module.exports = { VK_MAP, getVkCode };
