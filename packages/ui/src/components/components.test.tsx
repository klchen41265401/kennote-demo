import { useRef, useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { overlayStack } from '../overlay/stack.js';
import { Icon } from '../icons/Icon.js';
import { Button } from './Button.js';
import { Checkbox } from './Checkbox.js';
import { Dialog } from './Dialog.js';
import { Input } from './Input.js';
import { Menu, MenuGroup, MenuItem, MenuSeparator } from './Menu.js';
import { Popover } from './Popover.js';
import { Resizable } from './Resizable.js';
import { SearchableMenu } from './SearchableMenu.js';
import { Select } from './Select.js';
import { Switch } from './Switch.js';
import { Tabs } from './Tabs.js';
import { toast, ToastRegion } from './Toast.js';
import { Tooltip } from './Tooltip.js';
import { Avatar, avatarInitials } from './Avatar.js';
import { Kbd } from './Kbd.js';

beforeEach(() => {
  overlayStack.reset();
  toast.clear();
});

afterEach(() => {
  overlayStack.reset();
  toast.clear();
});

describe('Button', () => {
  it('渲染 variant / size 並可點擊', () => {
    const onClick = vi.fn();
    render(
      <Button variant="primary" size="sm" onClick={onClick}>
        儲存
      </Button>,
    );
    const btn = screen.getByRole('button', { name: '儲存' });
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(btn.className).toContain('primary');
    expect(btn.className).toContain('sm');
  });

  it('loading 時停用並標記 aria-busy', () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        送出
      </Button>,
    );
    const btn = screen.getByRole('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('Input / Switch / Checkbox', () => {
  it('Input 支援 label、錯誤狀態與 aria 連結', () => {
    render(<Input label="標題" error="不可為空" defaultValue="x" />);
    const input = screen.getByLabelText('標題');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('不可為空')).toBeTruthy();
  });

  it('Switch 有 role=switch 且可切換', () => {
    const onChange = vi.fn();
    render(<Switch onChange={onChange}>公開發布</Switch>);
    const sw = screen.getByRole('switch');
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalled();
  });

  it('Checkbox 支援 indeterminate', () => {
    render(<Checkbox indeterminate>全選</Checkbox>);
    const box = screen.getByRole('checkbox') as HTMLInputElement;
    expect(box.indeterminate).toBe(true);
  });
});

describe('Popover', () => {
  it('非受控：點 trigger 開啟、Esc 關閉', async () => {
    render(
      <Popover trigger={<button>開啟</button>}>
        <p>內容</p>
      </Popover>,
    );
    fireEvent.click(screen.getByText('開啟'));
    expect(await screen.findByText('內容')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText('內容')).toBeNull());
  });

  it('點外部關閉，點內部不關', async () => {
    render(
      <div>
        <span data-testid="outside">外面</span>
        <Popover trigger={<button>開啟</button>}>
          <p>內容</p>
        </Popover>
      </div>,
    );
    fireEvent.click(screen.getByText('開啟'));
    const body = await screen.findByText('內容');
    fireEvent.pointerDown(body);
    expect(screen.queryByText('內容')).toBeTruthy();
    fireEvent.pointerDown(screen.getByTestId('outside'));
    await waitFor(() => expect(screen.queryByText('內容')).toBeNull());
  });

  it('巢狀浮層：Esc 只關最上層', async () => {
    function Nested() {
      const [outer, setOuter] = useState(true);
      const [inner, setInner] = useState(true);
      return (
        <>
          <Popover open={outer} onOpenChange={setOuter}>
            <p>外層</p>
          </Popover>
          <Popover open={inner} onOpenChange={setInner}>
            <p>內層</p>
          </Popover>
        </>
      );
    }
    render(<Nested />);
    expect(await screen.findByText('內層')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText('內層')).toBeNull());
    expect(screen.queryByText('外層')).toBeTruthy();
  });

  it('anchor 可以是 DOMRect（浮動工具列 / slash menu）', async () => {
    render(
      <Popover open anchor={{ x: 10, y: 20, width: 0, height: 0, top: 20, left: 10, right: 10, bottom: 20 }}>
        <p>工具列</p>
      </Popover>,
    );
    const panel = (await screen.findByText('工具列')).parentElement as HTMLElement;
    expect(panel.style.transform).toContain('translate3d');
  });
});

