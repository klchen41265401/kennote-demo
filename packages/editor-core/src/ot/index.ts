/**
 * 自建簡化版 OT（04 §6.6、§8 M6 第 1–5 項）。
 *
 *   types.ts      資料模型（OtDelta / OtTextOp / MarkPatch）
 *   delta.ts      apply / compose / invert / deltaFromDiff / transformCursor
 *   transform.ts  TP1 的 transform
 *   client.ts     Synchronized / AwaitingConfirm / AwaitingWithBuffer 三狀態機
 */
export * from './types.js';
export * from './delta.js';
export * from './transform.js';
export * from './client.js';
