/**
 * 圖庫（01 §5.3 M4.3.4）。封面來源三選一：
 * 頁面封面 / 某個 files 屬性的第一張圖 / 無（純文字卡）。
 */
import type { CoverSource, DatabaseRow } from '@kennote/shared-types';
import { richTextToPlainText } from '@kennote/shared-types';
import { UiIcon } from '../../_fallback';
import { EditableCell } from '../../EditableCell';
import { useDatabaseContext } from '../../context';
import type { ViewProps } from '../types';
import { visibleProperties } from '../types';
import styles from './GalleryView.module.css';

/** 依設定找出這一列的封面圖網址；找不到回 null（卡片就只有文字） */
export function resolveCover(row: DatabaseRow, source: CoverSource | undefined): string | null {
  const kind = source?.type ?? 'pageCover';
  if (kind === 'none') return null;
  if (kind === 'pageCover') return row.cover ?? null;
  if (kind === 'property' && source && source.type === 'property') {
    const value = row.properties[source.property];
    if (value && value.type === 'files') {
      const first = value.files[0];
      return first?.externalUrl ?? (first?.fileId ? `/api/files/${first.fileId}` : null);
    }
    return null;
  }
  // pageContent：頁面內容的第一張圖要載入 block 才知道，M4 先退回頁面封面
  return row.cover ?? null;
}

export function GalleryView(props: ViewProps) {
  const { view, schema, rows, hasMore, loadMore } = props;
  const { readOnly } = useDatabaseContext();
  const size = view.format?.gallerySize ?? 'medium';
  const properties = visibleProperties(schema, view.format)
    .filter((c) => c.property !== 'title')
    .slice(0, 4);

  return (
    <div className={styles.wrapper}>
      <div className={styles.grid} data-size={size}>
        {rows.map((row) => {
          const cover = resolveCover(row, view.format?.galleryCover);
          return (
            <article key={row.id} className={styles.card} onClick={() => props.openRow(row.id)}>
              <div className={styles.cover} data-empty={cover ? undefined : 'true'}>
                {cover ? (
                  <img
                    src={cover}
                    alt=""
                    className={view.format?.galleryFitImage ? styles.fit : styles.fill}
                  />
                ) : (
                  <span className={styles.coverGlyph} aria-hidden="true">
                    {row.icon ?? '📄'}
                  </span>
                )}
              </div>
              <div className={styles.cardBody}>
                <h4 className={styles.cardTitle}>{richTextToPlainText(row.title) || '未命名'}</h4>
                {properties.map(({ property }) => {
                  const def = schema[property];
                  if (!def || !row.properties[property]) return null;
                  return (
                    <div
                      key={property}
                      className={styles.cardProperty}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <EditableCell
                        propertyId={property}
                        def={def}
                        row={row}
                        value={row.properties[property]}
                        compact
                        readOnly={readOnly}
                        onCommit={(value) => props.setCellValue(row.id, property, value)}
                      />
                    </div>
                  );
                })}
              </div>
            </article>
          );
        })}
        {!readOnly ? (
          <button type="button" className={styles.newCard} onClick={() => void props.createRow()}>
            <UiIcon name="plus" size={16} />
            新增
          </button>
        ) : null}
      </div>
      {hasMore ? (
        <button type="button" className={styles.loadMore} onClick={loadMore}>
          載入更多
        </button>
      ) : null}
    </div>
  );
}
