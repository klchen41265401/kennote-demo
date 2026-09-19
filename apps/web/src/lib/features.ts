/**
 * 伺服器的功能旗標（`/api/health` 的 `features`）。
 *
 * 為什麼要有這一支：好幾個地方都想知道「這個站台開了什麼」（公開分享、OT、
 * 即時協作），各自去打一次 `/api/health` 既浪費又不一致 —— 而且**打丟一次就
 * 永遠拿不到**（UI 會退化成「看起來可以按、按下去才吃 501」）。
 *
 * 這裡做兩件事：
 *   1. 整個 session 只打一次，結果放在 module 層（換頁也不會重打）。
 *   2. 失敗會重試（最多 3 次、指數退避）；全部失敗才回 null，呼叫端據此
 *      走「不確定」的分支，而不是誤判成「功能關著 / 開著」。
 */
import { api } from './api-client';

export interface ServerFeatures {
  realtime?: boolean;
  ot?: boolean;
  publicShare?: boolean;
}

interface HealthShape {
  features?: ServerFeatures;
}

const MAX_ATTEMPTS = 3;

let cached: Promise<ServerFeatures | null> | null = null;

async function fetchFeatures(): Promise<ServerFeatures | null> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const health = await api.get<HealthShape>('/api/health');
      // dev 代理偶爾會把 SPA 的 index.html 當成 API 回應吐回來 → 不是物件就當失敗
      if (health && typeof health === 'object' && typeof health.features === 'object') {
        return health.features ?? null;
      }
    } catch {
      /* 下面退避後重試 */
    }
    if (attempt < MAX_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
    }
  }
  return null;
}

/** 取功能旗標；同一個 session 只會真的打一次 API。拿不到時回 `null`（＝不確定）。 */
export function serverFeatures(): Promise<ServerFeatures | null> {
  cached ??= fetchFeatures().then((features) => {
    // 拿不到就把 cache 清掉，下一個呼叫端還有機會再試（旗標不會整個 session 卡在 null）
    if (features === null) cached = null;
    return features;
  });
  return cached;
}

/** 測試用：清掉 module 層的快取 */
export function resetFeatureCache(): void {
  cached = null;
}
