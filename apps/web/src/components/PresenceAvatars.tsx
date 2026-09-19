/**
 * 線上頭像列（04 §8 M5-7、01 §6 M5.1.4）。
 * 顏色與 block 外框、名牌完全一致（伺服器依 userId 指派）。
 */
import type { PeerPresence } from '@kennote/shared-types';
import { usePagePeers } from '../stores/presence';
import styles from './PresenceAvatars.module.css';

const MAX_VISIBLE = 5;

function initial(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || '?';
}

/** 同一個人開兩個分頁只算一個 */
export function dedupeByUser(peers: PeerPresence[]): PeerPresence[] {
  const seen = new Map<string, PeerPresence>();
  for (const peer of peers) {
    const existing = seen.get(peer.userId);
    if (!existing || existing.updatedAt < peer.updatedAt) seen.set(peer.userId, peer);
  }
  return [...seen.values()];
}

export function PresenceAvatars({ pageId }: { pageId: string | null }): JSX.Element | null {
  const peers = dedupeByUser(usePagePeers(pageId));
  if (peers.length === 0) return null;

  const visible = peers.slice(0, MAX_VISIBLE);
  const overflow = peers.length - visible.length;

  return (
    <div className={styles.row} aria-label={`${peers.length} 人正在看這一頁`}>
      {visible.map((peer) => (
        <span
          key={peer.sessionId}
          className={styles.avatar}
          style={{ ['--kn-presence-color' as string]: peer.color }}
          title={peer.blockId ? `${peer.name}（正在編輯）` : peer.name}
        >
          {peer.avatarUrl ? (
            <img className={styles.image} src={peer.avatarUrl} alt={peer.name} />
          ) : (
            <span className={styles.initial}>{initial(peer.name)}</span>
          )}
        </span>
      ))}
      {overflow > 0 ? <span className={styles.more}>+{overflow}</span> : null}
    </div>
  );
}
