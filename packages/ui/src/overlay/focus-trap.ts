/** §4.7.3 自製 focus trap 的核心（不依賴 React，方便單獨測試）。 */

export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

/**
 * 排除隱藏元素。
 * 不用 offsetParent（jsdom 永遠是 null，會讓所有元素都被判定為隱藏），
 * 改用 computed style —— 瀏覽器與 jsdom 都算得出來。
 */
function isVisible(el: HTMLElement): boolean {
  if (el.hidden) return false;
  const win = el.ownerDocument?.defaultView;
  if (!win) return true;
  const style = win.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

export function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true' && isVisible(el),
  );
}

export interface FocusTrapOptions {
  /** 開啟時要先聚焦的元素；沒給就取第一個可聚焦元素。 */
  initialFocus?: HTMLElement | null;
  /** 關閉時還原焦點，預設 true。 */
  restoreFocus?: boolean;
  /** 把背景設為 inert（§4.7.3）。傳入背景根元素，通常是 #root。 */
  inertRoot?: HTMLElement | null;
}

/**
 * 建立 focus trap，回傳 cleanup。
 * cleanup 會還原焦點 —— 絕不可省略。
 */
export function createFocusTrap(container: HTMLElement, options: FocusTrapOptions = {}): () => void {
  const { initialFocus, restoreFocus = true, inertRoot } = options;
  const previous = (typeof document !== 'undefined' ? document.activeElement : null) as
    | HTMLElement
    | null;

  function onKeyDown(e: KeyboardEvent): void {
    if (e.key !== 'Tab') return;
    const list = getFocusable(container);
    if (list.length === 0) {
      e.preventDefault();
      container.focus({ preventScroll: true });
      return;
    }
    const first = list[0]!;
    const last = list[list.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !container.contains(active))) {
      e.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus({ preventScroll: true });
    }
  }

  container.addEventListener('keydown', onKeyDown);

  let inertApplied = false;
  if (inertRoot && !inertRoot.contains(container)) {
    inertRoot.setAttribute('inert', '');
    inertRoot.setAttribute('aria-hidden', 'true');
    inertApplied = true;
  }

  // 內容若已自行把焦點放在容器內（例如 MenuList 聚焦了第一個項目），就不要搶走。
  const alreadyInside =
    typeof document !== 'undefined' &&
    document.activeElement !== null &&
    document.activeElement !== document.body &&
    container.contains(document.activeElement);
  if (!alreadyInside) {
    const target = initialFocus ?? getFocusable(container)[0] ?? container;
    if (!container.hasAttribute('tabindex') && target === container) {
      container.setAttribute('tabindex', '-1');
    }
    target.focus?.({ preventScroll: true });
  } else if (initialFocus) {
    initialFocus.focus?.({ preventScroll: true });
  }

  return () => {
    container.removeEventListener('keydown', onKeyDown);
    if (inertApplied && inertRoot) {
      inertRoot.removeAttribute('inert');
      inertRoot.removeAttribute('aria-hidden');
    }
    if (restoreFocus && previous && typeof document !== 'undefined' && document.contains(previous)) {
      previous.focus?.({ preventScroll: true });
    }
  };
}
