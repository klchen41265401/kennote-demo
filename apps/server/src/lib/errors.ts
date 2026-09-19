import type { ErrorCode } from '@kennote/shared-types';

/** API 錯誤訊息一律用繁體中文（面向使用者） */
const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  BAD_REQUEST: '請求格式不正確',
  VALIDATION_FAILED: '輸入資料驗證失敗',
  UNAUTHORIZED: '請先登入',
  FORBIDDEN: '沒有權限執行這個操作',
  NOT_FOUND: '找不到指定的資源',
  CONFLICT: '資源狀態衝突，請重新整理後再試',
  RATE_LIMITED: '操作過於頻繁，請稍後再試',
  PAYLOAD_TOO_LARGE: '內容過大',
  INTERNAL_ERROR: '伺服器發生未預期的錯誤',
  NOT_IMPLEMENTED: '此功能尚未實作',

  EMAIL_TAKEN: '這個電子郵件已經註冊過了',
  INVALID_CREDENTIALS: '電子郵件或密碼不正確',
  SESSION_EXPIRED: '登入已逾期，請重新登入',
  SESSION_REUSED: '偵測到登入憑證被重複使用，為了安全已登出所有裝置',
  REFRESH_TOKEN_MISSING: '缺少登入憑證',
  PROVIDER_NOT_ENABLED: '這個登入方式尚未啟用',

  WORKSPACE_NOT_FOUND: '找不到工作區',
  PAGE_NOT_FOUND: '頁面不存在或已被刪除',
  PAGE_CYCLE: '無法把頁面搬移到自己的子頁面底下',
  PAGE_ALREADY_DELETED: '頁面已經在垃圾桶裡了',

  BLOCK_NOT_FOUND: '找不到指定的區塊',
  INVALID_OPERATION: '不合法的操作',
  INVALID_BLOCK_TYPE: '不支援的區塊型別',
  INVALID_BLOCK_PROPS: '區塊屬性格式不正確',
  TRANSACTION_TOO_LARGE: '一次提交的操作過多',
  VERSION_CONFLICT: '這個區塊已被其他人修改',

  COLLECTION_NOT_FOUND: '找不到資料庫',
  VIEW_NOT_FOUND: '找不到視圖',
  ROW_NOT_FOUND: '找不到資料列',
  INVALID_FIELD_TYPE: '不支援的欄位型別',
  INVALID_FIELD_VALUE: '欄位值格式不正確',
  INVALID_FILTER: '篩選條件不合法',

  FILE_NOT_FOUND: '找不到檔案',
  FILE_TOO_LARGE: '檔案超過大小上限',
  UNSUPPORTED_FILE_TYPE: '不支援的檔案類型',
  UPLOAD_FAILED: '檔案上傳失敗',
};

const STATUS_BY_CODE: Partial<Record<ErrorCode, number>> = {
  BAD_REQUEST: 400,
  VALIDATION_FAILED: 400,
  INVALID_OPERATION: 400,
  INVALID_BLOCK_TYPE: 400,
  INVALID_BLOCK_PROPS: 400,
  TRANSACTION_TOO_LARGE: 400,
  INVALID_FIELD_TYPE: 400,
  INVALID_FIELD_VALUE: 400,
  INVALID_FILTER: 400,
  PAGE_CYCLE: 400,
  UNSUPPORTED_FILE_TYPE: 400,
  UPLOAD_FAILED: 400,
  EMAIL_TAKEN: 409,
  CONFLICT: 409,
  VERSION_CONFLICT: 409,
  PAGE_ALREADY_DELETED: 409,
  UNAUTHORIZED: 401,
  INVALID_CREDENTIALS: 401,
  SESSION_EXPIRED: 401,
  SESSION_REUSED: 401,
  REFRESH_TOKEN_MISSING: 401,
  FORBIDDEN: 403,
  PROVIDER_NOT_ENABLED: 403,
  NOT_FOUND: 404,
  WORKSPACE_NOT_FOUND: 404,
  PAGE_NOT_FOUND: 404,
  BLOCK_NOT_FOUND: 404,
  COLLECTION_NOT_FOUND: 404,
  VIEW_NOT_FOUND: 404,
  ROW_NOT_FOUND: 404,
  FILE_NOT_FOUND: 404,
  PAYLOAD_TOO_LARGE: 413,
  FILE_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  NOT_IMPLEMENTED: 501,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message?: string, details?: Record<string, unknown>) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = STATUS_BY_CODE[code] ?? 500;
    if (details) this.details = details;
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

/**
 * 不洩漏存在性：非本 workspace 成員一律 404（00-README 第一週驗收標準）。
 * 所有「找不到 or 沒權限」的分支都用這個，避免哪天有人手滑回 403。
 */
export const pageNotFound = () => new AppError('PAGE_NOT_FOUND');
export const workspaceNotFound = () => new AppError('WORKSPACE_NOT_FOUND');
export const unauthorized = (message?: string) => new AppError('UNAUTHORIZED', message);

export function defaultMessage(code: ErrorCode): string {
  return DEFAULT_MESSAGES[code];
}
