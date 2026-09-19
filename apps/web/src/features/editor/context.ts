/**
 * 編輯器宿主的 React context。
 *
 * 鐵律：block renderer **只能**透過這裡的方法改資料（每一個都會落成 Operation
 * 經由 editor.applyTransaction），不可以直接改 DOM、也不可以直接打寫入 API。
 */
import { createContext, useContext } from 'react';
import type { Block, BlockType, Editor, EditorDoc, RichText } from '@kennote/editor-core';
import type { Operation } from '@kennote/shared-types';

export interface UploadedFile {
  id: string;
  url: string;
  name: string;
  size: number;
  contentType: string;
}

export interface EditorHostApi {
  editor: Editor;
  /** 目前的 doc（每次 transaction 後會換成新物件） */
  doc: EditorDoc;
  /** 每次 transaction +1，給 renderer 當重繪訊號 */
  rev: number;
  pageId: string;
  workspaceId: string | null;
  readOnly: boolean;

  getBlock(blockId: string): Block | undefined;
  /** 合併式更新 props */
  updateProps(blockId: string, patch: Record<string, unknown>): void;
  setContent(blockId: string, content: RichText): void;
  setType(blockId: string | string[], type: BlockType, props?: Record<string, unknown>): void;
  insertAfter(
    afterId: string | null,
    options?: {
      type?: BlockType;
      props?: Record<string, unknown>;
      content?: RichText;
      asChild?: boolean;
    },
  ): string | null;
  remove(blockIds: string[]): void;
  move(blockId: string, parentId: string | null, afterId: string | null): void;
  focus(blockId: string, offset?: number): void;
  /** 一次送出多個 op（原子性，同一筆 undo） */
  applyOps(ops: Operation[]): void;

  /** 子頁面點擊 → 導頁 */
  navigateToPage(pageId: string): void;
  /** page block 建立實際頁面（POST /api/pages） */
  createSubPage(blockId: string): Promise<void>;
  /** collectionView block 建立資料庫（POST /api/databases） */
  createInlineDatabase(blockId: string): Promise<void>;
  /** 上傳檔案（renderer 只能用這個，不可自行打 API） */
  upload(file: File, onProgress?: (percent: number) => void): Promise<UploadedFile>;
}

export const EditorHostContext = createContext<EditorHostApi | null>(null);

export function useEditorHostApi(): EditorHostApi {
  const value = useContext(EditorHostContext);
  if (!value) throw new Error('useEditorHostApi 必須在 <Editor> 內使用');
  return value;
}

/** renderer 統一的 props */
export interface BlockRendererProps {
  block: Block;
  /** editor-core 產生的容器（portal target），renderer 不需要自己找 */
  container: HTMLElement;
  host: EditorHostApi;
}
