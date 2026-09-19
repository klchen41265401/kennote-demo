/** 404：站內任何對不上的網址都落在這裡。 */
import { Link } from 'react-router-dom';
import { Button } from '@kennote/ui';
import shell from '../features/shell/Shell.module.css';

export function NotFoundRoute(): JSX.Element {
  return (
    <div className={shell.stateScreen}>
      <p className={shell.stateTitle}>找不到這個頁面</p>
      <p className={shell.stateHint}>網址可能打錯了，或這個頁面已經被刪除。</p>
      <Link to="/">
        <Button variant="primary">回到首頁</Button>
      </Link>
    </div>
  );
}
