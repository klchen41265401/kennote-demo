import { describe, expect, it } from 'vitest';
import { BLOCK_TYPES } from '@kennote/shared-types';
import { getSpec, isReactHosted, listSpecs, scoreSpec, searchSpecs } from '../blocks/registry';
import { createHostRegistry, findMountPoint } from '../blocks/hostRegistry';

describe('前端 Block Registry', () => {
  it('shared-types 的每一個 BlockType 都有對應的 BlockSpec（漏一個就會在這裡爆）', () => {
    const missing = BLOCK_TYPES.filter((type) => !getSpec(type));
    expect(missing).toEqual([]);
  });

  it('sortOrder 不重複，選單順序才穩定', () => {
    const orders = listSpecs().map((s) => s.sortOrder);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it('所有 spec 的 keywords 都同時含中英文', () => {
    for (const spec of listSpecs()) {
      const hasLatin = spec.keywords.some((k) => /[a-z]/i.test(k));
      const hasCjk = spec.keywords.some((k) => /[一-鿿]/.test(k));
      expect(hasLatin, `${spec.type} 缺英文關鍵字`).toBe(true);
      expect(hasCjk, `${spec.type} 缺中文關鍵字`).toBe(true);
    }
  });

  it('isReactHosted：媒體類由 React 畫，code 只是加 chrome', () => {
    expect(isReactHosted('image')).toBe(true);
    expect(isReactHosted('collectionView')).toBe(true);
    expect(isReactHosted('code')).toBe(false);
    expect(isReactHosted('paragraph')).toBe(false);
  });
});

describe('searchSpecs（M2-B 驗收：打「代」或「code」都要選到程式碼 block）', () => {
  it.each(['code', '程式', '程式碼', '代碼', 'snippet'])('「%s」的第一名是 code', (query) => {
    expect(searchSpecs(query)[0]?.type).toBe('code');
  });

  it.each([
    ['h1', 'heading1'],
    ['標題 1', 'heading1'],
    ['標題1', 'heading1'],
    ['h3', 'heading3'],
    ['todo', 'todo'],
    ['待辦', 'todo'],
    ['圖片', 'image'],
    ['image', 'image'],
    ['引言', 'quote'],
    ['分隔線', 'divider'],
  ])('「%s」→ %s', (query, type) => {
    expect(searchSpecs(query)[0]?.type).toBe(type);
  });

  it('空查詢回傳全部（除了只由結構操作產生的型別）', () => {
    const results = searchSpecs('');
    expect(results.length).toBe(listSpecs().length - 2); // column / tableRow 不列出
    expect(results.some((s) => s.type === 'column')) .toBe(false);
    expect(results.some((s) => s.type === 'tableRow')).toBe(false);
  });

  it('找不到時回傳空陣列（UI 會顯示「找不到符合的區塊」）', () => {
    expect(searchSpecs('zzzz-不存在的東西')).toEqual([]);
  });

  it('權重：label 完全符 > 前綴 > keyword 完全符 > 包含', () => {
    const code = getSpec('code');
    expect(code).toBeDefined();
    expect(scoreSpec(code!, '程式碼')).toBe(0);
    expect(scoreSpec(code!, '程式')).toBeLessThanOrEqual(1);
    expect(scoreSpec(code!, 'snippet')).toBe(2);
    expect(scoreSpec(code!, 'zzz')).toBe(-1);
  });
});

describe('createHostRegistry（editor-core ↔ React 的縫合點）', () => {
  it('React 型別只產生一個空的掛載容器', () => {
    const registry = createHostRegistry();
    const def = registry.get('image');
    expect(def.editable).toBe(false);
    expect(def.hasInlineContent).toBe(false);

    const main = def.render(
      { id: 'b1', parentId: null, type: 'image', props: {}, content: [], children: [], version: 1 },
      { doc: document, editable: true },
    );
    expect(main.getAttribute('data-kn-react-block')).toBe('image');
    expect(main.childNodes.length).toBe(0);
    expect(main.getAttribute('contenteditable')).toBe('false');
  });

  it('update() 一律回 true：容器節點不能被換掉，否則 portal 會重掛', () => {
    const registry = createHostRegistry();
    const def = registry.get('image');
    const block = { id: 'b1', parentId: null, type: 'image' as const, props: {}, content: [], children: [], version: 1 };
    const main = def.render(block, { doc: document, editable: true });
    expect(def.update?.(main, block, { ...block, props: { width: 200 } })).toBe(true);
  });

  it('code 仍然可編輯，而且有 [data-block-content] 與 React slot', () => {
    const registry = createHostRegistry();
    const def = registry.get('code');
    expect(def.hasInlineContent).toBe(true);
    const main = def.render(
      { id: 'c1', parentId: null, type: 'code', props: { language: 'ts' }, content: [], children: [], version: 1 },
      { doc: document, editable: true },
    );
    expect(main.querySelector('[data-kn-react-slot="code"]')).not.toBeNull();
    expect(main.querySelector('[data-block-content]')).not.toBeNull();
    expect(main.getAttribute('data-language')).toBe('ts');
  });

  it('清單 marker 是 contenteditable=false 的獨立 span（序號交給 CSS counter）', () => {
    const registry = createHostRegistry();
    const main = registry
      .get('numberedList')
      .render(
        { id: 'l1', parentId: null, type: 'numberedList', props: {}, content: [], children: [], version: 1 },
        { doc: document, editable: true },
      );
    const marker = main.querySelector('.kn-list-marker');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute('contenteditable')).toBe('false');
    expect(marker?.textContent).toBe('');
  });

  it('block color 會寫到 main 的 data-color', () => {
    const registry = createHostRegistry();
    const def = registry.get('paragraph');
    const block = {
      id: 'p1',
      parentId: null,
      type: 'paragraph' as const,
      props: { color: 'red' },
      content: [],
      children: [],
      version: 1,
    };
    const main = def.render(block, { doc: document, editable: true });
    expect(main.getAttribute('data-color')).toBe('red');
    def.update?.(main, block, { ...block, props: { color: 'default' } });
    expect(main.hasAttribute('data-color')).toBe(false);
  });

  it('findMountPoint 找得到 block 容器與 slot', () => {
    const blockEl = document.createElement('div');
    const main = document.createElement('div');
    main.setAttribute('data-kn-react-block', 'image');
    blockEl.appendChild(main);
    expect(findMountPoint(blockEl)).toEqual({ el: main, kind: 'block' });

    const codeBlock = document.createElement('div');
    const codeMain = document.createElement('div');
    const slot = document.createElement('div');
    slot.setAttribute('data-kn-react-slot', 'code');
    codeMain.appendChild(slot);
    codeBlock.appendChild(codeMain);
    expect(findMountPoint(codeBlock)).toEqual({ el: slot, kind: 'slot' });

    expect(findMountPoint(document.createElement('div'))).toBeNull();
    expect(findMountPoint(null)).toBeNull();
  });
});
