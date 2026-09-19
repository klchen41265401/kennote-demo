/**
 * 欄位設定面板（FieldConfigPopover 會依型別渲染對應的那一個）。
 */
import { useMemo, useState } from 'react';
import type { FieldDefinition, SelectColor, SelectOption } from '@kennote/shared-types';
import { SELECT_COLORS, compileFormula, listFormulaFunctions, schemaPropertyResolver } from '@kennote/shared-types';
import { UiIcon } from '../../_fallback';
import type { ConfigProps } from '../types';
import styles from './fields.module.css';
import { optionList } from './ops';

export function EmptyConfig() {
  return <p className={styles.configHint}>這個型別沒有額外設定。</p>;
}

export function NumberConfig({ def, onChange }: ConfigProps) {
  const config = def as Extract<FieldDefinition, { type: 'number' }>;
  return (
    <div className={styles.configBody}>
      <label className={styles.configRow}>
        <span>格式</span>
        <select
          value={config.numberFormat ?? 'number'}
          onChange={(e) => onChange({ ...config, numberFormat: e.target.value as never })}
        >
          <option value="number">數字</option>
          <option value="numberWithCommas">千分位</option>
          <option value="percent">百分比</option>
          <option value="currencyTwd">新台幣</option>
          <option value="currencyUsd">美元</option>
          <option value="yen">日圓</option>
          <option value="euro">歐元</option>
        </select>
      </label>
      <label className={styles.configRow}>
        <span>小數位數</span>
        <input
          type="number"
          min={0}
          max={10}
          value={config.precision ?? ''}
          placeholder="自動"
          onChange={(e) =>
            onChange({ ...config, precision: e.target.value === '' ? null : Number(e.target.value) })
          }
        />
      </label>
    </div>
  );
}

let optionSeq = 0;
function newOptionId(taken: Set<string>): string {
  for (;;) {
    optionSeq += 1;
    const id = `opt_${Date.now().toString(36)}${optionSeq.toString(36)}`;
    if (!taken.has(id)) return id;
  }
}

