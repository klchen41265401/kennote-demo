/**
 * 陣列型別（multiSelect / person / relation / files）的 filter SQL。
 *
 * 關鍵取捨（03 §7.3）：`@>` 容器查詢吃得到 GIN jsonb_path_ops，
 * `->>` + 轉型吃不到。所以能用 `@>` 表達的一律用 `@>`。
 */
import type { FilterOperator } from '@kennote/shared-types';
import { AppError } from '../../../lib/errors.js';
import { sql, type Sql } from '../../../db/sql.js';

export function arrayJson(propertyId: string, arrayKey: string): Sql {
  return sql`(p.properties -> ${propertyId} -> ${arrayKey})`;
}

/** properties @> {"<pid>": {"<key>": ["<value>"]}} —— 整句都是參數，沒有字串拼接 */
function containsJson(propertyId: string, arrayKey: string, value: string): Sql {
  return sql`p.properties @> jsonb_build_object(
    ${propertyId}::text,
    jsonb_build_object(${arrayKey}::text, jsonb_build_array(${value}::text))
  )`;
}

export function buildArrayFilterSql(
  propertyId: string,
  arrayKey: string,
  operator: FilterOperator,
  value: unknown,
): Sql {
  const arr = arrayJson(propertyId, arrayKey);

  switch (operator) {
    case 'isEmpty':
      return sql`coalesce(jsonb_array_length(${arr}), 0) = 0`;
    case 'isNotEmpty':
      return sql`coalesce(jsonb_array_length(${arr}), 0) > 0`;
    case 'contains':
    case 'is':
      return containsJson(propertyId, arrayKey, String(value));
    case 'doesNotContain':
    case 'isNot':
      return sql`NOT (${containsJson(propertyId, arrayKey, String(value))})`;
    case 'isAnyOf': {
      const list = (Array.isArray(value) ? value : [value]).map(String);
      if (list.length === 0) return sql`false`;
      return sql`(${sql.join(
        list.map((v) => containsJson(propertyId, arrayKey, v)),
        ' OR ',
      )})`;
    }
    case 'isNoneOf': {
      const list = (Array.isArray(value) ? value : [value]).map(String);
      if (list.length === 0) return sql`true`;
      return sql`NOT (${sql.join(
        list.map((v) => containsJson(propertyId, arrayKey, v)),
        ' OR ',
      )})`;
    }
    default:
      throw new AppError('INVALID_FILTER', `陣列欄位不支援運算子 ${operator}`, { operator });
  }
}
