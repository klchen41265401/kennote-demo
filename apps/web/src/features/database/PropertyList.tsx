/**
 * 屬性清單：顯示／隱藏、拖曳排序、新增屬性（含完整型別選單）。
 * 型別選單的內容全部來自 field registry，新增型別不用改這裡。
 */
import { useState } from 'react';
import type { CollectionSchema, FieldType, ViewFormat } from '@kennote/shared-types';
import { FieldIcon, Menu, MenuItem, MenuLabel, Popover, UiIcon, reorder, useDragHandle, useDropZone } from './_fallback';
import { useDatabaseContext } from './context';
import { FieldConfigPopover } from './FieldConfigPopover';
import { fieldTypeGroups, getFieldType } from './fields/types';
import { alignViewProperties } from './views/types';
import styles from './Builders.module.css';

interface Props {
  schema: CollectionSchema;
  format: ViewFormat;
  onChangeFormat: (format: ViewFormat) => void;
}

interface Entry {
  property: string;
  visible: boolean;
}

/** format.properties 沒列到的欄位排在最後、預設顯示 */
function entriesOf(schema: CollectionSchema, format: ViewFormat): Entry[] {
  const configured = format.properties ?? [];
  const seen = new Set<string>();
  const out: Entry[] = [];
  for (const item of configured) {
    if (!schema[item.property] || seen.has(item.property)) continue;
    seen.add(item.property);
    out.push({ property: item.property, visible: item.visible !== false });
  }
  for (const property of Object.keys(schema)) {
    if (seen.has(property)) continue;
    out.push({ property, visible: true });
  }
  return out;
}

export function PropertyList({ schema, format, onChangeFormat }: Props) {
  const { applySchemaOps } = useDatabaseContext();
  const entries = entriesOf(schema, format);
  const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null);
  const [configFor, setConfigFor] = useState<{ property: string; anchor: HTMLElement } | null>(null);

  function commit(next: Entry[]) {
    const widths = new Map((format.properties ?? []).map((p) => [p.property, p.width]));
    onChangeFormat({
      ...format,
      properties: next.map((e) => ({
        property: e.property,
        visible: e.visible,
        ...(widths.get(e.property) ? { width: widths.get(e.property) as number } : {}),
      })),
    });
  }

  async function addProperty(type: FieldType) {
    setAddAnchor(null);
    const fieldType = getFieldType(type);
    const baseName = fieldType.label;
    const taken = new Set(Object.values(schema).map((d) => d?.name));
    let name = baseName;
    let n = 2;
    while (taken.has(name)) name = `${baseName} ${n++}`;
    const added = await applySchemaOps([{ op: 'add', definition: fieldType.defaultConfig(name) }]);
    // BUG-8：不接到 format.properties 尾端的話，順序會退回 jsonb 的 key 排序
    if (added.length > 0) {
      onChangeFormat({ ...format, properties: alignViewProperties(format, schema, added) });
    }
  }

  return (
    <div className={styles.panel}>
      <MenuLabel>此視圖顯示的屬性</MenuLabel>
      <div className={styles.propertyList}>
        {entries.map((entry, index) => (
          <PropertyRow
            key={entry.property}
            entry={entry}
            index={index}
            schema={schema}
            onToggle={() =>
              commit(entries.map((e, i) => (i === index ? { ...e, visible: !e.visible } : e)))
            }
            onMove={(from, to) => commit(reorder(entries, from, to))}
            onConfig={(anchor) => setConfigFor({ property: entry.property, anchor })}
          />
        ))}
      </div>

      <button
        type="button"
        className={styles.ghostButton}
        onClick={(e) => setAddAnchor(e.currentTarget)}
      >
        <UiIcon name="plus" size={12} /> 新增屬性
      </button>

      <Popover open={addAnchor !== null} anchor={addAnchor} onClose={() => setAddAnchor(null)}>
        <Menu ariaLabel="屬性類型">
          {fieldTypeGroups().map((group) => (
            <div key={group.group}>
              <MenuLabel>{group.label}</MenuLabel>
              {group.types
                .filter((t) => t.type !== 'title')
                .map((t) => (
                  <MenuItem
                    key={t.type}
                    icon={<FieldIcon type={t.type} />}
                    onSelect={() => void addProperty(t.type)}
                  >
                    {t.label}
                  </MenuItem>
                ))}
            </div>
          ))}
        </Menu>
      </Popover>

      {configFor ? (
        <FieldConfigPopover
          propertyId={configFor.property}
          anchor={configFor.anchor}
          onClose={() => setConfigFor(null)}
        />
      ) : null}
    </div>
  );
}

interface RowProps {
  entry: Entry;
  index: number;
  schema: CollectionSchema;
  onToggle: () => void;
  onMove: (from: number, to: number) => void;
  onConfig: (anchor: HTMLElement) => void;
}

function PropertyRow({ entry, index, schema, onToggle, onMove, onConfig }: RowProps) {
  const def = schema[entry.property];
  const { dragging, handlers } = useDragHandle({ kind: 'property', id: entry.property, index });
  const drop = useDropZone({
    accept: 'property',
    onDrop: (payload) => {
      if (payload.index !== undefined) onMove(payload.index, index);
    },
  });
  if (!def) return null;

  return (
    <div
      className={`${styles.propertyRow} ${dragging ? styles.rowDragging : ''} ${
        drop.over ? styles.rowOver : ''
      }`}
      {...drop.handlers}
    >
      <span className={styles.dragHandle} {...handlers} aria-hidden="true">
        <UiIcon name="drag" size={12} />
      </span>
      <FieldIcon type={def.type} />
      <button
        type="button"
        className={styles.propertyName}
        onClick={(e) => onConfig(e.currentTarget)}
        title="編輯屬性"
      >
        {def.name}
      </button>
      <button
        type="button"
        className={styles.iconButton}
        aria-label={entry.visible ? '隱藏' : '顯示'}
        disabled={entry.property === 'title'}
        onClick={onToggle}
      >
        <UiIcon name={entry.visible ? 'eye' : 'eyeOff'} size={14} />
      </button>
    </div>
  );
}
