/**
 * BUG-18：跨 block 的 redo 會把內容再吃掉一段、redo stack 空掉。
 *
 * ── 為什麼 QA 的 jsdom 探針跑不出來 ────────────────────────────
 * 只跑「打字 → Enter → 打字 → undo×2 → redo×2」是會過的。
 * 真實瀏覽器多了三件事，這個檔案把它們全部模擬出來：
 *
 *   1. **假時鐘**：打字不停時 coalescing 不會斷開，
 *      一筆 history entry 會同時含好幾個 `block.update`。
 *   2. **同一 tick 內混合 delta 與結構 op**：在 block 中間按 Enter，
 *      一筆 transaction 就是 `block.update{content}` + `block.insert`。
 *   3. **localOps 分流 + ack 亂序**：文字走 OT 通道（`text.delta`）、
 *      結構走 tx 通道，兩條通道的 ack / 廣播回來的順序是亂的。
 *
 * 只要同一筆 entry 裡混了結構 op，舊的 `historyOps()` 就會把
 * `block.insert` 整個丟掉（它只從 delta 生 `block.update`），
 * 而且那一筆 entry 完全沒有 delta 表示 → 收到遠端 delta 時
 * `rebaseStack()` 只能把整條 redo stack 丟掉。
 */
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyDelta,
  commands,
  createEditor,
  deltaFromDiff,
  handleKeyDown,
  normalize,
  OtClient,
  textSelection,
  toPlainText,
  type Editor,
  type EditorDoc,
  type Operation,
  type OtDelta,
  type RichText,
} from '../../src/index.js';

const ROOT = 'b1';

function makeDoc(text = ''): EditorDoc {
  return {
    rootIds: [ROOT],
    blocks: {
      [ROOT]: {
        id: ROOT,
        parentId: null,
        type: 'paragraph',
        props: {},
        content: text ? [{ text }] : [],
        children: [],
        version: 1,
      },
    },
  };
}

interface SentDelta {
  blockId: string;
  delta: OtDelta;
  baseRev: number;
}

/**
 * 一個「一整頁」的假 OT 宿主：每個 block 一個三狀態機，
 * 送出的 delta 先進 `inflight`，測試自己決定什麼時候、用什麼順序 ack。
 */
class FakeOtHost {
  readonly inflight: SentDelta[] = [];
  private readonly clients = new Map<string, OtClient>();
  private editor: Editor | null = null;

  attach(editor: Editor): void {
    this.editor = editor;
  }

  getBaseRev(blockId: string): number {
    return this.clients.get(blockId)?.rev ?? 0;
  }

  private client(blockId: string): OtClient {
    const existing = this.clients.get(blockId);
    if (existing) return existing;
    const client = new OtClient({
      rev: 0,
      applyDelta: (delta) => this.editor?.applyRemoteDelta(blockId, delta),
      sendDelta: (delta, baseRev) => {
        this.inflight.push({ blockId, delta, baseRev });
      },
    });
    this.clients.set(blockId, client);
    return client;
  }

  /** 宿主收到 `localOps`：`text.delta` 走 OT 通道，其他（結構 op）走 tx 通道。 */
  submit(ops: Operation[]): Operation[] {
    const rest: Operation[] = [];
    for (const op of ops) {
      if (op.type === 'text.delta') this.client(op.blockId).applyLocal(op.delta as OtDelta);
      else rest.push(op);
    }
    return rest;
  }

  /** 把飛在線上的 delta 依指定順序 ack 掉（`order: 'lifo'` = 亂序回來）。 */
  flush(order: 'fifo' | 'lifo' = 'fifo'): void {
    let guard = 0;
    while (this.inflight.length > 0 && guard++ < 200) {
      const index = order === 'fifo' ? 0 : this.inflight.length - 1;
      const item = this.inflight.splice(index, 1)[0]!;
      this.client(item.blockId).applyAck(item.baseRev + 1);
    }
  }

