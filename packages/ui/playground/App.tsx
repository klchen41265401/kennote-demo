import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Avatar,
  AvatarStack,
  Button,
  Checkbox,
  ContextMenu,
  Dialog,
  Divider,
  DndProvider,
  ICON_NAMES,
  Icon,
  IconButton,
  Input,
  Menu,
  MenuGroup,
  MenuItem,
  MenuSeparator,
  OverlayRoot,
  Popover,
  Resizable,
  SearchableMenu,
  Select,
  Skeleton,
  SortableList,
  Spinner,
  SubMenu,
  Switch,
  Tabs,
  ToastRegion,
  Tooltip,
  VirtualList,
  Kbd,
  toast,
  type IconName,
} from '../src/index.js';

const ROWS = Array.from({ length: 1000 }, (_, i) => ({ id: `r${i}`, label: `虛擬列 ${i}` }));

const SLASH_ITEMS = [
  { id: 'text', label: '文字', description: '從純文字開始寫。', group: '基本', keywords: ['p'] },
  { id: 'h1', label: '標題 1', description: '大標題。', group: '基本', keywords: ['h1', 'heading'] },
  { id: 'h2', label: '標題 2', description: '中標題。', group: '基本', keywords: ['h2'] },
  { id: 'todo', label: '待辦清單', description: '可勾選的清單。', group: '清單', keywords: ['todo'] },
  { id: 'bullet', label: '項目符號清單', group: '清單', keywords: ['ul'] },
  { id: 'table', label: '表格', group: '資料庫', keywords: ['db'] },
  { id: 'board', label: '看板', group: '資料庫', keywords: ['kanban'] },
];

export function App(): JSX.Element {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  useEffect(() => {
    document.documentElement.dataset['theme'] = theme;
  }, [theme]);

  return (
    <OverlayRoot>
      <DndProvider>
        <div className="pg-shell">
          <div className="pg-topbar">
            <h1 className="pg-title">@kennote/ui primitives</h1>
            <Button
              variant="subtle"
              startIcon={<Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />}
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              {theme === 'dark' ? '淺色' : '深色'}
            </Button>
          </div>

          <ButtonsSection />
          <FormsSection />
          <OverlaysSection />
          <MenusSection />
          <FeedbackSection />
          <LayoutSection />
          <DndSection />
          <VirtualSection />
          <IconsSection />
        </div>
        <ToastRegion />
      </DndProvider>
    </OverlayRoot>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <section className="pg-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function ButtonsSection(): JSX.Element {
  return (
    <Section title="Button / IconButton / Kbd">
      <div className="pg-row">
        <Button variant="primary">主要</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="subtle">Subtle</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="danger" startIcon={<Icon name="trash" size={16} />}>
          刪除
        </Button>
        <Button loading>載入中</Button>
        <Button disabled>停用</Button>
      </div>
      <div className="pg-row" style={{ marginTop: 10 }}>
        <Button size="sm" variant="primary">
          小尺寸
        </Button>
        <Button size="sm" variant="ghost" endIcon={<Icon name="chevron-down" size={14} />}>
          更多
        </Button>
        <IconButton label="新增" shortcut="mod+n">
          <Icon name="plus" />
        </IconButton>
        <IconButton label="更多動作">
          <Icon name="more-horizontal" />
        </IconButton>
        <IconButton label="拖曳把手" size="sm">
          <Icon name="drag-handle" size={16} />
        </IconButton>
        <Kbd keys="mod+k" />
        <Kbd keys="shift+enter" />
      </div>
    </Section>
  );
}

function FormsSection(): JSX.Element {
  const [checked, setChecked] = useState(true);
  const [on, setOn] = useState(false);
  const [status, setStatus] = useState<string | null>('doing');
  return (
    <Section title="Input / Switch / Checkbox / Select / Tabs">
      <div className="pg-row" style={{ alignItems: 'flex-start' }}>
        <div style={{ width: 240 }}>
          <Input label="頁面標題" placeholder="未命名" startAdornment={<Icon name="page" size={16} />} />
        </div>
        <div style={{ width: 240 }}>
          <Input label="網址" error="格式不正確" defaultValue="notion" />
        </div>
        <div style={{ width: 200 }}>
          <Select
            aria-label="狀態"
            value={status}
            onChange={setStatus}
            options={[
              { value: 'todo', label: '未開始' },
              { value: 'doing', label: '進行中' },
              { value: 'done', label: '已完成' },
              { value: 'blocked', label: '受阻', disabled: true },
            ]}
          />
        </div>
      </div>
      <div className="pg-row" style={{ marginTop: 12 }}>
        <Switch checked={on} onChange={(e) => setOn(e.target.checked)}>
          發布到網路
        </Switch>
        <Checkbox checked={checked} onChange={(e) => setChecked(e.target.checked)}>
          允許留言
        </Checkbox>
        <Checkbox indeterminate>全選</Checkbox>
      </div>
      <div style={{ marginTop: 16 }}>
        <Tabs
          aria-label="檢視"
          items={[
            { id: 'table', label: '表格', icon: <Icon name="table" size={16} />, content: <p>表格檢視</p> },
            { id: 'board', label: '看板', icon: <Icon name="board" size={16} />, content: <p>看板檢視</p> },
            {
              id: 'calendar',
              label: '日曆',
              icon: <Icon name="calendar" size={16} />,
              content: <p>日曆檢視</p>,
            },
          ]}
          actions={
            <IconButton label="新增檢視" size="sm">
              <Icon name="plus" size={16} />
            </IconButton>
          }
        />
      </div>
    </Section>
  );
}

function OverlaysSection(): JSX.Element {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const nameRef = useRef<HTMLInputElement | null>(null);
  return (
    <Section title="Popover / Dialog / Tooltip">
      <div className="pg-row">
        <Popover
          trigger={<Button variant="outline">開啟 Popover</Button>}
          placement="bottom-start"
          arrow
        >
          <div style={{ width: 220 }}>
            <strong>自製定位引擎</strong>
            <p style={{ margin: '6px 0 0', color: 'var(--kn-color-text-secondary)' }}>
              flip / shift / maxHeight / arrow 全部自己算，零依賴。
            </p>
          </div>
        </Popover>

        <Button variant="outline" onClick={() => setDialogOpen(true)}>
          開啟 Dialog
        </Button>
        <Button variant="outline" onClick={() => setSearchOpen(true)}>
          搜尋型 Modal（15vh）
        </Button>

        <Tooltip content="粗體" shortcut="mod+b">
          <Button variant="ghost">
            <Icon name="bold" size={16} />
          </Button>
        </Tooltip>
        <Tooltip content="斜體" shortcut="mod+i">
          <Button variant="ghost">
            <Icon name="italic" size={16} />
          </Button>
        </Tooltip>
        <Tooltip content="連續 hover 免延遲（delay group）">
          <Button variant="ghost">
            <Icon name="code" size={16} />
          </Button>
        </Tooltip>
      </div>

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="重新命名頁面"
        description="按 Esc 關閉，焦點會還原到觸發按鈕。"
        initialFocus={nameRef}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button variant="primary" onClick={() => setDialogOpen(false)}>
              儲存
            </Button>
          </>
        }
      >
        <Input ref={nameRef} label="名稱" defaultValue="API 設計稿" />
      </Dialog>

      <Dialog
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        size="search"
        align="top"
        showClose={false}
        flush
      >
        <div style={{ padding: 12 }}>
          <Input
            placeholder="搜尋頁面、內容或執行指令…"
            startAdornment={<Icon name="search" size={16} />}
            autoSelect
          />
          <p style={{ color: 'var(--kn-color-text-tertiary)', fontSize: 12 }}>
            ↑↓ 移動 ⏎ 開啟 esc 關閉
          </p>
        </div>
      </Dialog>
    </Section>
  );
}

