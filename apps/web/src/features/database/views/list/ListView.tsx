/** 清單：table 的簡化渲染（01 §5.3 M4.3.3）。一行一列，標題 + 少數屬性。 */
import { richTextToPlainText } from '@kennote/shared-types';
import { UiIcon, VirtualList } from '../../_fallback';
import { EditableCell } from '../../EditableCell';
import { useDatabaseContext } from '../../context';
import type { ViewProps } from '../types';
import { visibleProperties } from '../types';
import styles from './ListView.module.css';

const ROW_HEIGHT = 36;

export function ListView(props: ViewProps) {
  const { view, schema, rows, hasMore, loadMore } = props;
  const { readOnly } = useDatabaseContext();
  const showProperties = view.format?.listShowProperties ?? true;
  const properties = visibleProperties(schema, view.format)
    .filter((c) => c.property !== 'title')
    .slice(0, 3);

  return (
    <div className={styles.wrapper}>
      <VirtualList
        items={rows}
        itemHeight={ROW_HEIGHT}
        className={styles.body}
        ariaLabel="資料列"
        onEndReached={hasMore ? loadMore : undefined}
        renderItem={(row) => (
          <div key={row.id} className={styles.row} onClick={() => props.openRow(row.id)}>
            <span className={styles.icon} aria-hidden="true">
              {row.icon ?? '📄'}
            </span>
            <span className={styles.title}>{richTextToPlainText(row.title) || '未命名'}</span>
            {showProperties ? (
              <span className={styles.props} onClick={(e) => e.stopPropagation()}>
                {properties.map(({ property }) => {
                  const def = schema[property];
                  if (!def) return null;
                  return (
                    <span key={property} className={styles.prop}>
                      <EditableCell
                        propertyId={property}
                        def={def}
                        row={row}
                        value={row.properties[property]}
                        compact
                        readOnly={readOnly}
                        onCommit={(value) => props.setCellValue(row.id, property, value)}
                      />
                    </span>
                  );
                })}
              </span>
            ) : null}
          </div>
        )}
        footer={
          !readOnly ? (
            <button type="button" className={styles.newRow} onClick={() => void props.createRow()}>
              <UiIcon name="plus" size={14} />
              新頁面
            </button>
          ) : null
        }
      />
    </div>
  );
}
