/**
 * 公式引擎與 database 欄位值之間的橋。
 *
 * 只 import 型別（`import type`），因此執行期不會與 database.ts 形成循環相依。
 */
import type {
  CollectionSchema,
  FieldDefinition,
  FieldType,
  FieldValue,
  RowProperties,
  SelectOption,
} from '../database.js';
import type { FormulaType, FormulaValue } from './ast.js';
import { FormulaError } from './ast.js';
import { compileFormula, detectFormulaCycles, type PropertyResolver } from './compile.js';
import { evaluateFormula } from './evaluate.js';

/** 欄位型別 → 公式型別。新增欄位型別時記得補一行，否則預設當文字 */
export function formulaTypeOfField(def: FieldDefinition | undefined): FormulaType {
  if (!def) return 'any';
  switch (def.type) {
    case 'number':
    case 'rating':
      return 'number';
    case 'checkbox':
      return 'boolean';
    case 'date':
    case 'createdTime':
    case 'lastEditedTime':
      return 'date';
    case 'formula':
      return def.resultType ?? 'any';
    case 'rollup':
      return 'any';
    default:
      return 'string';
  }
}

function optionLabel(def: FieldDefinition, id: string | null): string {
  if (!id) return '';
  const options = (def as { options?: SelectOption[] }).options ?? [];
  return options.find((o) => o.id === id)?.value ?? '';
}

/** 一格的值 → 公式值。空值一律是 null（讓 empty() 與 NULL 傳染行為一致） */
export function fieldValueToFormulaValue(
  value: FieldValue | undefined,
  def: FieldDefinition | undefined,
): FormulaValue {
  if (value === undefined || def === undefined) {
    // checkbox 沒有值時是 false，不是空
    return def && def.type === 'checkbox' ? false : null;
  }
  switch (value.type) {
    case 'title':
    case 'text':
      return value.plainText === '' ? null : value.plainText;
    case 'number':
      return value.number;
    case 'rating':
      return value.rating;
    case 'checkbox':
      return value.checkbox;
    case 'select':
      return value.optionId ? optionLabel(def, value.optionId) : null;
    case 'multiSelect':
      return value.optionIds.length === 0
        ? null
        : value.optionIds.map((id) => optionLabel(def, id)).join(', ');
    case 'date':
    case 'createdTime':
    case 'lastEditedTime': {
      const d = new Date(value.start);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    case 'url':
      return value.url;
    case 'email':
      return value.email;
    case 'phone':
      return value.phone;
    case 'person':
    case 'createdBy':
    case 'lastEditedBy':
      return value.userIds.length === 0 ? null : value.userIds.join(', ');
    case 'files':
      return value.files.length === 0 ? null : value.files.map((f) => f.name).join(', ');
    case 'relation':
      return value.pageIds.length === 0 ? null : value.pageIds.join(', ');
    case 'rollup':
    case 'formula':
      return value.value;
    default:
      return null;
  }
}

/** 建立 prop("…") 的解析器：先比對 propertyId，再比對顯示名稱 */
export function schemaPropertyResolver(schema: CollectionSchema): PropertyResolver {
  const byName = new Map<string, string>();
  for (const [id, def] of Object.entries(schema)) {
    if (def && typeof def.name === 'string') byName.set(def.name, id);
  }
  return (nameOrId: string) => {
    const id = schema[nameOrId] ? nameOrId : byName.get(nameOrId);
    if (!id) return null;
    return { propertyId: id, type: formulaTypeOfField(schema[id]) };
  };
}

export interface CompiledFieldFormula {
  expression: string;
  ast: import('./ast.js').FormulaAst | null;
  resultType: FormulaType;
  dependsOn: string[];
  error?: string | null;
}

/** 編譯一個 formula 欄位定義（給 schema 驗證用）。失敗時不丟例外，把錯誤寫進 error */
export function compileFieldFormula(
  expression: string,
  schema: CollectionSchema,
): CompiledFieldFormula {
  try {
    const compiled = compileFormula(expression, schemaPropertyResolver(schema));
    return {
      expression,
      ast: compiled.ast,
      resultType: compiled.resultType,
      dependsOn: compiled.dependsOn,
      error: null,
    };
  } catch (err) {
    return {
      expression,
      ast: null,
      resultType: 'any',
      dependsOn: [],
      error: err instanceof Error ? err.message : '公式無法編譯',
    };
  }
}

/**
 * 整個 schema 的公式循環引用檢查。
 * 回傳每個環的**欄位名稱**串（直接給使用者看），沒有環則回空陣列。
 */
export function findSchemaFormulaCycles(schema: CollectionSchema): string[][] {
  const graph: Record<string, string[]> = {};
  for (const [id, def] of Object.entries(schema)) {
    if (def?.type === 'formula') graph[id] = def.dependsOn ?? [];
    else if (def?.type === 'rollup') graph[id] = def.relationProperty ? [def.relationProperty] : [];
  }
  return detectFormulaCycles(graph).map((cycle) => cycle.map((id) => schema[id]?.name ?? id));
}

export interface RowFormulaContext {
  schema: CollectionSchema;
  properties: RowProperties;
  now: Date;
  /** 遞迴求值其他公式欄位（server 端在同一列內展開 formula 相依） */
  resolveComputed?: (propertyId: string) => FormulaValue;
}

/**
 * 求值一個 formula 欄位。丟出來的 FormulaError 由呼叫端轉成儲存格上的錯誤訊息。
 */
export function evaluateFieldFormula(
  def: FieldDefinition & { type: 'formula' },
  ctx: RowFormulaContext,
): FormulaValue {
  if (!def.ast) throw new FormulaError('SYNTAX', def.error ?? '公式尚未設定');
  return evaluateFormula(def.ast, {
    now: ctx.now,
    getProperty: (propertyId) => {
      const target = ctx.schema[propertyId];
      if (target && (target.type === 'formula' || target.type === 'rollup') && ctx.resolveComputed) {
        return ctx.resolveComputed(propertyId);
      }
      return fieldValueToFormulaValue(ctx.properties[propertyId], target);
    },
  });
}

/** 型別守門：formula/rollup 的結果型別 → 可比較的純量（排序與篩選用） */
export function formulaValueSortKey(v: FormulaValue): number | string | null {
  if (v === null) return null;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

export type { FieldType };
