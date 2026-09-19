/**
 * 觸發元素（trigger）的 props 合併工具。
 *
 * 為什麼不包一層 <span>：把開關用的 onClick 掛在外層 span，等於要求 trigger 內部
 * 不能 stopPropagation()。實務上按鈕常常要擋冒泡（例如側邊欄那一列既要導頁又有 ⋯ 按鈕），
 * 一擋掉，浮層就永遠打不開。所以一律用 cloneElement 把 onClick / aria-* / ref
 * **直接合併到 trigger 元素本身**（asChild 語意）。
 */

import { cloneElement, isValidElement, type ReactElement, type ReactNode, type Ref } from 'react';

type AnyProps = Record<string, unknown>;

/** 把節點寫進 ref（callback ref 或 object ref 都吃）。 */
export function assignRef(ref: unknown, node: unknown): void {
  if (typeof ref === 'function') {
    (ref as (n: unknown) => void)(node);
  } else if (ref && typeof ref === 'object') {
    (ref as { current: unknown }).current = node;
  }
}

/** 取得元素身上原本的 ref（React 18 放在 element.ref，19 之後放在 props.ref）。 */
export function getElementRef(element: ReactElement): unknown {
  const fromElement = (element as unknown as { ref?: unknown }).ref;
  if (fromElement != null) return fromElement;
  return (element.props as AnyProps)['ref'];
}

/**
 * 先呼叫使用者原本的 handler；只有在它沒有 preventDefault() 時才跑我們的。
 * 這樣「trigger 想自己吃掉這次點擊」仍然辦得到，而 stopPropagation() 不會再誤傷浮層。
 */
export function composeHandlers<E extends { defaultPrevented?: boolean }>(
  theirs: unknown,
  ours: (event: E) => void,
): (event: E) => void {
  return (event: E) => {
    if (typeof theirs === 'function') (theirs as (e: E) => void)(event);
    if (event?.defaultPrevented) return;
    ours(event);
  };
}

export interface CloneTriggerOptions {
  /** 要合併進去的 props（事件 handler 會與原本的組合，其餘直接覆寫）。 */
  props: AnyProps;
  /** 要合併進去的 ref。 */
  ref?: Ref<never> | ((node: HTMLElement | null) => void);
  /** 哪些 key 是事件 handler，需要與原本的組合。 */
  compose?: readonly string[];
}

/**
 * 把 props / ref 合併到單一子元素上。element 不是合法元素時回傳 null，
 * 呼叫端自行決定 fallback（例如包一層 span 當錨點）。
 */
export function cloneTrigger(element: ReactNode, options: CloneTriggerOptions): ReactElement | null {
  if (!isValidElement(element)) return null;
  const el = element as ReactElement<AnyProps>;
  const childProps = el.props as AnyProps;
  const composeKeys = options.compose ?? [];
  const next: AnyProps = { ...options.props };

  for (const key of composeKeys) {
    const ours = options.props[key];
    if (typeof ours !== 'function') {
      // 我們沒有 handler（例如 disabled）時，不要用 undefined 蓋掉子元素原本的。
      if (key in childProps) next[key] = childProps[key];
      continue;
    }
    next[key] = composeHandlers(childProps[key], ours as (e: { defaultPrevented?: boolean }) => void);
  }

  if (options.ref) {
    const childRef = getElementRef(el);
    next['ref'] = (node: HTMLElement | null) => {
      assignRef(options.ref, node);
      assignRef(childRef, node);
    };
  }

  return cloneElement(el, next);
}
