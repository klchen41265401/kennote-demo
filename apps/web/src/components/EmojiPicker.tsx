/**
 * 自建 Emoji 選擇器（不裝任何 emoji 套件）。
 *
 * 資料表是精簡版的 Unicode emoji：每一筆 `[emoji, 關鍵字…]`，中英文都放，
 * 所以「笑」「smile」「哭」「fire」都搜得到。
 * 最近使用存 localStorage（純本機 UI 狀態，不進同步）。
 *
 * 完整的 emoji 資料（3000+ 筆）沒有必要打包進前端；需要更多時
 * 在 EMOJI_DATA 加一行即可，UI 一行都不用改。
 */
import { useEffect, useMemo, useRef, useState } from 'react';

export interface EmojiCategory {
  id: string;
  label: string;
  tabIcon: string;
  items: [string, ...string[]][];
}

export const EMOJI_DATA: EmojiCategory[] = [
  {
    id: 'smileys',
    label: '表情與人物',
    tabIcon: '😀',
    items: [
      ['😀', 'grin', 'smile', '笑', '開心'],
      ['😃', 'smiley', 'happy', '笑', '高興'],
      ['😄', 'smile', 'happy', '大笑'],
      ['😁', 'beam', 'grin', '露齒笑'],
      ['😆', 'laugh', 'satisfied', '大笑'],
      ['😅', 'sweat', 'laugh', '苦笑', '汗'],
      ['🤣', 'rofl', 'laugh', '爆笑'],
      ['😂', 'joy', 'tears', '笑哭'],
      ['🙂', 'slight', 'smile', '微笑'],
      ['🙃', 'upside', '倒臉'],
      ['😉', 'wink', '眨眼'],
      ['😊', 'blush', 'smile', '害羞'],
      ['😇', 'innocent', 'angel', '天使'],
      ['🥰', 'love', 'hearts', '愛心'],
      ['😍', 'heart eyes', '花痴', '愛'],
      ['😘', 'kiss', '飛吻'],
      ['😋', 'yum', 'tasty', '好吃'],
      ['😎', 'cool', 'sunglasses', '酷'],
      ['🤓', 'nerd', '書呆'],
      ['🧐', 'monocle', '思考'],
      ['🤔', 'thinking', '思考', '想'],
      ['🤨', 'raised eyebrow', '疑惑'],
      ['😐', 'neutral', '面無表情'],
      ['😴', 'sleep', 'zzz', '睡'],
      ['😢', 'cry', 'sad', '哭', '難過'],
      ['😭', 'sob', 'cry', '大哭'],
      ['😤', 'triumph', '生氣'],
      ['😡', 'angry', 'rage', '生氣', '憤怒'],
      ['🥳', 'party', 'celebrate', '慶祝'],
      ['🤯', 'mind blown', '爆炸', '震驚'],
      ['😱', 'scream', '尖叫', '驚恐'],
      ['🤗', 'hug', '擁抱'],
      ['🤝', 'handshake', '握手', '合作'],
      ['👍', 'thumbs up', 'like', '讚', '好'],
      ['👎', 'thumbs down', 'dislike', '爛'],
      ['👏', 'clap', '鼓掌'],
      ['🙏', 'pray', 'thanks', '拜託', '感謝'],
      ['💪', 'muscle', 'strong', '加油', '肌肉'],
      ['✌️', 'victory', 'peace', '勝利'],
      ['👋', 'wave', 'hello', '揮手', '嗨'],
      ['🫶', 'heart hands', '比愛心'],
      ['👀', 'eyes', 'look', '看'],
      ['🧠', 'brain', '腦', '思考'],
      ['👤', 'person', 'user', '人', '使用者'],
      ['👥', 'people', 'team', '團隊'],
    ],
  },
  {
    id: 'objects',
    label: '物件與工作',
    tabIcon: '📌',
    items: [
      ['📄', 'page', 'document', '文件', '頁面'],
      ['📃', 'note', 'page', '筆記'],
      ['📝', 'memo', 'write', '備忘', '寫'],
      ['📋', 'clipboard', 'list', '清單', '剪貼簿'],
      ['📁', 'folder', '資料夾'],
      ['📂', 'open folder', '開啟資料夾'],
      ['🗂️', 'dividers', '分類'],
      ['📊', 'bar chart', '圖表', '統計'],
      ['📈', 'chart up', '成長', '上升'],
      ['📉', 'chart down', '下降'],
      ['📌', 'pin', '釘選', '重要'],
      ['📎', 'paperclip', '附件', '迴紋針'],
      ['🔖', 'bookmark', '書籤'],
      ['🏷️', 'label', 'tag', '標籤'],
      ['📅', 'calendar', 'date', '日曆', '日期'],
      ['📆', 'calendar', 'schedule', '行事曆'],
      ['⏰', 'alarm', 'clock', '鬧鐘', '時間'],
      ['⏳', 'hourglass', '等待', '沙漏'],
      ['🔍', 'search', 'magnify', '搜尋', '放大鏡'],
      ['🔑', 'key', '鑰匙', '密碼'],
      ['🔒', 'lock', 'private', '鎖', '私密'],
      ['🔓', 'unlock', '解鎖'],
      ['💡', 'idea', 'bulb', '想法', '燈泡', '提示'],
      ['🔔', 'bell', 'notify', '通知', '鈴鐺'],
      ['📣', 'megaphone', 'announce', '公告', '喇叭'],
      ['✉️', 'mail', 'email', '信件', '郵件'],
      ['📞', 'phone', 'call', '電話'],
      ['💻', 'laptop', 'computer', '電腦', '筆電'],
      ['🖥️', 'desktop', '桌機', '螢幕'],
      ['📱', 'mobile', 'phone', '手機'],
      ['⌨️', 'keyboard', '鍵盤'],
      ['🖨️', 'printer', '印表機'],
      ['💾', 'save', 'floppy', '儲存', '磁碟'],
      ['🗑️', 'trash', 'delete', '垃圾桶', '刪除'],
      ['🧰', 'toolbox', '工具箱'],
      ['🔧', 'wrench', 'tool', '扳手', '工具'],
      ['⚙️', 'gear', 'settings', '設定', '齒輪'],
      ['🧪', 'test', 'lab', '測試', '實驗'],
      ['🧱', 'brick', 'block', '磚', '區塊'],
      ['📦', 'package', 'box', '套件', '箱子'],
    ],
  },
  {
    id: 'symbols',
    label: '符號與狀態',
    tabIcon: '✅',
    items: [
      ['✅', 'check', 'done', '完成', '勾'],
      ['☑️', 'checkbox', '核取'],
      ['❌', 'cross', 'no', '錯誤', '叉'],
      ['⛔', 'forbidden', '禁止'],
      ['⚠️', 'warning', 'caution', '警告', '注意'],
      ['❗', 'exclamation', '驚嘆號', '重要'],
      ['❓', 'question', '問號', '疑問'],
      ['💬', 'speech', 'comment', '留言', '對話'],
      ['💭', 'thought', '想法'],
      ['🔥', 'fire', 'hot', '火', '熱門'],
      ['⭐', 'star', 'favorite', '星', '收藏'],
      ['🌟', 'glowing star', '閃亮'],
      ['✨', 'sparkles', 'magic', '閃亮', '魔法', 'ai'],
      ['⚡', 'zap', 'fast', '閃電', '快'],
      ['🎯', 'target', 'goal', '目標', '靶'],
      ['🚀', 'rocket', 'launch', '火箭', '上線'],
      ['🏆', 'trophy', 'win', '獎盃', '冠軍'],
      ['🎉', 'tada', 'party', '慶祝', '禮花'],
      ['💯', 'hundred', 'perfect', '滿分'],
      ['❤️', 'heart', 'love', '愛心', '紅心'],
      ['🧡', 'orange heart', '橘心'],
      ['💙', 'blue heart', '藍心'],
      ['💚', 'green heart', '綠心'],
      ['💜', 'purple heart', '紫心'],
      ['🖤', 'black heart', '黑心'],
      ['🔴', 'red circle', '紅點'],
      ['🟠', 'orange circle', '橘點'],
      ['🟡', 'yellow circle', '黃點'],
      ['🟢', 'green circle', '綠點'],
      ['🔵', 'blue circle', '藍點'],
      ['🟣', 'purple circle', '紫點'],
      ['⚪', 'white circle', '白點'],
      ['⚫', 'black circle', '黑點'],
      ['➡️', 'right arrow', '右箭頭'],
      ['⬅️', 'left arrow', '左箭頭'],
      ['⬆️', 'up arrow', '上箭頭'],
      ['⬇️', 'down arrow', '下箭頭'],
      ['🔁', 'repeat', 'loop', '循環', '重複'],
      ['♾️', 'infinity', '無限'],
      ['🆕', 'new', '新'],
    ],
  },
  {
    id: 'nature',
    label: '自然與動物',
    tabIcon: '🌱',
    items: [
      ['🌱', 'seedling', 'grow', '幼苗', '成長'],
      ['🌲', 'tree', '樹'],
      ['🌳', 'tree', '大樹'],
      ['🌴', 'palm', '棕櫚'],
      ['🌵', 'cactus', '仙人掌'],
      ['🌷', 'tulip', '鬱金香'],
      ['🌸', 'blossom', 'sakura', '櫻花'],
      ['🌹', 'rose', '玫瑰'],
      ['🌻', 'sunflower', '向日葵'],
      ['🍀', 'clover', 'luck', '幸運草'],
      ['🍁', 'maple', '楓葉'],
      ['🌊', 'wave', 'ocean', '海浪'],
      ['🌈', 'rainbow', '彩虹'],
      ['☀️', 'sun', '太陽', '晴'],
      ['🌤️', 'partly sunny', '多雲'],
      ['☁️', 'cloud', '雲'],
      ['🌧️', 'rain', '雨'],
      ['❄️', 'snow', '雪'],
      ['🌙', 'moon', '月'],
      ['🌍', 'earth', 'world', '地球', '世界'],
      ['🐶', 'dog', '狗'],
      ['🐱', 'cat', '貓'],
      ['🐭', 'mouse', '老鼠'],
      ['🐰', 'rabbit', '兔'],
      ['🦊', 'fox', '狐狸'],
      ['🐻', 'bear', '熊'],
      ['🐼', 'panda', '貓熊'],
      ['🐨', 'koala', '無尾熊'],
      ['🐯', 'tiger', '老虎'],
      ['🦁', 'lion', '獅子'],
      ['🐮', 'cow', '牛'],
      ['🐷', 'pig', '豬'],
      ['🐸', 'frog', '青蛙'],
      ['🐵', 'monkey', '猴'],
      ['🐔', 'chicken', '雞'],
      ['🐧', 'penguin', '企鵝'],
      ['🐦', 'bird', '鳥'],
      ['🦄', 'unicorn', '獨角獸'],
      ['🐝', 'bee', '蜜蜂'],
      ['🦋', 'butterfly', '蝴蝶'],
    ],
  },
  {
    id: 'food',
    label: '食物與飲料',
    tabIcon: '🍎',
    items: [
      ['🍎', 'apple', '蘋果'],
      ['🍊', 'orange', '橘子'],
      ['🍋', 'lemon', '檸檬'],
      ['🍌', 'banana', '香蕉'],
      ['🍉', 'watermelon', '西瓜'],
      ['🍇', 'grapes', '葡萄'],
      ['🍓', 'strawberry', '草莓'],
      ['🥑', 'avocado', '酪梨'],
      ['🍅', 'tomato', '番茄'],
      ['🌽', 'corn', '玉米'],
      ['🍞', 'bread', '麵包'],
      ['🥐', 'croissant', '可頌'],
      ['🧀', 'cheese', '起司'],
      ['🍔', 'burger', '漢堡'],
      ['🍟', 'fries', '薯條'],
      ['🍕', 'pizza', '披薩'],
      ['🌮', 'taco', '塔可'],
      ['🍜', 'ramen', 'noodles', '拉麵', '麵'],
      ['🍚', 'rice', '飯'],
      ['🍣', 'sushi', '壽司'],
      ['🍱', 'bento', '便當'],
      ['🥟', 'dumpling', '餃子'],
      ['🍦', 'ice cream', '冰淇淋'],
      ['🍰', 'cake', '蛋糕'],
      ['🍪', 'cookie', '餅乾'],
      ['🍫', 'chocolate', '巧克力'],
      ['☕', 'coffee', '咖啡'],
      ['🍵', 'tea', '茶'],
      ['🧋', 'bubble tea', '珍奶'],
      ['🍺', 'beer', '啤酒'],
      ['🍷', 'wine', '紅酒'],
      ['🥤', 'cup', 'drink', '飲料'],
    ],
  },
  {
    id: 'travel',
    label: '旅行與地點',
    tabIcon: '🏠',
    items: [
      ['🏠', 'house', 'home', '家', '房子'],
      ['🏢', 'office', 'building', '辦公室', '大樓'],
      ['🏫', 'school', '學校'],
      ['🏥', 'hospital', '醫院'],
      ['🏦', 'bank', '銀行'],
      ['🏪', 'store', '商店'],
      ['🏰', 'castle', '城堡'],
      ['⛰️', 'mountain', '山'],
      ['🏖️', 'beach', '海灘'],
      ['🗺️', 'map', '地圖'],
      ['🧭', 'compass', '指南針'],
      ['🚗', 'car', '車'],
      ['🚌', 'bus', '公車'],
      ['🚆', 'train', '火車'],
      ['✈️', 'airplane', 'flight', '飛機'],
      ['🚢', 'ship', '船'],
      ['🚲', 'bike', '腳踏車'],
      ['🛵', 'scooter', '機車'],
      ['🚦', 'traffic light', '紅綠燈'],
      ['🗼', 'tower', '塔'],
    ],
  },
  {
    id: 'activity',
    label: '活動',
    tabIcon: '⚽',
    items: [
      ['⚽', 'soccer', '足球'],
      ['🏀', 'basketball', '籃球'],
      ['🏈', 'football', '美式足球'],
      ['⚾', 'baseball', '棒球'],
      ['🎾', 'tennis', '網球'],
      ['🏐', 'volleyball', '排球'],
      ['🏓', 'ping pong', '桌球'],
      ['🏸', 'badminton', '羽球'],
      ['🥊', 'boxing', '拳擊'],
      ['🏊', 'swim', '游泳'],
      ['🚴', 'cycling', '騎車'],
      ['🧘', 'yoga', 'meditate', '瑜伽', '冥想'],
      ['🎮', 'game', 'controller', '遊戲'],
      ['🎲', 'dice', '骰子'],
      ['🎨', 'art', 'paint', '藝術', '畫'],
      ['🎬', 'movie', 'film', '電影'],
      ['🎤', 'mic', 'sing', '麥克風', '唱'],
      ['🎧', 'headphone', 'music', '耳機', '音樂'],
      ['🎵', 'music note', '音符'],
      ['🎸', 'guitar', '吉他'],
      ['🎹', 'piano', '鋼琴'],
      ['📷', 'camera', 'photo', '相機', '照片'],
      ['🎁', 'gift', 'present', '禮物'],
      ['🎈', 'balloon', '氣球'],
    ],
  },
];

