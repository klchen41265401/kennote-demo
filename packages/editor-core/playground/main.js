/**
 * Playground 的宿主層：示範「React 宿主要做的事」有多少（大約就這些）。
 *
 * 注意這支檔案是純 JS module，直接吃 tsc 編出來的 ../dist/index.js，
 * 不需要 vite / webpack / esbuild —— 跟 editor-core 本身一樣，零打包器依賴。
 */
import { createEditor } from '../dist/index.js';

const container = document.getElementById('editor');
const slashEl = document.getElementById('slash');

const doc = {
  rootIds: ['t', 'p1', 'l1', 'l2', 'c1'],
  blocks: {
    t: { id: 't', parentId: null, type: 'heading1', props: {}, content: [{ text: '開始測試' }], children: [], version: 1 },
    p1: {
      id: 'p1',
      parentId: null,
      type: 'paragraph',
      props: {},
      content: [
        { text: '這是一段含 ' },
        { text: '粗體', marks: [{ t: 'b' }] },
        { text: '、' },
        { text: '斜體', marks: [{ t: 'i' }] },
        { text: '、' },
        { text: '行內程式碼', marks: [{ t: 'code' }] },
        { text: ' 與 ' },
        { text: '連結', marks: [{ t: 'link', href: 'https://example.com' }] },
        { text: ' 的文字。試著在這裡用注音打字。' },
      ],
      children: [],
      version: 1,
    },
    l1: { id: 'l1', parentId: null, type: 'bulletedList', props: {}, content: [{ text: '清單項目一' }], children: [], version: 1 },
    l2: { id: 'l2', parentId: null, type: 'todo', props: { checked: false }, content: [{ text: '待辦事項' }], children: [], version: 1 },
    c1: {
      id: 'c1',
      parentId: null,
      type: 'code',
      props: { language: 'ts' },
      content: [{ text: 'const editor = createEditor({ container, doc });' }],
      children: [],
      version: 1,
    },
  },
};

const editor = createEditor({ container, doc });
window.editor = editor; // 方便在 devtools 裡玩

// ── 狀態面板 ──────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const logLines = [];

function refresh() {
  $('doc').textContent = JSON.stringify(editor.getDoc(), null, 1);
  $('selection').textContent = JSON.stringify(editor.getSelection(), null, 1);
  $('mutations').textContent = String(editor.mutationTriggerCountForTest);
}

editor.on('transaction', refresh);
editor.on('selectionChange', refresh);
editor.on('localOps', (ops) => {
  logLines.unshift(ops.map((o) => `${o.type} ${o.blockId}`).join(', '));
  $('log').textContent = logLines.slice(0, 12).join('\n');
});
editor.on('compositionChange', (isComposing) => {
  const badge = $('composing');
  badge.textContent = isComposing ? 'composing' : 'idle';
  badge.dataset.on = String(isComposing);
});
editor.on('reconcile', (payload) => {
  console.warn('[playground] reconcile', payload);
});

// ── 工具列按鈕 ────────────────────────────────────────────
$('undo').onclick = () => editor.undo();
$('redo').onclick = () => editor.redo();
$('bold').onclick = () => editor.toggleMark({ t: 'b' });
$('h1').onclick = () => {
  const sel = editor.getSelection();
  if (sel.type === 'text') editor.setBlockType(sel.focus.blockId, 'heading1');
};
$('todo').onclick = () => {
  const sel = editor.getSelection();
  if (sel.type === 'text') editor.setBlockType(sel.focus.blockId, 'todo');
};
$('remote').onclick = () => {
  const id = editor.getDoc().rootIds[0];
  const block = editor.getBlock(id);
  editor.applyRemote([
    { type: 'block.update', blockId: id, patch: { content: [{ text: '(遠端改過) ' }, ...block.content] } },
  ]);
};

// ── Slash menu：宿主只要做這些 ────────────────────────────
let slashState = null;
let slashItems = [];
let slashIndex = 0;

function renderSlash() {
  if (!slashState) {
    slashEl.style.display = 'none';
    return;
  }
  slashItems = editor.registry.search(slashState.query).slice(0, 8);
  if (slashItems.length === 0) {
    slashEl.innerHTML = '<div class="item">找不到符合的區塊</div>';
  } else {
    slashEl.innerHTML = slashItems
      .map(
        (d, i) =>
          `<div class="item" role="option" data-i="${i}" aria-selected="${i === slashIndex}">${d.label}<small>${d.description}</small></div>`,
      )
      .join('');
  }
  const rect = slashState.rect;
  slashEl.style.display = 'block';
  slashEl.style.left = `${(rect?.left ?? 40) + window.scrollX}px`;
  slashEl.style.top = `${(rect?.bottom ?? 60) + window.scrollY + 4}px`;
}

function commitSlash(def) {
  if (!def || !slashState) return;
  const { blockId, triggerOffset, query } = slashState;
  const block = editor.getBlock(blockId);
  if (block) {
    // 先刪掉 "/query" 這段文字，再轉換型別
    const before = block.content;
    editor.dispatch({
      ops: [
        {
          type: 'block.update',
          blockId,
          patch: { content: sliceOut(before, triggerOffset, triggerOffset + 1 + query.length) },
        },
      ],
      selectionAfter: { type: 'text', anchor: { blockId, offset: triggerOffset }, focus: { blockId, offset: triggerOffset } },
    });
  }
  editor.setBlockType(blockId, def.type);
  slashState = null;
  renderSlash();
}

/** 簡易的 RichText 區段刪除（宿主端不需要 import editor-core 的內部函式也能做）。 */
function sliceOut(content, from, to) {
  let pos = 0;
  const out = [];
  for (const node of content) {
    const len = node.text ? [...node.text].length : 1;
    const start = pos;
    const end = pos + len;
    pos = end;
    if (!node.text) {
      if (end <= from || start >= to) out.push(node);
      continue;
    }
    const chars = [...node.text];
    const kept = chars.filter((_, i) => start + i < from || start + i >= to).join('');
    if (kept) out.push(node.marks ? { text: kept, marks: node.marks } : { text: kept });
  }
  return out;
}

editor.on('slashTrigger', (payload) => {
  slashState = payload.open ? payload : null;
  slashIndex = 0;
  renderSlash();
});

slashEl.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  const item = e.target.closest('.item');
  if (!item) return;
  commitSlash(slashItems[Number(item.dataset.i)]);
});

document.addEventListener(
  'keydown',
  (e) => {
    if (!slashState) return;
    if (e.key === 'ArrowDown') {
      slashIndex = (slashIndex + 1) % Math.max(1, slashItems.length);
      renderSlash();
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      slashIndex = (slashIndex - 1 + slashItems.length) % Math.max(1, slashItems.length);
      renderSlash();
      e.preventDefault();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      commitSlash(slashItems[slashIndex]);
      e.preventDefault();
    } else if (e.key === 'Escape') {
      slashState = null;
      renderSlash();
      e.preventDefault();
    }
  },
  true,
);

editor.focusBlock('p1', 0);
refresh();
