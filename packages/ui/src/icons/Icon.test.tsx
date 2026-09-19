import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Icon } from './Icon.js';
import { ICON_NAMES } from './shapes.js';

const REQUIRED = [
  'chevron-right', 'chevron-down', 'plus', 'search', 'home', 'inbox', 'settings', 'trash',
  'star', 'star-filled', 'more-horizontal', 'drag-handle', 'page', 'page-empty', 'database',
  'table', 'board', 'list', 'gallery', 'calendar', 'timeline', 'comment', 'history', 'share',
  'duplicate', 'link', 'check', 'close', 'arrow-left', 'arrow-right', 'arrow-up', 'arrow-down',
  'sidebar-toggle', 'sun', 'moon', 'bold', 'italic', 'underline', 'strikethrough', 'code',
  'text-color', 'undo', 'redo', 'image', 'file', 'bookmark', 'divider', 'quote', 'callout',
  'todo', 'bulleted-list', 'numbered-list', 'toggle', 'heading1', 'heading2', 'heading3',
  'text', 'paragraph', 'filter', 'sort', 'group', 'hide', 'lock', 'globe', 'user', 'users',
  'bell', 'help', 'template', 'import', 'export', 'expand', 'collapse', 'external-link',
  'sync', 'emoji', 'reload',
];

describe('Icon', () => {
  it('規格要求的 icon 全部存在', () => {
    for (const name of REQUIRED) {
      expect(ICON_NAMES, `缺少 icon: ${name}`).toContain(name);
    }
  });

  it('每個 icon 都能渲染，且是 20x20 viewBox / currentColor / 1.5px', () => {
    for (const name of ICON_NAMES) {
      const { container, unmount } = render(<Icon name={name} />);
      const svg = container.querySelector('svg')!;
      expect(svg.getAttribute('viewBox')).toBe('0 0 20 20');
      expect(svg.getAttribute('stroke')).toBe('currentColor');
      expect(svg.getAttribute('stroke-width')).toBe('1.5');
      expect(svg.childNodes.length).toBeGreaterThan(0);
      unmount();
    }
  });

  it('沒有 title 時 aria-hidden，有 title 時 role=img', () => {
    const { container, rerender } = render(<Icon name="plus" />);
    expect(container.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
    rerender(<Icon name="plus" title="新增" />);
    expect(container.querySelector('svg')!.getAttribute('role')).toBe('img');
    expect(container.querySelector('title')!.textContent).toBe('新增');
  });

  it('size 可調整', () => {
    const { container } = render(<Icon name="plus" size={16} />);
    expect(container.querySelector('svg')!.getAttribute('width')).toBe('16');
  });
});
