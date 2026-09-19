/**
 * ⭐ rating（星等）—— 04 §8 M4 驗收標準最後一條的**實際證明**：
 *
 *   「新增一個自定欄位型別只需修改 registry + 新增一個資料夾，
 *     Table / Board / Calendar / 篩選 / 排序 / 匯出一行都不用改。」
 *
 * 這個檔案是後端的那一半（前端在 apps/web/src/features/database/fields/rating/）。
 * 除了這個檔案 + index.ts 多一行 import + shared-types 的 FieldType 多一個字串，
 * query-builder / service / routes / CSV 匯出全部沒有動過。
 */
import { z } from 'zod';
import { sql } from '../../../db/sql.js';
import { NUMBER_AGGS, NUMBER_OPS, baseDef, invalidValue, parseDef, unwrap } from './common.js';
import { compareNullable, defineFieldType, propText } from './types.js';

function maxOf(def: unknown): number {
  const raw = (def as { max?: number }).max;
  return Math.min(10, Math.max(1, Math.round(Number(raw) || 5)));
}

defineFieldType({
  type: 'rating',
  label: '星等',
  kind: 'number',
  computed: false,
  groupable: true,
  sortable: true,
  sqlCapable: true,
  validateConfig: (d) =>
    parseDef(
      z.object({
        ...baseDef,
        type: z.literal('rating'),
        max: z.number().int().min(1).max(10).default(5),
        icon: z.enum(['star', 'heart', 'number']).default('star'),
      }),
      d,
    ),
  defaultValue: () => null,
  normalize: (v, def) => {
    if (v === null || v === undefined || v === '') return null;
    const raw = unwrap(v, 'rating');
    if (raw === null || raw === undefined || raw === '') return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) throw invalidValue('星等必須是數字');
    const clamped = Math.max(0, Math.min(maxOf(def), Math.round(n)));
    return clamped === 0 ? null : { type: 'rating', rating: clamped };
  },
  toSqlExpr: (propertyId) => sql`((p.properties -> ${propertyId} ->> 'rating')::numeric)`,
  toGroupKeySql: (propertyId) => propText(propertyId, 'rating'),
  filterOperators: NUMBER_OPS,
  aggregations: NUMBER_AGGS,
  compare: (a, b) =>
    compareNullable(
      a && a.type === 'rating' ? a.rating : null,
      b && b.type === 'rating' ? b.rating : null,
      (x, y) => x - y,
    ),
  groupKeys: (v) => [v && v.type === 'rating' ? String(v.rating) : null],
  groupLabel: (key, def) => ({ label: key === null ? '未評分' : `${key} / ${maxOf(def)}` }),
  toPlainText: (v, def) => (v && v.type === 'rating' ? `${v.rating}/${maxOf(def)}` : ''),
  fromPlainText: (text, def) => {
    const n = Number(text.trim().split('/')[0]);
    if (!Number.isFinite(n) || n <= 0) return null;
    return { type: 'rating', rating: Math.max(1, Math.min(maxOf(def), Math.round(n))) };
  },
});