function MenusSection(): JSX.Element {
  const [slashOpen, setSlashOpen] = useState(false);
  const slashAnchor = useRef<HTMLButtonElement | null>(null);
  return (
    <Section title="Menu / SubMenu / SearchableMenu / ContextMenu">
      <div className="pg-row">
        <Menu trigger={<Button variant="outline">頁面選單</Button>}>
          <MenuGroup label="動作">
            <MenuItem icon={<Icon name="duplicate" size={16} />} shortcut="mod+d">
              建立副本
            </MenuItem>
            <MenuItem icon={<Icon name="link" size={16} />} shortcut="mod+shift+l">
              複製連結
            </MenuItem>
            <SubMenu icon={<Icon name="export" size={16} />} label="匯出">
              <MenuItem>Markdown</MenuItem>
              <MenuItem>PDF</MenuItem>
              <MenuItem>HTML</MenuItem>
            </SubMenu>
          </MenuGroup>
          <MenuSeparator />
          <MenuItem icon={<Icon name="star" size={16} />} checked>
            加入我的最愛
          </MenuItem>
          <MenuItem disabled icon={<Icon name="lock" size={16} />}>
            鎖定頁面（無權限）
          </MenuItem>
          <MenuSeparator />
          <MenuItem danger icon={<Icon name="trash" size={16} />}>
            移到垃圾桶
          </MenuItem>
        </Menu>

        <Button ref={slashAnchor} variant="outline" onClick={() => setSlashOpen(true)}>
          Slash menu（可搜尋）
        </Button>
        <SearchableMenu
          open={slashOpen}
          onOpenChange={setSlashOpen}
          anchor={() => slashAnchor.current}
          items={SLASH_ITEMS}
          groupOrder={['基本', '清單', '資料庫']}
          placeholder="輸入以篩選…"
          onSelect={(item) => toast.show({ title: `插入「${item.label}」` })}
          footer={
            <>
              <span>
                <Kbd keys="up" /> <Kbd keys="down" /> 移動
              </span>
              <span>
                <Kbd keys="enter" /> 插入
              </span>
            </>
          }
        />

        <ContextMenu
          className="pg-box"
          menu={
            <>
              <MenuItem icon={<Icon name="plus" size={16} />}>新增子頁面</MenuItem>
              <MenuItem icon={<Icon name="duplicate" size={16} />}>建立副本</MenuItem>
              <MenuSeparator />
              <MenuItem danger icon={<Icon name="trash" size={16} />}>
                刪除
              </MenuItem>
            </>
          }
        >
          <div style={{ padding: '18px 24px', color: 'var(--kn-color-text-secondary)' }}>
            在這裡按右鍵 →
          </div>
        </ContextMenu>
      </div>
    </Section>
  );
}