describe('Menu', () => {
  function renderMenu(onSelect = vi.fn()) {
    const utils = render(
      <Menu open onOpenChange={() => {}}>
        <MenuGroup label="動作">
          <MenuItem icon={<Icon name="page" />} onSelect={onSelect} shortcut="mod+n">
            新增頁面
          </MenuItem>
          <MenuItem disabled>停用項目</MenuItem>
          <MenuItem>複製連結</MenuItem>
        </MenuGroup>
        <MenuSeparator />
        <MenuItem danger>刪除</MenuItem>
      </Menu>,
    );
    return { ...utils, onSelect };
  }

  it('開啟時自動聚焦第一個項目（roving tabindex）', async () => {
    renderMenu();
    await waitFor(() => expect(document.activeElement?.textContent).toContain('新增頁面'));
    expect((document.activeElement as HTMLElement).tabIndex).toBe(0);
  });

  it('↑↓ 會跳過 disabled 項目', async () => {
    renderMenu();
    await waitFor(() => expect(document.activeElement?.textContent).toContain('新增頁面'));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toContain('複製連結');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(document.activeElement?.textContent).toContain('新增頁面');
  });

  it('Home / End 跳到頭尾', async () => {
    renderMenu();
    await waitFor(() => expect(document.activeElement?.textContent).toContain('新增頁面'));
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement?.textContent).toContain('刪除');
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(document.activeElement?.textContent).toContain('新增頁面');
  });

  it('打字搜尋跳到符合字首的項目', async () => {
    render(
      <Menu open>
        <MenuItem>Alpha</MenuItem>
        <MenuItem>Beta</MenuItem>
        <MenuItem>Gamma</MenuItem>
      </Menu>,
    );
    await waitFor(() => expect(document.activeElement?.textContent).toContain('Alpha'));
    fireEvent.keyDown(document.activeElement!, { key: 'g' });
    expect(document.activeElement?.textContent).toContain('Gamma');
  });

  it('Enter 觸發 onSelect', async () => {
    const { onSelect } = renderMenu();
    await waitFor(() => expect(document.activeElement?.textContent).toContain('新增頁面'));
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('選取後關閉選單（非受控）', async () => {
    const onSelect = vi.fn();
    render(
      <Menu defaultOpen>
        <MenuItem onSelect={onSelect}>只有一項</MenuItem>
      </Menu>,
    );
    const item = await screen.findByText('只有一項');
    fireEvent.click(item);
    expect(onSelect).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText('只有一項')).toBeNull());
  });

  it('有快捷鍵欄與 icon', async () => {
    renderMenu();
    await screen.findByText('新增頁面');
    expect(document.querySelector('[data-icon="page"]')).toBeTruthy();
    expect(document.querySelectorAll('kbd').length).toBeGreaterThan(0);
  });
});

describe('SearchableMenu（slash menu）', () => {
  const items = [
    { id: 'h1', label: '標題 1', group: '基本', keywords: ['heading', 'h1'] },
    { id: 'p', label: '文字', group: '基本' },
    { id: 'todo', label: '待辦清單', group: '清單' },
  ];

  it('依 query 過濾並保留分組標題', async () => {
    render(<SearchableMenu open items={items} defaultQuery="" />);
    expect(await screen.findByText('基本')).toBeTruthy();
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '待辦' } });
    await waitFor(() => expect(screen.queryByText('標題 1')).toBeNull());
    expect(screen.getByText('清單')).toBeTruthy();
  });

  it('keywords 也能比對', async () => {
    render(<SearchableMenu open items={items} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'h1' } });
    expect(await screen.findByText('標題 1')).toBeTruthy();
    expect(screen.queryByText('待辦清單')).toBeNull();
  });

  it('沒有結果時顯示 emptyMessage', async () => {
    render(<SearchableMenu open items={items} emptyMessage="找不到" />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'zzzz' } });
    expect(await screen.findByText('找不到')).toBeTruthy();
  });

  it('↓ 與 Enter 可選取', async () => {
    const onSelect = vi.fn();
    render(<SearchableMenu open items={items} onSelect={onSelect} />);
    const input = await screen.findByRole('textbox');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'p' }));
  });
});

