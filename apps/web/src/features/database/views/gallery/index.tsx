import { registerViewType, type ViewSettingsProps } from '../types';
import { GalleryView } from './GalleryView';
import styles from './GalleryView.module.css';

function GallerySettings({ view, schema, onChange }: ViewSettingsProps) {
  const format = view.format ?? {};
  const fileProperties = Object.entries(schema).filter(([, def]) => def?.type === 'files');
  const coverType = format.galleryCover?.type ?? 'pageCover';

  return (
    <div className={styles.settings}>
      <label>
        封面來源
        <select
          value={
            coverType === 'property' && format.galleryCover && format.galleryCover.type === 'property'
              ? `property:${format.galleryCover.property}`
              : coverType
          }
          onChange={(e) => {
            const value = e.target.value;
            const cover = value.startsWith('property:')
              ? ({ type: 'property', property: value.slice('property:'.length) } as const)
              : ({ type: value as 'none' | 'pageCover' | 'pageContent' } as const);
            onChange({ format: { ...format, galleryCover: cover } });
          }}
        >
          <option value="pageCover">頁面封面</option>
          <option value="pageContent">頁面內容首圖</option>
          <option value="none">無</option>
          {fileProperties.map(([id, def]) => (
            <option key={id} value={`property:${id}`}>
              {def?.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        卡片大小
        <select
          value={format.gallerySize ?? 'medium'}
          onChange={(e) => onChange({ format: { ...format, gallerySize: e.target.value as never } })}
        >
          <option value="small">小</option>
          <option value="medium">中</option>
          <option value="large">大</option>
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={format.galleryFitImage ?? false}
          onChange={(e) => onChange({ format: { ...format, galleryFitImage: e.target.checked } })}
        />
        完整顯示圖片
      </label>
    </div>
  );
}

registerViewType({
  type: 'gallery',
  label: '圖庫',
  icon: 'gallery',
  supportsGrouping: false,
  supportsSorting: true,
  supportsFiltering: true,
  supportsAggregation: false,
  Component: GalleryView,
  SettingsPanel: GallerySettings,
  defaultFormat: (schema) => ({
    galleryCover: { type: 'pageCover' },
    gallerySize: 'medium',
    properties: Object.keys(schema).map((property, i) => ({ property, visible: i < 4 })),
  }),
  getQueryHints: (view) => ({ pageSize: view.query?.pageSize ?? 50 }),
});