function FeedbackSection(): JSX.Element {
  return (
    <Section title="Toast / Spinner / Skeleton / Avatar / Divider">
      <div className="pg-row">
        <Button
          variant="outline"
          onClick={() => toast.show({ title: '已儲存', description: '所有變更已同步。' })}
        >
          一般 toast
        </Button>
        <Button variant="outline" onClick={() => toast.success('已複製連結')}>
          成功
        </Button>
        <Button variant="outline" onClick={() => toast.error('連線失敗', { description: '將於 5 秒後重試。' })}>
          錯誤
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            toast.show({
              title: '已刪除 1 個區塊',
              action: { label: '復原', onClick: () => toast.success('已復原') },
            })
          }
        >
          帶「復原」
        </Button>
        <Spinner size={18} />
        <Avatar name="Ken Chen" />
        <AvatarStack
          people={[{ name: '阿彬' }, { name: 'Ken Chen' }, { name: 'Lee' }, { name: 'Wang' }, { name: 'Zhou' }]}
        />
      </div>
      <div style={{ marginTop: 12, maxWidth: 360 }}>
        <Skeleton lines={3} />
      </div>
      <Divider label="分隔線" />
    </Section>
  );
}

function LayoutSection(): JSX.Element {
  const [width, setWidth] = useState(260);
  return (
    <Section title="Resizable（側邊欄 / 面板 / 欄寬）">
      <div style={{ display: 'flex', gap: 12 }}>
        <Resizable size={width} min={180} max={420} onResize={setWidth} resetSize={260}>
          <div className="pg-sidebar">
            <strong>側邊欄</strong>
            <p style={{ color: 'var(--kn-color-text-secondary)' }}>寬度 {width}px</p>
            <p style={{ color: 'var(--kn-color-text-tertiary)', fontSize: 12 }}>
              拖曳右緣，或聚焦把手後按 ←→。雙擊重設。
            </p>
          </div>
        </Resizable>
        <div style={{ flex: 1, padding: 12, color: 'var(--kn-color-text-secondary)' }}>內容區</div>
      </div>
    </Section>
  );
}

function DndSection(): JSX.Element {
  const [items, setItems] = useState([
    { id: 'p1', label: '工程文件' },
    { id: 'p2', label: 'API 設計稿' },
    { id: 'p3', label: '部署手冊' },
    { id: 'p4', label: '進度追蹤' },
  ]);
  return (
    <Section title="DnD（Pointer Events 自製引擎）">
      <p style={{ color: 'var(--kn-color-text-tertiary)', fontSize: 12, marginTop: 0 }}>
        拖到項目「之間」畫線；往右拖 ≥ 24px 變成「放進裡面」。
      </p>
      <div className="pg-box" style={{ maxWidth: 360, padding: 4 }}>
        <SortableList
          id="pages"
          mode="tree"
          items={items}
          getId={(item) => item.id}
          onReorder={({ from, to, position }) => {
            if (position === 'inside') {
              toast.show({ title: `把「${items[from]?.label}」放進「${items[to]?.label}」` });
              return;
            }
            setItems((prev) => {
              const next = [...prev];
              const [moved] = next.splice(from, 1);
              if (!moved) return prev;
              const target = position === 'after' ? to + 1 : to;
              next.splice(target > from ? target - 1 : target, 0, moved);
              return next;
            });
          }}
        >
          {(item, props) => (
            <div
              ref={props.setNodeRef}
              className="pg-tree-row"
              data-dragging={props.isDragging || undefined}
              {...props.handleProps}
            >
              <Icon name="drag-handle" size={14} />
              <Icon name="page" size={16} />
              {item.label}
            </div>
          )}
        </SortableList>
      </div>
    </Section>
  );
}

function VirtualSection(): JSX.Element {
  return (
    <Section title="VirtualList（1000 筆，DOM 節點 < 100）">
      <div className="pg-box" style={{ maxWidth: 420 }}>
        <VirtualList items={ROWS} itemSize={32} size={220} getKey={(r) => r.id}>
          {(row) => <div className="pg-virtual-row">{row.label}</div>}
        </VirtualList>
      </div>
    </Section>
  );
}

function IconsSection(): JSX.Element {
  return (
    <Section title={`Icons（${ICON_NAMES.length} 個，20x20 / 1.5px / currentColor）`}>
      <div className="pg-grid">
        {ICON_NAMES.map((name: IconName) => (
          <div key={name} className="pg-icon-cell">
            <Icon name={name} size={20} />
            <span>{name}</span>
          </div>
        ))}
      </div>
    </Section>
  );
}
