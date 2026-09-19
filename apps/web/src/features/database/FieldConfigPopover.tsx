/**
 * 欄位設定浮層：改名 / 改型別 / 型別專屬設定 / 刪除。
 *
 * 02 §4.3.1 的「必做」：改型別前先呼叫 preview-cast，
 * 由後端回「將影響 N 筆、其中 M 筆無法轉換」，前端據此顯示確認對話框。
 * **絕不可**靜默轉換並丟失資料。
 */
import { useEffect, useState } from 'react';
import type { CastPreview, FieldDefinition, FieldType } from '@kennote/shared-types';
import { Dialog, FieldIcon, Menu, MenuItem, MenuLabel, MenuSeparator, Popover } from './_fallback';
import * as api from './api';
import { useDatabaseContext } from './context';
import { fieldTypeGroups, getFieldType } from './fields/types';
import styles from './Builders.module.css';

interface Props {
  propertyId: string;
  anchor: HTMLElement | null;
  onClose: () => void;
  /** 刪除欄位後要做的事（例如關閉整個面板） */
  onDeleted?: () => void;
}

export function FieldConfigPopover({ propertyId, anchor, onClose, onDeleted }: Props) {
  const { collectionId, schema, applySchemaOps } = useDatabaseContext();
  const def = schema[propertyId];
  const [name, setName] = useState(def?.name ?? '');
  const [typeMenu, setTypeMenu] = useState<HTMLElement | null>(null);
  const [pendingCast, setPendingCast] = useState<{ preview: CastPreview; toType: FieldType } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(def?.name ?? '');
  }, [def?.name]);

  if (!def) return null;
  const fieldType = getFieldType(def.type);
  const Config = fieldType.Config;

  async function rename() {
    if (name.trim() === '' || name === def?.name) return;
    await applySchemaOps([{ op: 'rename', propertyId, name: name.trim() }]);
  }

  async function updateConfig(next: FieldDefinition) {
    await applySchemaOps([{ op: 'update', propertyId, definition: next }]);
  }

  async function askCast(toType: FieldType) {
    setTypeMenu(null);
    if (toType === def?.type) return;
    setBusy(true);
    try {
      const preview = await api.previewCast(collectionId, propertyId, toType);
      setPendingCast({ preview, toType });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Popover open anchor={anchor} onClose={onClose} minWidth={280}>
        <div className={styles.panel}>
          <input
            className={styles.nameInput}
            value={name}
            data-autofocus
            onChange={(e) => setName(e.target.value)}
            onBlur={() => void rename()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void rename();
              }
            }}
          />

          <button
            type="button"
            className={styles.typeButton}
            disabled={busy}
            onClick={(e) => setTypeMenu(e.currentTarget)}
          >
            <FieldIcon type={def.type} />
            <span>{fieldType.label}</span>
            <span className={styles.typeHint}>變更型別</span>
          </button>

          {Config ? (
            <Config
              propertyId={propertyId}
              def={def}
              schema={schema}
              onChange={(next) => void updateConfig(next)}
            />
          ) : null}

          <MenuSeparator />
          <button
            type="button"
            className={styles.dangerButton}
            disabled={propertyId === 'title'}
            onClick={async () => {
              await applySchemaOps([{ op: 'delete', propertyId }]);
              onDeleted?.();
              onClose();
            }}
          >
            刪除屬性
          </button>
          {propertyId === 'title' ? (
            <p className={styles.hint}>標題欄位不能刪除，也不能改型別。</p>
          ) : null}
        </div>
      </Popover>

      {/* 型別選單：Notion 的全部型別，依基本／進階／系統分組 */}
      <Popover open={typeMenu !== null} anchor={typeMenu} onClose={() => setTypeMenu(null)}>
        <Menu ariaLabel="屬性類型">
          {fieldTypeGroups().map((group) => (
            <div key={group.group}>
              <MenuLabel>{group.label}</MenuLabel>
              {group.types.map((t) => (
                <MenuItem
                  key={t.type}
                  icon={<FieldIcon type={t.type} />}
                  selected={t.type === def.type}
                  disabled={propertyId === 'title' || t.type === 'title'}
                  onSelect={() => void askCast(t.type)}
                >
                  {t.label}
                </MenuItem>
              ))}
            </div>
          ))}
        </Menu>
      </Popover>

      {/* 型別切換的確認對話框：明確預告資料損失 */}
      <Dialog
        open={pendingCast !== null}
        onClose={() => setPendingCast(null)}
        title={<strong>變更屬性類型</strong>}
        width={420}
        footer={
          <>
            <button type="button" className={styles.ghostButton} onClick={() => setPendingCast(null)}>
              取消
            </button>
            <button
              type="button"
              className={styles.primaryButton}
              data-autofocus
              onClick={async () => {
                if (!pendingCast) return;
                const base = { name: def.name, type: pendingCast.toType } as FieldDefinition;
                await applySchemaOps([
                  { op: 'retype', propertyId, definition: getDefaultConfig(pendingCast.toType, base) },
                ]);
                setPendingCast(null);
                onClose();
              }}
            >
              仍要變更
            </button>
          </>
        }
      >
        {pendingCast ? (
          <div className={styles.castBody}>
            <p>
              將「{def.name}」從 <strong>{getFieldType(pendingCast.preview.fromType).label}</strong> 改成{' '}
              <strong>{getFieldType(pendingCast.toType).label}</strong>。
            </p>
            <p>
              影響 <strong>{pendingCast.preview.affected}</strong> 筆，其中{' '}
              <strong>{pendingCast.preview.lossy}</strong> 筆無法轉換，
              <strong>會被清除</strong>。
            </p>
            {pendingCast.preview.samples.length > 0 ? (
              <ul className={styles.castSamples}>
                {pendingCast.preview.samples.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </Dialog>
    </>
  );
}

function getDefaultConfig(type: FieldType, base: FieldDefinition): FieldDefinition {
  return { ...getFieldType(type).defaultConfig(base.name), name: base.name } as FieldDefinition;
}
