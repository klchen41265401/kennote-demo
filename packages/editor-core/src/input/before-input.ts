/**
 * beforeinput 分派表。
 *
 * 不要用 keydown 判斷輸入內容：Android GBoard 的 keyCode 永遠是 229，
 * 自動更正、語音輸入、貼上、拖放也不會產生有意義的 keydown。
 * beforeinput 的 inputType 明確告訴我們「使用者想做什麼」。
 *
 * 第一道關卡：IME 組字期間一律放行，絕不攔截（insertCompositionText 不可 preventDefault）。
 */
import type { Editor } from '../core.js';
import {
  deleteBackward,
  deleteForward,
  insertSoftBreak,
  insertText,
  splitBlock,
  toggleMarkCommand,
} from './commands.js';
import { orderedRange } from '../selection/types.js';
import { deleteRangeOps } from '../transaction/builders.js';

/** 這些 inputType 由我們自己處理（preventDefault + 改 model）。 */
export const HANDLED_INPUT_TYPES = [
  'insertText',
  'insertParagraph',
  'insertLineBreak',
  'deleteContentBackward',
  'deleteContentForward',
  'deleteWordBackward',
  'deleteWordForward',
  'deleteSoftLineBackward',
  'deleteSoftLineForward',
  'deleteByCut',
  'insertFromPaste',
  'insertFromDrop',
  'insertReplacementText',
  'formatBold',
  'formatItalic',
  'formatUnderline',
  'formatStrikeThrough',
  'formatCode',
  'historyUndo',
  'historyRedo',
] as const;

export interface BeforeInputHost {
  /** 剛套用 input rule 之後的旗標（Backspace 要能還原轉換）。 */
  afterInputRuleUndo(): boolean;
  /** 文字插入後跑 markdown 捷徑。 */
  runInputRules(blockId: string): void;
  /** 貼上／拖放由 clipboard 管線處理。 */
  isComposing: boolean;
}

/**
 * 回傳 true 代表我們已處理（呼叫端不需要再做事）。
 * 注意：本函式自己負責 preventDefault。
 */
export function handleBeforeInput(editor: Editor, host: BeforeInputHost, event: InputEvent): boolean {
  // IME 組字期間一律放行
  if (host.isComposing || event.inputType === 'insertCompositionText') return false;

  const sel = editor.getSelection();
  if (sel.type === 'none') return false;

  switch (event.inputType) {
    case 'insertText': {
      event.preventDefault();
      const data = event.data ?? '';
      if (data === '') return true;
      const range = orderedRange(sel);
      if (!range) return true;
      insertText(editor, data);
      host.runInputRules(range.blockId);
      return true;
    }

    case 'insertReplacementText': {
      // 拼字更正 / 手寫辨識 / 輸入法直接貼上候選詞
      event.preventDefault();
      const data = event.data ?? dataFromDataTransfer(event);
      if (data === null) return true;
      insertText(editor, data);
      return true;
    }

    case 'insertParagraph': {
      event.preventDefault();
      splitBlock(editor);
      return true;
    }

    case 'insertLineBreak': {
      event.preventDefault();
      insertSoftBreak(editor);
      return true;
    }

    case 'deleteContentBackward': {
      event.preventDefault();
      if (host.afterInputRuleUndo()) return true; // 剛轉換完 → Backspace 還原轉換
      deleteBackward(editor, 'grapheme');
      return true;
    }

    case 'deleteContentForward': {
      event.preventDefault();
      deleteForward(editor, 'grapheme');
      return true;
    }

    case 'deleteWordBackward': {
      event.preventDefault();
      deleteBackward(editor, 'word');
      return true;
    }

    case 'deleteWordForward': {
      event.preventDefault();
      deleteForward(editor, 'word');
      return true;
    }

    case 'deleteSoftLineBackward':
    case 'deleteHardLineBackward': {
      event.preventDefault();
      deleteBackward(editor, 'softline');
      return true;
    }

    case 'deleteSoftLineForward':
    case 'deleteHardLineForward': {
      event.preventDefault();
      deleteForward(editor, 'softline');
      return true;
    }

    case 'deleteByCut': {
      // cut 事件已經把內容寫進剪貼簿，這裡只負責刪除
      event.preventDefault();
      const range = orderedRange(sel);
      if (sel.type === 'block') {
        editor.deleteBlocks(sel.blockIds);
        return true;
      }
      if (range && range.start !== range.end) {
        editor.dispatchBuild(deleteRangeOps(editor.getDoc(), range.blockId, range.start, range.end), {
          kind: 'deleteText',
          breakHistory: true,
        });
      }
      return true;
    }

    case 'insertFromPaste':
    case 'insertFromDrop':
    case 'insertFromPasteAsQuotation': {
      // 實際處理在 paste / drop 事件；這裡只負責不讓瀏覽器亂塞 DOM
      event.preventDefault();
      return true;
    }

    case 'formatBold': {
      event.preventDefault();
      toggleMarkCommand(editor, { t: 'b' });
      return true;
    }

    case 'formatItalic': {
      event.preventDefault();
      toggleMarkCommand(editor, { t: 'i' });
      return true;
    }

    case 'formatUnderline': {
      event.preventDefault();
      toggleMarkCommand(editor, { t: 'u' });
      return true;
    }

    case 'formatStrikeThrough': {
      event.preventDefault();
      toggleMarkCommand(editor, { t: 's' });
      return true;
    }

    case 'formatCode': {
      event.preventDefault();
      toggleMarkCommand(editor, { t: 'code' });
      return true;
    }

    case 'historyUndo': {
      event.preventDefault();
      editor.undo();
      return true;
    }

    case 'historyRedo': {
      event.preventDefault();
      editor.redo();
      return true;
    }

    default: {
      // 未列出的 inputType：一律 preventDefault 並忽略，避免瀏覽器偷改 DOM。
      // MutationObserver 是第二道防線；開發期看到 reconcile 事件就代表這裡該補一個 case。
      event.preventDefault();
      editor.emit('reconcile', { blockId: sel.type === 'text' ? sel.focus.blockId : '', reason: `unhandled inputType: ${event.inputType}` });
      return true;
    }
  }
}

function dataFromDataTransfer(event: InputEvent): string | null {
  const dt = event.dataTransfer;
  if (!dt) return null;
  try {
    return dt.getData('text/plain');
  } catch {
    return null;
  }
}
