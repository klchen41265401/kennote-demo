import type { Transaction, TransactionResult } from './operation.js';

/** 04 §6.3 訊息協定。M5 才接實作，M1 先把型別定死 */

export interface PeerPresence {
  sessionId: string;
  userId: string;
  name: string;
  avatarUrl: string | null;
  color: string;
  blockId: string | null;
  selection: [number, number] | null;
  updatedAt: number;
}

export type ClientMessage =
  | { t: 'auth'; token: string; sessionId: string }
  | { t: 'subscribe'; pageId: string; sinceSeq?: number }
  | { t: 'unsubscribe'; pageId: string }
  | { t: 'tx'; tx: Transaction }
  | {
      t: 'presence';
      pageId: string;
      blockId: string | null;
      selection: [number, number] | null;
    }
  | { t: 'ping' };

export type ServerMessage =
  | { t: 'authOk'; userId: string }
  | { t: 'authError'; code: string }
  | { t: 'synced'; pageId: string; seq: number }
  | { t: 'txApplied'; result: TransactionResult }
  | { t: 'txRejected'; txId: string; code: string; message: string }
  | { t: 'txBroadcast'; result: TransactionResult }
  | { t: 'catchUp'; pageId: string; results: TransactionResult[]; toSeq: number }
  | { t: 'presence'; pageId: string; peers: PeerPresence[] }
  | { t: 'resync'; pageId: string; reason: string }
  | { t: 'pong' };

export type ClientMessageType = ClientMessage['t'];
export type ServerMessageType = ServerMessage['t'];

/** 前端連線狀態機（04 §6.5） */
export type SyncConnectionState =
  | 'idle'
  | 'connecting'
  | 'authenticating'
  | 'ready'
  | 'reconnecting'
  | 'offline';
