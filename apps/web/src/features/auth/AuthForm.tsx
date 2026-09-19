import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../../lib/api-client';
import { openLogin } from '../../stores/auth';
import styles from './AuthForm.module.css';

export interface AuthFormProps {
  mode: 'login' | 'register';
  onSubmit: (values: { email: string; password: string; name?: string }) => Promise<void>;
}

export function AuthForm({ mode, onSubmit }: AuthFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const isRegister = mode === 'register';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      if (isRegister) {
        await onSubmit({ email, password, ...(name ? { name } : {}) });
      } else {
        // 開放登入：空白 → 訪客；未註冊 → 自動建立；正確 → 一般登入；密碼錯 → 訪客
        const res = await openLogin(email, password);
        if (res.note) setNotice(res.note);
      }
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : '發生未預期的錯誤，請稍後再試',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.wrapper}>
      <form className={styles.card} onSubmit={handleSubmit} noValidate>
        <div className={styles.brand}>
          <span className={styles.logo} aria-hidden="true">
            K
          </span>
          <h1 className={styles.title}>{isRegister ? '建立 kennote 帳號' : '登入 kennote'}</h1>
          <p className={styles.subtitle}>全自研的區塊式知識庫</p>
        </div>

        {isRegister && (
          <label className={styles.field}>
            <span className={styles.label}>顯示名稱（選填）</span>
            <input
              className={styles.input}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              maxLength={100}
            />
          </label>
        )}

        <label className={styles.field}>
          <span className={styles.label}>電子郵件</span>
          <input
            className={styles.input}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required={isRegister}
            placeholder={isRegister ? undefined : '可留空，直接進入'}
            autoFocus
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>密碼</span>
          <input
            className={styles.input}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            required={isRegister}
            placeholder={isRegister ? undefined : '可留空'}
            minLength={isRegister ? 8 : 0}
          />
          {isRegister && <span className={styles.hint}>至少 8 個字元</span>}
        </label>

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {notice && <p className={styles.hint}>{notice}</p>}

        <button className={styles.submit} type="submit" disabled={pending}>
          {pending ? '處理中…' : isRegister ? '建立帳號' : '登入'}
        </button>
        {!isRegister && (
          <button
            className={styles.guest}
            type="button"
            disabled={pending}
            onClick={async () => {
              setError(null);
              setPending(true);
              try {
                const res = await openLogin('', '');
                if (res.note) setNotice(res.note);
              } catch (err) {
                setError(err instanceof ApiError ? err.message : '發生未預期的錯誤，請稍後再試');
              } finally {
                setPending(false);
              }
            }}
          >
            不輸入，直接進入
          </button>
        )}

        <p className={styles.switch}>
          {isRegister ? (
            <>
              已經有帳號了？<Link to="/login">登入</Link>
            </>
          ) : (
            <>
              還沒有帳號？<Link to="/register">註冊</Link>
            </>
          )}
        </p>
      </form>
    </div>
  );
}
