/**
 * 環境變數是唯一允許讀 process.env 的地方（04 §7.4 鐵律 2，eslint 也會擋）。
 * 缺必填項目時：印出「變數名稱 + 說明」後 exit 1。
 */
import { z } from 'zod';

/** 每個變數的中文說明，驗證失敗時一併印出來，不用回去翻文件 */
const DESCRIPTIONS: Record<string, string> = {
  NODE_ENV: '執行環境：development | test | production',
  LOG_LEVEL: '日誌等級：fatal|error|warn|info|debug|trace',
  SERVER_PORT: 'HTTP 監聽埠，預設 4000',
  SERVER_HOST: 'HTTP 監聽位址，Docker 內要用 0.0.0.0',
  PUBLIC_BASE_URL: '前端對外網址，OIDC callback 與分享連結會用到',
  CORS_ORIGINS: '允許的前端來源，逗號分隔；同源部署可留空',
  DATABASE_URL: '★必填★ PostgreSQL 連線字串，例：postgres://kennote:kennote@localhost:5432/kennote',
  DATABASE_URL_TEST: '整合測試用的資料庫連線字串；留空時需要 DB 的測試會自動 skip',
  DATABASE_POOL_MAX: 'pg Pool 上限，建議 (CPU 核心數 × 2) + 2',
  REDIS_URL: 'Redis 連線字串（M5 之後才需要，留空＝用記憶體 broadcast）',
  JWT_SECRET: '★必填★ access token 簽章金鑰，至少 32 字元：openssl rand -base64 48',
  JWT_ACCESS_TTL_SECONDS: 'access token 有效秒數，預設 900（15 分鐘）',
  JWT_REFRESH_TTL_SECONDS: 'refresh token 有效秒數，預設 2592000（30 天）',
  COOKIE_DOMAIN: 'refresh cookie 的網域，留空＝當前網域',
  COOKIE_SECURE: 'refresh cookie 是否加 Secure 旗標；正式環境（HTTPS）必須為 true',
  GOOGLE_CLIENT_ID: 'Google OIDC client id（留空＝不啟用 Google 登入）',
  GOOGLE_CLIENT_SECRET: 'Google OIDC client secret',
  LINE_CHANNEL_ID: 'LINE Login channel id（留空＝不啟用 LINE 登入）',
  LINE_CHANNEL_SECRET: 'LINE Login channel secret',
  STORAGE_DRIVER: '檔案儲存驅動：local | s3',
  STORAGE_LOCAL_PATH: 'local 驅動的儲存根目錄',
  STORAGE_MAX_FILE_SIZE: '單檔大小上限（bytes），預設 52428800（50MB）',
  S3_ENDPOINT: 'S3 相容端點（MinIO / R2）',
  S3_REGION: 'S3 區域',
  S3_BUCKET: 'S3 bucket 名稱',
  S3_ACCESS_KEY_ID: 'S3 access key',
  S3_SECRET_ACCESS_KEY: 'S3 secret key',
  S3_FORCE_PATH_STYLE: 'MinIO 需要設 true',
  FEATURE_REALTIME: '是否啟用 WebSocket 即時同步',
  FEATURE_PUBLIC_SHARE: '是否啟用公開分享連結',
  FEATURE_OT: '是否啟用自建 OT（M6 才打開）',
  RATE_LIMIT_MAX: '每個時間窗的最大請求數（寫入端點）',
  RATE_LIMIT_WINDOW: '速率限制時間窗，例 1 minute',
};

const boolish = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? defaultValue : v === 'true' || v === '1'));

const intWithDefault = (defaultValue: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? defaultValue : Number(v)))
    .pipe(z.number().int().positive());

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? null : v.trim()));

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  SERVER_PORT: intWithDefault(4000),
  SERVER_HOST: z.string().default('0.0.0.0'),
  PUBLIC_BASE_URL: z.string().default('http://localhost:5173'),
  CORS_ORIGINS: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),

  DATABASE_URL: z
    .string({ required_error: '必填' })
    .min(1, '必填')
    .refine((v) => v.startsWith('postgres://') || v.startsWith('postgresql://'), {
      message: '必須是 postgres:// 或 postgresql:// 開頭的連線字串',
    }),
  DATABASE_URL_TEST: optionalString,
  DATABASE_POOL_MAX: intWithDefault(10),
  REDIS_URL: optionalString,

  JWT_SECRET: z.string({ required_error: '必填' }).min(32, '至少 32 字元（openssl rand -base64 48）'),
  JWT_ACCESS_TTL_SECONDS: intWithDefault(900),
  JWT_REFRESH_TTL_SECONDS: intWithDefault(2_592_000),
  COOKIE_DOMAIN: optionalString,
  COOKIE_SECURE: boolish(false),

  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  LINE_CHANNEL_ID: optionalString,
  LINE_CHANNEL_SECRET: optionalString,

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_PATH: z.string().default('./data/uploads'),
  STORAGE_MAX_FILE_SIZE: intWithDefault(52_428_800),
  S3_ENDPOINT: optionalString,
  S3_REGION: optionalString,
  S3_BUCKET: optionalString,
  S3_ACCESS_KEY_ID: optionalString,
  S3_SECRET_ACCESS_KEY: optionalString,
  S3_FORCE_PATH_STYLE: boolish(true),

  FEATURE_REALTIME: boolish(true),
  FEATURE_PUBLIC_SHARE: boolish(false),
  FEATURE_OT: boolish(false),

  RATE_LIMIT_MAX: intWithDefault(100),
  RATE_LIMIT_WINDOW: z.string().default('1 minute'),
});

export type Env = z.infer<typeof EnvSchema>;

/** 純函式版本，方便單元測試（不 exit process） */
export function parseEnv(source: Record<string, string | undefined>):
  | { ok: true; env: Env }
  | { ok: false; issues: Array<{ name: string; message: string; description: string }> } {
  const parsed = EnvSchema.safeParse(source);
  if (parsed.success) return { ok: true, env: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues.map((i) => {
      const name = i.path.join('.');
      return {
        name,
        message: i.message,
        description: DESCRIPTIONS[name] ?? '（.env.example 有完整說明）',
      };
    }),
  };
}

function loadEnv(): Env {
  const result = parseEnv(process.env);
  if (!result.ok) {
    const lines = result.issues.map(
      (i) => `  - ${i.name}: ${i.message}\n      說明：${i.description}`,
    );
    console.error(
      ['', '❌ 環境變數設定錯誤，伺服器無法啟動：', ...lines, '', '請參考 .env.example。', ''].join(
        '\n',
      ),
    );
    process.exit(1);
  }
  return result.env;
}

export const env: Env = loadEnv();

export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
