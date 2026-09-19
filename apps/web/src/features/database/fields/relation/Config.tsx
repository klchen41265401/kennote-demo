/**
 * relation 的欄位設定（功能 QA 第三輪 BUG-11 的「缺口」那一段）。
 *
 * 之前這裡是兩個裸的文字輸入框：「目標資料庫」要貼 collection 的 **UUID**、
 * 「反向欄位 id」要手打對方的 **propertyId**。沒有人記得住那兩串東西，
 * 打錯了還會在目標列寫出 schema 裡不存在的孤兒屬性（BUG-11）。
 *
 * 現在照 Notion：
 *   1. **下拉選目標資料庫**（`GET /api/databases?workspaceId=`）
 *   2. **「在目標資料庫顯示反向欄位」開關** ＋ 反向欄位名稱
 *      → 打開時送 `PATCH /schema` 的 `update` op 帶 `createDual: { name }`，
 *        後端在同一個交易內於目標 collection 建好反向欄位並互指。
 *
 * 關掉開關只解除本欄的 `dualProperty`（單向化），**不會**去刪對方的欄位 ——
 * 刪欄位是破壞性動作，要在目標資料庫自己做。
 */
import { useEffect, useState } from 'react';
import type { FieldDefinition } from '@kennote/shared-types';
import { richTextToPlainText } from '@kennote/shared-types';
import { useWorkspaceDatabases } from '../../api';
import { useDatabaseContext } from '../../context';
import type { ConfigProps } from '../types';
import styles from '../_shared/fields.module.css';

type RelationDef = Extract<FieldDefinition, { type: 'relation' }>;

export function Config({ propertyId, def, onChange }: ConfigProps) {
  const config = def as RelationDef;
  const { workspaceId, collectionId, schema, applySchemaOps } = useDatabaseContext();
  const databases = useWorkspaceDatabases(workspaceId || null);
  const [dualName, setDualName] = useState(config.name || '關聯');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasDual = Boolean(config.dualProperty);
  const targetId = config.collectionId ?? '';
  // 自我關聯時反向欄位就在自己的 schema 裡，名稱可以直接查到
  const dualLabel =
    hasDual && targetId === collectionId
      ? (schema[config.dualProperty as string]?.name ?? config.dualProperty)
      : config.dualProperty;

  useEffect(() => {
    setError(null);
  }, [targetId]);

  async function toggleDual(next: boolean) {
    setError(null);
    if (!next) {
      onChange({ ...config, dualProperty: null });
      return;
    }
    if (!targetId) {
      setError('請先選擇目標資料庫');
      return;
    }
    const name = dualName.trim() || config.name || '關聯';
    setBusy(true);
    try {
      await applySchemaOps([
        {
          op: 'update',
          propertyId,
          definition: { ...config, dualProperty: null },
          createDual: { name },
        },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : '建立反向欄位失敗');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.configBody}>
      <label className={styles.configRow}>
        <span>目標資料庫</span>
        <select
          value={targetId}
          aria-label="目標資料庫"
          disabled={busy}
          onChange={(e) =>
            // 換目標就一定要解除舊的反向欄位，否則會指到另一個資料庫的欄位
            onChange({
              ...config,
              collectionId: e.target.value || null,
              dualProperty: null,
            })
          }
        >
          <option value="">選擇資料庫</option>
          {(databases.data ?? []).map((db) => (
            <option key={db.id} value={db.id}>
              {richTextToPlainText(db.name) || '未命名資料庫'}
              {db.id === collectionId ? '（這個資料庫）' : ''}
            </option>
          ))}
        </select>
      </label>

      <label className={styles.configCheck}>
        <input
          type="checkbox"
          checked={hasDual}
          disabled={busy || !targetId}
          onChange={(e) => void toggleDual(e.target.checked)}
        />
        在目標資料庫顯示反向欄位
      </label>

      {hasDual ? (
        <p className={styles.configHint}>
          反向欄位：<strong>{dualLabel}</strong>
          。A 加了 B，B 的反向欄位也會出現 A（後端在同一個交易內維護）。
        </p>
      ) : (
        <label className={styles.configRow}>
          <span>反向欄位名稱</span>
          <input
            value={dualName}
            placeholder="例如：相關任務"
            aria-label="反向欄位名稱"
            disabled={busy}
            onChange={(e) => setDualName(e.target.value)}
          />
        </label>
      )}

      <label className={styles.configCheck}>
        <input
          type="checkbox"
          checked={config.allowMultiple ?? true}
          disabled={busy}
          onChange={(e) => onChange({ ...config, allowMultiple: e.target.checked })}
        />
        允許關聯多列
      </label>

      {error ? (
        <p className={styles.configHint} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