export function OptionsConfig({ def, onChange }: ConfigProps) {
  const options = optionList(def);
  const [draft, setDraft] = useState('');

  function update(next: SelectOption[]) {
    onChange({ ...(def as object), options: next } as FieldDefinition);
  }

  function add() {
    const label = draft.trim();
    if (label === '') return;
    update([
      ...options,
      {
        id: newOptionId(new Set(options.map((o) => o.id))),
        value: label,
        color: SELECT_COLORS[(options.length % (SELECT_COLORS.length - 1)) + 1] as SelectColor,
      },
    ]);
    setDraft('');
  }

  return (
    <div className={styles.configBody}>
      <p className={styles.configLabel}>選項</p>
      <ul className={styles.optionList}>
        {options.map((option, index) => (
          <li key={option.id} className={styles.optionRow}>
            <select
              className={styles.optionColor}
              data-color={option.color}
              value={option.color}
              aria-label="顏色"
              onChange={(e) =>
                update(
                  options.map((o) =>
                    o.id === option.id ? { ...o, color: e.target.value as SelectColor } : o,
                  ),
                )
              }
            >
              {SELECT_COLORS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input
              className={styles.optionName}
              value={option.value}
              onChange={(e) =>
                update(
                  options.map((o) => (o.id === option.id ? { ...o, value: e.target.value } : o)),
                )
              }
            />
            <button
              type="button"
              className={styles.optionMove}
              aria-label="上移"
              disabled={index === 0}
              onClick={() => {
                const next = [...options];
                const prev = next[index - 1];
                const cur = next[index];
                if (!prev || !cur) return;
                next[index - 1] = cur;
                next[index] = prev;
                update(next);
              }}
            >
              ↑
            </button>
            <button
              type="button"
              className={styles.optionRemove}
              aria-label="刪除選項"
              onClick={() => update(options.filter((o) => o.id !== option.id))}
            >
              <UiIcon name="close" size={12} />
            </button>
          </li>
        ))}
      </ul>
      <div className={styles.configRow}>
        <input
          value={draft}
          placeholder="新增選項"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" onClick={add}>
          新增
        </button>
      </div>
      <p className={styles.configHint}>
        選項的 id 是穩定的：改名不會動到任何一列的資料，看板分組設定也不會斷。
      </p>
    </div>
  );
}

export function DateConfig({ def, onChange }: ConfigProps) {
  const config = def as Extract<FieldDefinition, { type: 'date' }>;
  return (
    <div className={styles.configBody}>
      <label className={styles.configRow}>
        <span>日期格式</span>
        <select
          value={config.dateFormat ?? 'YYYY/MM/DD'}
          onChange={(e) => onChange({ ...config, dateFormat: e.target.value })}
        >
          <option value="YYYY/MM/DD">2026/09/19</option>
          <option value="YYYY-MM-DD">2026-09-19</option>
          <option value="MM/DD/YYYY">09/19/2026</option>
          <option value="DD/MM/YYYY">19/09/2026</option>
        </select>
      </label>
      <label className={styles.configCheck}>
        <input
          type="checkbox"
          checked={config.includeTimeDefault ?? false}
          onChange={(e) => onChange({ ...config, includeTimeDefault: e.target.checked })}
        />
        預設包含時間
      </label>
    </div>
  );
}

export function RatingConfig({ def, onChange }: ConfigProps) {
  const config = def as Extract<FieldDefinition, { type: 'rating' }>;
  return (
    <div className={styles.configBody}>
      <label className={styles.configRow}>
        <span>上限</span>
        <input
          type="number"
          min={1}
          max={10}
          value={config.max ?? 5}
          onChange={(e) => onChange({ ...config, max: Number(e.target.value) })}
        />
      </label>
      <label className={styles.configRow}>
        <span>圖示</span>
        <select
          value={config.icon ?? 'star'}
          onChange={(e) => onChange({ ...config, icon: e.target.value as never })}
        >
          <option value="star">★ 星星</option>
          <option value="heart">♥ 愛心</option>
          <option value="number">數字</option>
        </select>
      </label>
    </div>
  );
}

export function PersonConfig({ def, onChange }: ConfigProps) {
  const config = def as Extract<FieldDefinition, { type: 'person' }>;
  return (
    <div className={styles.configBody}>
      <label className={styles.configCheck}>
        <input
          type="checkbox"
          checked={config.allowMultiple ?? true}
          onChange={(e) => onChange({ ...config, allowMultiple: e.target.checked })}
        />
        允許多人
      </label>
    </div>
  );
}

export function FilesConfig({ def, onChange }: ConfigProps) {
  const config = def as Extract<FieldDefinition, { type: 'files' }>;
  return (
    <div className={styles.configBody}>
      <label className={styles.configRow}>
        <span>最多檔案數</span>
        <input
          type="number"
          min={1}
          max={100}
          value={config.maxFiles ?? 10}
          onChange={(e) => onChange({ ...config, maxFiles: Number(e.target.value) })}
        />
      </label>
    </div>
  );
}

export function RelationConfig({ def, onChange }: ConfigProps) {
  const config = def as Extract<FieldDefinition, { type: 'relation' }>;
  return (
    <div className={styles.configBody}>
      <label className={styles.configRow}>
        <span>目標資料庫</span>
        <input
          value={config.collectionId ?? ''}
          placeholder="collection id"
          onChange={(e) => onChange({ ...config, collectionId: e.target.value || null })}
        />
      </label>
      <label className={styles.configRow}>
        <span>反向欄位 id</span>
        <input
          value={config.dualProperty ?? ''}
          placeholder="留空 = 單向關聯"
          onChange={(e) => onChange({ ...config, dualProperty: e.target.value || null })}
        />
      </label>
      <label className={styles.configCheck}>
        <input
          type="checkbox"
          checked={config.allowMultiple ?? true}
          onChange={(e) => onChange({ ...config, allowMultiple: e.target.checked })}
        />
        允許關聯多列
      </label>
      <p className={styles.configHint}>
        設定反向欄位後，A 加了 B，B 的反向欄位也會出現 A（後端在同一個交易內維護）。
      </p>
    </div>
  );
}

export function RollupConfig({ def, schema, onChange }: ConfigProps) {
  const config = def as Extract<FieldDefinition, { type: 'rollup' }>;
  const relations = Object.entries(schema).filter(([, d]) => d?.type === 'relation');
  return (
    <div className={styles.configBody}>
      <label className={styles.configRow}>
        <span>沿著關聯</span>
        <select
          value={config.relationProperty ?? ''}
          onChange={(e) => onChange({ ...config, relationProperty: e.target.value || null })}
        >
          <option value="">選擇關聯欄位</option>
          {relations.map(([id, d]) => (
            <option key={id} value={id}>
              {d?.name}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.configRow}>
        <span>目標欄位 id</span>
        <input
          value={config.targetProperty ?? ''}
          placeholder="留空 = 標題"
          onChange={(e) => onChange({ ...config, targetProperty: e.target.value || null })}
        />
      </label>
      <label className={styles.configRow}>
        <span>計算</span>
        <select
          value={config.function ?? 'count'}
          onChange={(e) => onChange({ ...config, function: e.target.value as never })}
        >
          <option value="count">計數</option>
          <option value="countValues">值的數量</option>
          <option value="countUnique">相異值</option>
          <option value="sum">總和</option>
          <option value="average">平均</option>
          <option value="median">中位數</option>
          <option value="min">最小值</option>
          <option value="max">最大值</option>
          <option value="range">全距</option>
          <option value="earliestDate">最早日期</option>
          <option value="latestDate">最晚日期</option>
          <option value="showOriginal">顯示原值</option>
        </select>
      </label>
    </div>
  );
}

export function FormulaConfig({ propertyId, def, schema, onChange }: ConfigProps) {
  const config = def as Extract<FieldDefinition, { type: 'formula' }>;
  const [expression, setExpression] = useState(config.expression ?? '');

  // 即時編譯：使用者打字時就知道語法／型別／欄位有沒有問題，不必等存檔
  const compiled = useMemo(() => {
    if (expression.trim() === '') return { error: null, resultType: 'any' as const };
    const withoutSelf = { ...schema };
    delete withoutSelf[propertyId];
    try {
      const result = compileFormula(expression, schemaPropertyResolver(withoutSelf));
      return { error: null, resultType: result.resultType };
    } catch (err) {
      return { error: err instanceof Error ? err.message : '公式錯誤', resultType: 'any' as const };
    }
  }, [expression, schema, propertyId]);

  return (
    <div className={styles.configBody}>
      <p className={styles.configLabel}>運算式</p>
      <textarea
        className={styles.formulaInput}
        rows={3}
        value={expression}
        spellCheck={false}
        placeholder={'dateBetween(prop("截止日"), now(), "days")'}
        onChange={(e) => setExpression(e.target.value)}
        onBlur={() => onChange({ ...config, expression })}
      />
      {compiled.error ? (
        <p className={styles.formulaError}>{compiled.error}</p>
      ) : (
        <p className={styles.configHint}>結果型別：{compiled.resultType}</p>
      )}
      <details className={styles.formulaHelp}>
        <summary>可用函式</summary>
        <ul>
          {listFormulaFunctions().map((fn) => (
            <li key={fn.name}>
              <code>{fn.signature}</code> — {fn.description}
            </li>
          ))}
          <li>
            <code>prop(&quot;欄位名稱&quot;)</code> — 取這一列的欄位值
          </li>
        </ul>
      </details>
    </div>
  );
}
