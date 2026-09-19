import { useEffect } from 'react';

let locks = 0;
let savedOverflow = '';
let savedPaddingRight = '';

function lock(): void {
  if (typeof document === 'undefined') return;
  locks += 1;
  if (locks > 1) return;
  const body = document.body;
  savedOverflow = body.style.overflow;
  savedPaddingRight = body.style.paddingRight;
  // 補上捲軸寬度，避免鎖住捲動時版面向右跳動（§4.4.5.3）。
  const scrollbar = window.innerWidth - document.documentElement.clientWidth;
  body.style.overflow = 'hidden';
  if (scrollbar > 0) {
    const current = parseFloat(getComputedStyle(body).paddingRight) || 0;
    body.style.paddingRight = `${current + scrollbar}px`;
  }
}

function unlock(): void {
  if (typeof document === 'undefined' || locks === 0) return;
  locks -= 1;
  if (locks > 0) return;
  document.body.style.overflow = savedOverflow;
  document.body.style.paddingRight = savedPaddingRight;
}

/** 鎖住 body 捲動。多個浮層同時開啟時以計數管理，全部關閉才解鎖。 */
export function useScrollLock(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    lock();
    return unlock;
  }, [enabled]);
}

/** 測試用：強制歸零。 */
export function __resetScrollLock(): void {
  locks = 0;
  if (typeof document !== 'undefined') {
    document.body.style.overflow = savedOverflow;
    document.body.style.paddingRight = savedPaddingRight;
  }
}
