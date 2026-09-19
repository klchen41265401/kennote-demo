/**
 * 內嵌資料庫（01 §5.3 M4.3.10）。
 *
 * 給 block 渲染器用：`collectionView` 型別的 block 直接渲染這個元件。
 *
 *   <InlineDatabase collectionId={block.props.collectionId} viewId={block.props.viewId} />
 *
 * 與整頁資料庫是同一份 DatabaseView，只是外框不同、狀態共用（同一組 query key，
 * 所以同頁同時出現兩次也只會打一次 API）。
 */
import { DatabaseView } from './DatabaseView';

export interface InlineDatabaseProps {
  collectionId: string;
  viewId?: string;
  readOnly?: boolean;
  /** 內嵌時的高度上限，預設 560px */
  maxHeight?: number;
}

export function InlineDatabase({
  collectionId,
  viewId,
  readOnly,
  maxHeight = 560,
}: InlineDatabaseProps) {
  return (
    <DatabaseView
      collectionId={collectionId}
      {...(viewId ? { viewId } : {})}
      inline
      {...(readOnly !== undefined ? { readOnly } : {})}
      maxHeight={maxHeight}
    />
  );
}
