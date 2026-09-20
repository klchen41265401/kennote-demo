/**
 * 側邊欄底部的「Demo 模式」小徽章。
 *
 * `VITE_DEMO` 沒開時整個元件回 null（正式站看不到這一行），
 * 點下去會問要不要重設瀏覽器裡的 demo 資料。
 */
import { useState } from 'react';

const DEMO = import.meta.env.VITE_DEMO === '1';

export function DemoBadge(): JSX.Element | null {
  const [busy, setBusy] = useState(false);
  if (!DEMO) return null;

  const reset = async (): Promise<void> => {
    if (busy) return;
    const ok = window.confirm(
      '要重設 Demo 資料嗎？\n\n你在這個瀏覽器裡建立或修改的所有內容都會被清掉，\n並還原成一開始的示範內容。',
    );
    if (!ok) return;
    setBusy(true);
    const { resetDemoData } = await import('./index');
    await resetDemoData();
    window.location.reload();
  };

  return (
    <button
      type="button"
      data-testid="demo-badge"
      onClick={() => void reset()}
      title="點一下可以重設 Demo 資料"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        width: '100%',
        margin: '4px 0 2px',
        padding: '5px 8px',
        border: 'none',
        borderRadius: 6,
        background: 'var(--color-bg-hover, rgba(127,127,127,.12))',
        color: 'var(--color-text-secondary, #787774)',
        font: 'inherit',
        fontSize: 11,
        lineHeight: 1.4,
        textAlign: 'left',
        cursor: 'pointer',
      }}
    >
      <span aria-hidden>🧪</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        {busy ? '重設中…' : 'Demo 模式：資料只存在你的瀏覽器'}
      </span>
    </button>
  );
}