const RECENT_KEY = 'kennote:emoji:recent';
const MAX_RECENT = 24;

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function saveRecent(list: string[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
  } catch {
    /* 無痕模式：忽略 */
  }
}

export interface EmojiPickerProps {
  onSelect(emoji: string): void;
  onRemove?(): void;
  /** 顯示「隨機」按鈕 */
  showRandom?: boolean;
  autoFocus?: boolean;
}

export function EmojiPicker({ onSelect, onRemove, showRandom = true, autoFocus = true }: EmojiPickerProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>(EMOJI_DATA[0]?.id ?? 'smileys');
  const [recent, setRecent] = useState<string[]>(() => loadRecent());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) requestAnimationFrame(() => inputRef.current?.focus());
  }, [autoFocus]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const out: string[] = [];
    for (const cat of EMOJI_DATA) {
      for (const [emoji, ...keywords] of cat.items) {
        if (keywords.some((k) => k.toLowerCase().includes(q))) out.push(emoji);
      }
    }
    return out;
  }, [query]);

  const pick = (emoji: string): void => {
    const next = [emoji, ...recent.filter((e) => e !== emoji)].slice(0, MAX_RECENT);
    setRecent(next);
    saveRecent(next);
    onSelect(emoji);
  };

  const active = EMOJI_DATA.find((c) => c.id === category) ?? EMOJI_DATA[0];

  return (
    <div className="kn-emoji-picker">
      <div className="kn-emoji-head">
        <input
          ref={inputRef}
          className="kn-input kn-input--sm"
          value={query}
          placeholder="搜尋 emoji…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && results?.[0]) pick(results[0]);
          }}
        />
        {showRandom ? (
          <button
            type="button"
            className="kn-btn kn-btn--sm"
            onClick={() => {
              const all = EMOJI_DATA.flatMap((c) => c.items.map((i) => i[0]));
              const picked = all[Math.floor(Math.random() * all.length)];
              if (picked) pick(picked);
            }}
          >
            隨機
          </button>
        ) : null}
        {onRemove ? (
          <button type="button" className="kn-btn kn-btn--sm" onClick={onRemove}>
            移除
          </button>
        ) : null}
      </div>

      {results === null ? (
        <div className="kn-emoji-tabs" role="tablist">
          {EMOJI_DATA.map((cat) => (
            <button
              key={cat.id}
              type="button"
              role="tab"
              aria-selected={cat.id === category}
              data-active={cat.id === category ? 'true' : undefined}
              title={cat.label}
              onClick={() => setCategory(cat.id)}
            >
              {cat.tabIcon}
            </button>
          ))}
        </div>
      ) : null}

      <div className="kn-emoji-body">
        {results !== null ? (
          results.length === 0 ? (
            <div className="kn-menu-empty">找不到符合的 emoji</div>
          ) : (
            <div className="kn-emoji-grid">
              {results.map((emoji) => (
                <button key={emoji} type="button" className="kn-emoji" onClick={() => pick(emoji)}>
                  {emoji}
                </button>
              ))}
            </div>
          )
        ) : (
          <>
            {recent.length > 0 ? (
              <>
                <div className="kn-emoji-section">最近使用</div>
                <div className="kn-emoji-grid">
                  {recent.map((emoji) => (
                    <button key={`r-${emoji}`} type="button" className="kn-emoji" onClick={() => pick(emoji)}>
                      {emoji}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
            <div className="kn-emoji-section">{active?.label}</div>
            <div className="kn-emoji-grid">
              {active?.items.map(([emoji]) => (
                <button key={emoji} type="button" className="kn-emoji" onClick={() => pick(emoji)}>
                  {emoji}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
