/**
 * 錯誤邊界。React 的 error boundary 必須是 class component（沒有 hook 版本）。
 * 一個 render 期的例外不應該讓整個 App 變白畫面。
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@kennote/ui';
import styles from './Shell.module.css';

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** 這個值一變就重設錯誤狀態（通常餵 location.pathname） */
  resetKey?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // 讓錯誤在 devtools 留下痕跡（線上版也需要，不然只會看到空白畫面）
    console.error('[kennote] 未捕捉的錯誤', error, info.componentStack);
  }

  override componentDidUpdate(prev: ErrorBoundaryProps): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className={styles.stateScreen} role="alert">
        <p className={styles.stateTitle}>這裡出了一點問題</p>
        <p className={styles.stateHint}>{this.state.error.message}</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="primary" onClick={() => this.setState({ error: null })}>
            再試一次
          </Button>
          <Button variant="outline" onClick={() => window.location.assign('/')}>
            回到首頁
          </Button>
        </div>
      </div>
    );
  }
}
