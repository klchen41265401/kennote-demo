/**
 * 編輯器宿主層的對外門面。整合代理只需要 import 這一支。
 * 詳細說明見同資料夾的 README.md。
 */
export { Editor, type EditorProps } from './Editor';
export { PageHeader, type PageHeaderProps, COVER_GRADIENTS, parseCover } from './PageHeader';
export { useEditorHost, snapshotToDoc } from './useEditorHost';
export type { EditorHostApi, BlockRendererProps, UploadedFile } from './context';
export type { TransportState, TransportStatus, SyncAdapter, Transport } from './transport';
export { createTransport, createHttpAdapter, createSessionId } from './transport';
export {
  registerInlineDatabase,
  registerCreateDatabase,
  type InlineDatabaseProps,
  type CreateDatabaseFn,
} from './blocks/externalRegistry';
export { listSpecs, getSpec, searchSpecs, type BlockSpec } from './blocks/registry';
export { toast, ToastHost } from './ui/toast';
