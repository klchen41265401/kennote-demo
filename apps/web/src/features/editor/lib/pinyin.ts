/**
 * 極簡「拼音首字母」表。
 *
 * 目的只有一個：讓 `/cs` 找得到「程式碼」、`/bt` 找得到「標題 1」、
 * `/zlk` 找得到「資料庫」——也就是 slash menu 的第三種輸入法。
 *
 * 為什麼不裝 pinyin 套件：不加 runtime 依賴是硬性紀律（README §6）。
 * 需要的字不多（只有 `/` 選單會出現的那些），所以直接列表；
 * 查不到的字一律**略過**（回空字串），絕不猜測——猜錯會讓搜尋出現莫名其妙的結果。
 *
 * 維護方式：新增選單項目時如果它的字不在表裡，`__tests__/slash.test.ts`
 * 的「所有中文標籤都有拼音首字母」會直接失敗，照著補一行即可。
 */

/** 首字母 → 該字母底下的所有字（比一字一行好維護，也好檢查有沒有重複） */
const GROUPS: Record<string, string> = {
  a: '案按',
  b: '標表編辦板背本筆閉步不必',
  c: '程長垂成除詞',
  d: '待疊到單動地的檔多大代第度',
  f: '符分方複粉法',
  g: '格隔關公共規',
  h: '號和環或行換灰紅話回匯畫黃',
  j: '結及間徑建階進基記景橘劇腳件',
  k: '看庫塊開',
  l: '列連瀏覽曆來料欄錄藍綠立路例類',
  m: '目模面媒密碼',
  n: '內鈕',
  p: '片平盤排品',
  q: '清區期情前全嵌籤',
  r: '人日入',
  s: '式時水數色設刪事書手術',
  t: '題圖條態同提體推統',
  w: '文網萬問位',
  x: '項線形新醒寫訊學選細',
  y: '頁引用影音員源儀圓預顏移顏',
  z: '字摺軸直折資整轉製紫註棕作子',
};

const MAP = new Map<string, string>();
for (const [initial, chars] of Object.entries(GROUPS)) {
  for (const char of chars) {
    if (!MAP.has(char)) MAP.set(char, initial);
  }
}

/** 單一漢字的拼音首字母；查不到回 '' */
export function pinyinInitial(char: string): string {
  return MAP.get(char) ?? '';
}

/**
 * 一段中文 → 首字母字串。
 * 「程式碼」→ `csm`；非漢字（數字 / 英文 / 空白）一律略過。
 * 只要其中**有一個字查不到**就回 ''（寧可沒有關鍵字，也不要半截錯的關鍵字）。
 */
export function pinyinInitials(text: string): string {
  let out = '';
  let sawHan = false;
  for (const char of text) {
    if (!/[一-鿿]/.test(char)) continue;
    sawHan = true;
    const initial = MAP.get(char);
    if (!initial) return '';
    out += initial;
  }
  return sawHan ? out : '';
}

/** 給測試用：某段文字裡有哪些漢字還沒收錄 */
export function missingPinyinChars(text: string): string[] {
  const out: string[] = [];
  for (const char of text) {
    if (!/[一-鿿]/.test(char)) continue;
    if (!MAP.has(char)) out.push(char);
  }
  return out;
}