  /** 別人送來的 delta（伺服器已套用，rev+1）。 */
  remote(blockId: string, delta: OtDelta): void {
    const client = this.client(blockId);
    client.applyRemote(delta, client.rev + 1);
  }
}

interface Harness {
  editor: Editor;
  ot: FakeOtHost;
  clock: { t: number };
  /** 目前所有最上層 block 的純文字（等同 e2e 的 blockDump）。 */
  dump(): string[];
  /** 不停頓地連打（每個字只差 30ms，coalescing 不會斷開）。 */
  typeFast(text: string): void;
  enter(): void;
  ctrlZ(): void;
  ctrlY(): void;
  ctrlShiftZ(): void;
  /** 模擬別人在某個 block 尾巴打字。 */
  remoteAppend(blockId: string, text: string): void;
  /** 模擬別人在某個 block 開頭打字。 */
  remotePrepend(blockId: string, text: string): void;
}

function mount(ot: boolean, initial = ''): Harness {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const clock = { t: 1_000 };
  const host = new FakeOtHost();
  let seq = 0;
  const editor = createEditor({
    container,
    doc: makeDoc(initial),
    now: () => clock.t,
    newId: () => `n${++seq}`,
    ot: ot ? { enabled: true, getBaseRev: (id) => host.getBaseRev(id) } : { enabled: false },
  });
  host.attach(editor);
  if (ot) editor.on('localOps', (ops) => host.submit(ops));
  editor.setSelection(textSelection(ROOT, initial.length));

  const key = (init: KeyboardEventInit): void => {
    handleKeyDown(
      editor,
      { goalX: null, isComposing: false, selectAllCount: 0, enterBlockMode: () => {}, exitBlockMode: () => {} },
      new KeyboardEvent('keydown', init),
    );
  };

  return {
    editor,
    ot: host,
    clock,
    dump: () => {
      const doc = editor.getDoc();
      return doc.rootIds.map((id) => toPlainText(doc.blocks[id]!.content));
    },
    typeFast(text) {
      for (const ch of text) {
        clock.t += 30; // < COALESCE_WINDOW_MS（1000ms）→ 一定會被合併
        commands.insertText(editor, ch);
      }
    },
    enter() {
      clock.t += 30;
      commands.splitBlock(editor);
    },
    ctrlZ: () => key({ key: 'z', ctrlKey: true }),
    ctrlY: () => key({ key: 'y', ctrlKey: true }),
    ctrlShiftZ: () => key({ key: 'z', ctrlKey: true, shiftKey: true }),
    remoteAppend(blockId, text) {
      const before: RichText = normalize(editor.getBlock(blockId)!.content);
      const after = normalize([{ text: toPlainText(before) + text }]);
      host.remote(blockId, deltaFromDiff(before, after));
    },
    remotePrepend(blockId, text) {
      const before: RichText = normalize(editor.getBlock(blockId)!.content);
      const after = normalize([{ text: text + toPlainText(before) }]);
      host.remote(blockId, deltaFromDiff(before, after));
    },
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

for (const otEnabled of [false, true]) {
  describe(`BUG-18 跨 block 的 undo/redo（ot.enabled = ${otEnabled}）`, () => {
    it('打字 → Enter → 打字（全程不停頓）→ Ctrl+Z ×2 → Ctrl+Y ×2 完整還原', () => {
      const h = mount(otEnabled);
      h.typeFast('第一段');
      h.enter();
      h.typeFast('第二段');
      h.ot.flush('lifo');
      const typed = h.dump();
      expect(typed).toEqual(['第一段', '第二段']);

      h.ctrlZ();
      expect(h.dump()).toEqual(['第一段', '']);
      h.ctrlZ();
      expect(h.dump()).toEqual(['第一段']);
      expect(h.editor.history.canRedo, 'undo 之後一定要能 redo').toBe(true);

      h.ctrlY();
      expect(h.dump(), 'redo 一次要把 Enter 拆出來的 block 建回來').toEqual(['第一段', '']);
      h.ctrlY();
      expect(h.dump(), 'redo 兩次要回到原狀').toEqual(typed);
      expect(h.editor.history.canRedo).toBe(false);
    });

    it('在 block 中間按 Enter（同一 tick 混合 delta 與 block.insert）也能來回還原', () => {
      const h = mount(otEnabled);
      h.typeFast('第一段第二段');
      // 游標放到中間 → 這一筆 transaction 同時有 block.update{content} 與 block.insert
      h.editor.setSelection(textSelection(ROOT, 3));
      h.enter();
      h.typeFast('AB');
      h.ot.flush('lifo');
      const typed = h.dump();
      expect(typed).toEqual(['第一段', 'AB第二段']);

      h.ctrlZ();
      expect(h.dump()).toEqual(['第一段', '第二段']);
      h.ctrlZ();
      expect(h.dump(), 'undo 掉拆段落 → 併回同一個 block').toEqual(['第一段第二段']);

      h.ctrlShiftZ();
      expect(h.dump(), 'redo 拆段落：內容不能被多吃一段，新 block 要回來').toEqual([
        '第一段',
        '第二段',
      ]);
      h.ctrlShiftZ();
      expect(h.dump()).toEqual(typed);
    });

    it('Ctrl+Y 與 Ctrl+Shift+Z 行為一致', () => {
      const a = mount(otEnabled);
      a.typeFast('一二三');
      a.enter();
      a.typeFast('四五六');
      a.ctrlZ();
      a.ctrlZ();
      a.ctrlY();
      a.ctrlY();

      const b = mount(otEnabled);
      b.typeFast('一二三');
      b.enter();
      b.typeFast('四五六');
      b.ctrlZ();
      b.ctrlZ();
      b.ctrlShiftZ();
      b.ctrlShiftZ();

      expect(a.dump()).toEqual(b.dump());
      expect(a.dump()).toEqual(['一二三', '四五六']);
    });

    it('連按 10 次 undo / redo 之後仍然回到同一份文件', () => {
      const h = mount(otEnabled);
      h.typeFast('甲');
      h.enter();
      h.typeFast('乙');
      h.enter();
      h.typeFast('丙');
      h.ot.flush('lifo');
      const typed = h.dump();
      expect(typed).toEqual(['甲', '乙', '丙']);

      for (let i = 0; i < 10; i++) h.ctrlZ();
      expect(h.dump()).toEqual(['']);
      for (let i = 0; i < 10; i++) h.ctrlY();
      expect(h.dump()).toEqual(typed);
    });

    it('undo 之後打新字 → redo stack 要被清空', () => {
      const h = mount(otEnabled);
      h.typeFast('第一段');
      h.enter();
      h.typeFast('第二段');
      h.ctrlZ();
      expect(h.editor.history.canRedo).toBe(true);

      h.clock.t += 5_000; // 新的一段打字（時間拉開，一定不會被 coalesce 進去）
      h.typeFast('新字');
      expect(h.editor.history.canRedo, '新操作之後不該還能 redo').toBe(false);
      expect(h.editor.history.redoDepth).toBe(0);

      h.ctrlY();
      expect(h.dump(), 'redo 沒東西可做時不能動到文件').toEqual(['第一段', '新字']);
    });
  });
}

describe('BUG-18 協作情境（ot.enabled = true）', () => {
  it('遠端 delta 進來之後，跨 block 的 redo stack 不會被整條丟掉', () => {
    const h = mount(true);
    h.typeFast('第一段第二段');
    h.editor.setSelection(textSelection(ROOT, 3)); // 中間 Enter → entry 裡混著結構 op
    h.enter();
    h.typeFast('AB');
    h.ot.flush('lifo');

    h.ctrlZ();
    h.ctrlZ();
    expect(h.dump()).toEqual(['第一段第二段']);
    const depthBefore = h.editor.history.redoDepth;
    expect(depthBefore).toBe(2);

    // 別人在同一個 block 的**開頭**打字（位置明確落在拆點之前）
    h.remotePrepend(ROOT, 'X');
    expect(h.dump()).toEqual(['X第一段第二段']);
    expect(h.editor.history.redoDepth, '遠端 delta 不該把 redo stack 清空').toBe(depthBefore);

    h.ctrlShiftZ();
    expect(h.dump(), 'redo 拆段落：別人的字留在左半段，右半段要被建出來').toEqual([
      'X第一段',
      '第二段',
    ]);
    h.ctrlShiftZ();
    expect(h.dump(), '別人的字要留著，自己的 redo 也要完整回來').toEqual(['X第一段', 'AB第二段']);
  });

  it('遠端 delta 進來之後，undo 仍然跨得過「拆段落」那一筆', () => {
    const h = mount(true);
    h.typeFast('第一段第二段');
    h.editor.setSelection(textSelection(ROOT, 3));
    h.enter();
    h.typeFast('AB');
    h.ot.flush('lifo');
    expect(h.dump()).toEqual(['第一段', 'AB第二段']);

    // 打字中途別人在 block A 開頭插字：舊版沒有 delta 表示的結構 entry
    // 會連同它以下的 undo 紀錄一起被丟掉 → 第二次 Ctrl+Z 就沒反應了
    h.remotePrepend(ROOT, 'X');
    expect(h.editor.history.undoDepth, '結構 entry 不該讓 undo stack 被砍掉').toBe(3);

    h.ctrlZ();
    expect(h.dump()).toEqual(['X第一段', '第二段']);
    h.ctrlZ();
    expect(h.dump(), 'undo 掉拆段落，別人的字要留著').toEqual(['X第一段第二段']);
    h.ctrlShiftZ();
    expect(h.dump()).toEqual(['X第一段', '第二段']);
    h.ctrlShiftZ();
    expect(h.dump()).toEqual(['X第一段', 'AB第二段']);
  });

  it('Backspace 合併 block（block.delete + 內容更新同一 tick）也走同一條分流', () => {
    const h = mount(true);
    h.typeFast('第一段');
    h.enter();
    h.typeFast('第二段');
    h.ot.flush('lifo');
    // 游標放到第二個 block 的開頭 → Backspace 把它併回前一個
    const second = h.editor.getDoc().rootIds[1]!;
    h.editor.setSelection(textSelection(second, 0));
    h.clock.t += 2_000;
    commands.deleteBackward(h.editor);
    expect(h.dump()).toEqual(['第一段第二段']);

    const entry = (h.editor.history as unknown as { undoStack: Array<Record<string, unknown>> }).undoStack.at(-1)!;
    expect(entry.deltas, '合併 block 的 entry 也要有 delta 表示').toBeTruthy();

    h.remotePrepend(ROOT, 'X');
    expect(h.dump()).toEqual(['X第一段第二段']);

    h.ctrlZ();
    expect(h.dump(), 'undo 合併：拆回兩個 block，別人的字留著').toEqual(['X第一段', '第二段']);
    h.ctrlShiftZ();
    expect(h.dump(), 'redo 合併').toEqual(['X第一段第二段']);
  });

  it('undo 自己的 insert 不會影響別人後來在同一個 block 打的字', () => {
    const h = mount(true, '共用');
    h.editor.setSelection(textSelection(ROOT, 2));
    h.typeFast('我的字');
    expect(h.dump()).toEqual(['共用我的字']);

    // 別人在最前面插字（我的 undo 必須對它 transform，不能整段蓋回去）
    const before = normalize(h.editor.getBlock(ROOT)!.content);
    h.ot.remote(ROOT, deltaFromDiff(before, normalize([{ text: '他的字' + toPlainText(before) }])));
    expect(h.dump()).toEqual(['他的字共用我的字']);

    h.ctrlZ();
    expect(h.dump(), 'undo 只撤銷自己那三個字').toEqual(['他的字共用']);

    h.ctrlY();
    expect(h.dump(), 'redo 也要在別人的字之上重放').toEqual(['他的字共用我的字']);
  });

  it('跨 block 的協作：別人改 block A 時，我 redo block B 的結構操作仍然正確', () => {
    const h = mount(true);
    h.typeFast('第一段');
    h.enter();
    h.typeFast('第二段');
    h.ot.flush('fifo');

    h.ctrlZ();
    h.ctrlZ();
    expect(h.dump()).toEqual(['第一段']);

    h.remoteAppend(ROOT, '（別人）');
    h.ctrlY();
    h.ctrlY();
    expect(h.dump()).toEqual(['第一段（別人）', '第二段']);
  });

  it('ack 亂序回來時，undo/redo 產生的 delta 仍然以正確的 rev 送出', () => {
    const h = mount(true);
    h.typeFast('甲乙');
    h.enter();
    h.typeFast('丙丁');
    // 兩個 block 各有一筆 delta 在線上，後送的先 ack
    expect(h.ot.inflight.length).toBeGreaterThan(0);
    h.ot.flush('lifo');
    expect(h.ot.inflight, 'ack 完應該沒有東西卡在線上').toHaveLength(0);

    const typed = h.dump();
    h.ctrlZ();
    h.ctrlZ();
    h.ot.flush('lifo');
    h.ctrlY();
    h.ctrlY();
    h.ot.flush('lifo');
    expect(h.dump()).toEqual(typed);

    // 本地文件與 OT 客戶端的內容視角一致（rev 沒有錯位）
    for (const id of h.editor.getDoc().rootIds) {
      expect(h.ot.getBaseRev(id)).toBeGreaterThanOrEqual(0);
    }
  });

  it('block 被別人刪掉時 redo 回 false，且紀錄留在 redo stack 上（不清空）', () => {
    const h = mount(true);
    h.typeFast('第一段');
    h.enter();
    h.typeFast('第二段');
    const newBlockId = h.editor.getDoc().rootIds[1]!;

    h.ctrlZ();
    h.ctrlZ();
    expect(h.editor.history.redoDepth).toBe(2);

    // 別人把 block A 刪掉 → 我的 redo（block.insert afterId = A）套不上去
    h.editor.applyRemote([{ type: 'block.delete', blockId: ROOT }]);
    expect(h.editor.getDoc().rootIds).not.toContain(ROOT);
    expect(h.editor.getDoc().rootIds).not.toContain(newBlockId);

    const depth = h.editor.history.redoDepth;
    const docBefore = h.editor.getDoc();
    expect(h.editor.redo(), 'redo 套不上去要回 false').toBe(false);
    expect(h.editor.getDoc(), 'redo 失敗不能動到文件').toBe(docBefore);
    expect(h.editor.history.redoDepth, 'redo 失敗絕不清空 redo stack').toBe(depth);
  });
});

describe('BUG-18 history entry 的 op 分流規則', () => {
  it('混著結構 op 的 entry 也有 delta 表示（結構 op 原樣保留、順序不變）', () => {
    const h = mount(true);
    h.typeFast('第一段第二段');
    h.editor.setSelection(textSelection(ROOT, 3));
    h.enter();

    const stack = h.editor.history as unknown as { undoStack: Array<Record<string, unknown>> };
    const entry = stack.undoStack[stack.undoStack.length - 1]!;
    expect(entry.kind).toBe('structural');
    const ops = entry.ops as Operation[];
    expect(ops.map((op) => op.type)).toEqual(['block.update', 'block.insert']);
    expect(entry.deltas, '結構 entry 的內容變更也要記成可 transform 的 delta').toBeTruthy();

    const deltas = entry.deltas as Array<{ blockId: string; forward: OtDelta; inverse: OtDelta }>;
    expect(deltas.map((d) => d.blockId)).toEqual([ROOT]);
    // forward delta 套在「拆之前」的內容上就是左半段
    const forward = deltas[0]!.forward;
    expect(toPlainText(applyDelta(normalize([{ text: '第一段第二段' }]), forward))).toBe('第一段');
  });
});