describe('Dialog', () => {
  it('role=dialog + aria-modal + 標題連結', async () => {
    render(
      <Dialog open onClose={() => {}} title="設定">
        <p>內容</p>
      </Dialog>,
    );
    const dialog = await screen.findByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
  });

  it('開啟時鎖住 body 捲動，關閉後解鎖', async () => {
    const { rerender } = render(
      <Dialog open onClose={() => {}} title="設定">
        <p>內容</p>
      </Dialog>,
    );
    await screen.findByRole('dialog');
    expect(document.body.style.overflow).toBe('hidden');
    rerender(
      <Dialog open={false} onClose={() => {}} title="設定">
        <p>內容</p>
      </Dialog>,
    );
    await waitFor(() => expect(document.body.style.overflow).not.toBe('hidden'));
  });

  it('Esc 關閉；initialFocus 生效', async () => {
    const onClose = vi.fn();
    function Host() {
      const ref = useRef<HTMLInputElement | null>(null);
      return (
        <Dialog open onClose={onClose} title="重新命名" initialFocus={ref}>
          <input ref={ref} aria-label="名稱" />
        </Dialog>
      );
    }
    render(<Host />);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('名稱')));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('點遮罩關閉，點面板不關', async () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="設定">
        <p>內容</p>
      </Dialog>,
    );
    const dialog = await screen.findByRole('dialog');
    fireEvent.pointerDown(dialog);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(dialog.parentElement!);
    expect(onClose).toHaveBeenCalled();
  });
});

