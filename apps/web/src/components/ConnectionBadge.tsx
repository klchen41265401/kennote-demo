/**
 * 連線狀態徽章 + 衝突提示（04 §8 M5-8、§6.5 的 UI 呈現）。
 *
 *   🟢 已同步 / 🟡 連線中・同步中 / 🔴 離線（變更已暫存）
 *
 * 衝突（baseVersion 不符）時跳 toast：「此段落剛被其他人修改」。
 * 這是階段二「社交式避讓」的一部分 —— 不擋使用者，只讓他知道發生了什麼（04 §6.6）。
 */
import { useEffect } from 'react';
import { dismissConflict, useSyncState } from '../stores/sync';
import styles from './ConnectionBadge.module.css';

const LABELS: Record<string, { text: string; tone: 'ok' | 'busy' | 'off' }> = {
  idle: { text: '尚未連線', tone: 'busy' },
  connecting: { text: '連線中…', tone: 'busy' },
  authenticating: { text: '連線中…', tone: 'busy' },
  syncing: { text: '同步中…', tone: 'busy' },
  ready: { text: '已同步', tone: 'ok' },
  reconnecting: { text: '重新連線中…', tone: 'busy' },
  offline: { text: '離線', tone: 'off' },
};

const CONFLICT_TTL_MS = 8000;

export function ConnectionBadge(): JSX.Element {
  const { state, pending, conflicts } = useSyncState();
  const label = LABELS[state] ?? LABELS.idle!;

  useEffect(() => {
    if (conflicts.length === 0) return;
    const timers = conflicts.map((c) =>
      setTimeout(() => dismissConflict(c.id), Math.max(0, c.at + CONFLICT_TTL_MS - Date.now())),
    );
    return () => timers.forEach(clearTimeout);
  }, [conflicts]);

  return (
    <>
      <span
        className={`${styles.badge} ${styles[label.tone]}`}
        role="status"
        aria-live="polite"
        title={
          pending > 0
            ? `有 ${pending} 筆變更尚未送達伺服器，連線恢復後會自動送出`
            : '所有變更都已同步'
        }
      >
        <span className={styles.dot} aria-hidden="true" />
        {label.text}
        {pending > 0 ? <span className={styles.pending}>變更已暫存 {pending}</span> : null}
      </span>

      {conflicts.length > 0 ? (
        <div className={styles.toasts} role="alert">
          {conflicts.map((c) => (
            <button
              key={c.id}
              type="button"
              className={styles.toast}
              onClick={() => dismissConflict(c.id)}
            >
              此段落剛被其他人修改，你的版本已覆蓋（可從版本歷史還原）
              <span className={styles.toastHint}>點一下關閉</span>
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}