describe('Toast', () => {
  it('toast.show 顯示通知，dismiss 移除', async () => {
    render(<ToastRegion />);
    act(() => {
      toast.show({ title: '已儲存', duration: 0 });
    });
    expect(await screen.findByText('已儲存')).toBeTruthy();
    act(() => {
      toast.clear();
    });
    await waitFor(() => expect(screen.queryByText('已儲存')).toBeNull());
  });

  it('最多同時 3 則，超過丟掉最舊的', async () => {
    render(<ToastRegion />);
    act(() => {
      for (let i = 1; i <= 4; i++) toast.show({ title: `訊息 ${i}`, duration: 0 });
    });
    await waitFor(() => expect(screen.queryByText('訊息 1')).toBeNull());
    expect(screen.getByText('訊息 4')).toBeTruthy();
  });

  it('支援「復原」動作按鈕', async () => {
    const undo = vi.fn();
    render(<ToastRegion />);
    act(() => {
      toast.show({ title: '已刪除', duration: 0, action: { label: '復原', onClick: undo } });
    });
    fireEvent.click(await screen.findByRole('button', { name: '復原' }));
    expect(undo).toHaveBeenCalled();
  });

  it('自動關閉（duration）', async () => {
    vi.useFakeTimers();
    try {
      render(<ToastRegion />);
      act(() => {
        toast.show({ title: '暫時的', duration: 100 });
      });
      expect(screen.getByText('暫時的')).toBeTruthy();
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(screen.queryByText('暫時的')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Tooltip', () => {
  it('延遲 400ms 後才顯示', async () => {
    vi.useFakeTimers();
    try {
      render(
        <Tooltip content="粗體" shortcut="mod+b">
          <button>B</button>
        </Tooltip>,
      );
      fireEvent.pointerEnter(screen.getByText('B'));
      expect(screen.queryByRole('tooltip')).toBeNull();
      act(() => {
        vi.advanceTimersByTime(450);
      });
      expect(screen.getByRole('tooltip')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Select', () => {
  const options = [
    { value: 'todo', label: '未開始' },
    { value: 'doing', label: '進行中' },
    { value: 'done', label: '已完成' },
  ];

  it('role=combobox，展開後是 listbox', async () => {
    render(<Select options={options} aria-label="狀態" />);
    const trigger = screen.getByRole('combobox');
    expect(trigger.textContent).toContain('請選擇');
    fireEvent.click(trigger);
    expect(await screen.findByRole('listbox')).toBeTruthy();
  });

  it('選取後回傳值並關閉', async () => {
    const onChange = vi.fn();
    render(<Select options={options} onChange={onChange} aria-label="狀態" />);
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByText('進行中'));
    expect(onChange).toHaveBeenCalledWith('doing');
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  });
});

describe('Tabs', () => {
  const items = [
    { id: 'table', label: '表格', content: <p>表格內容</p> },
    { id: 'board', label: '看板', content: <p>看板內容</p> },
  ];

  it('切換分頁並維持 aria 關聯', () => {
    render(<Tabs items={items} aria-label="檢視" />);
    expect(screen.getByText('表格內容')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '看板' }));
    expect(screen.getByText('看板內容')).toBeTruthy();
    expect(screen.getByRole('tab', { name: '看板' }).getAttribute('aria-selected')).toBe('true');
  });

  it('←→ 可切換', () => {
    render(<Tabs items={items} aria-label="檢視" />);
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: '看板' }).getAttribute('aria-selected')).toBe('true');
  });
});

/** jsdom 的 MouseEvent 沒有 clientX setter，也沒有 PointerEvent，手動造一個。 */
function pointerEvent(type: string, props: { pointerId: number; clientX?: number; clientY?: number }) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: props.pointerId },
    clientX: { value: props.clientX ?? 0 },
    clientY: { value: props.clientY ?? 0 },
  });
  return event;
}

describe('Resizable', () => {
  it('拖曳把手改變寬度並夾在 min/max 之間', () => {
    const onResize = vi.fn();
    render(
      <Resizable defaultSize={260} min={180} max={400} onResize={onResize}>
        <div>側邊欄</div>
      </Resizable>,
    );
    const handle = screen.getByRole('separator', { name: '調整大小' });
    fireEvent(handle, pointerEvent('pointerdown', { pointerId: 1, clientX: 260 }));
    fireEvent(window, pointerEvent('pointermove', { pointerId: 1, clientX: 320 }));
    expect(onResize).toHaveBeenLastCalledWith(320);
    fireEvent(window, pointerEvent('pointermove', { pointerId: 1, clientX: 900 }));
    expect(onResize).toHaveBeenLastCalledWith(400);
    fireEvent(window, pointerEvent('pointerup', { pointerId: 1 }));
  });

  it('鍵盤 ←→ 可調整', () => {
    const onResizeEnd = vi.fn();
    render(
      <Resizable defaultSize={260} min={180} max={400} step={20} onResizeEnd={onResizeEnd}>
        <div>側邊欄</div>
      </Resizable>,
    );
    const handle = screen.getByRole('separator', { name: '調整大小' });
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(onResizeEnd).toHaveBeenLastCalledWith(280);
  });
});

describe('Avatar / Kbd', () => {
  it('avatarInitials 對中英文各取首字', () => {
    expect(avatarInitials('Ken Chen')).toBe('KC');
    expect(avatarInitials('阿彬')).toBe('阿彬');
    expect(avatarInitials('ken')).toBe('KE');
  });

  it('Avatar 沒有圖片時顯示首字', () => {
    render(<Avatar name="Ken Chen" />);
    expect(screen.getByText('KC')).toBeTruthy();
  });

  it('Kbd 會依平台把 mod 換掉', () => {
    const { container } = render(<Kbd keys="mod+k" />);
    const keys = [...container.querySelectorAll('kbd')].map((k) => k.textContent);
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe('K');
  });
});
