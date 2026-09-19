/** 機器可讀、可列舉的錯誤碼。前端只寫一次處理邏輯（04 §5.3） */
export const ERROR_CODES = [
  // 通用
  'BAD_REQUEST',
  'VALIDATION_FAILED',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'INTERNAL_ERROR',
  'NOT_IMPLEMENTED',
  // 認證
  'EMAIL_TAKEN',
  'INVALID_CREDENTIALS',
  'SESSION_EXPIRED',
  'SESSION_REUSED',
  'REFRESH_TOKEN_MISSING',
  'PROVIDER_NOT_ENABLED',
  // 工作區 / 頁面
  'WORKSPACE_NOT_FOUND',
  'PAGE_NOT_FOUND',
  'PAGE_CYCLE',
  'PAGE_ALREADY_DELETED',
  // Block / transaction
  'BLOCK_NOT_FOUND',
  'INVALID_OPERATION',
  'INVALID_BLOCK_TYPE',
  'INVALID_BLOCK_PROPS',
  'TRANSACTION_TOO_LARGE',
  'VERSION_CONFLICT',
  // Database
  'COLLECTION_NOT_FOUND',
  'VIEW_NOT_FOUND',
  'ROW_NOT_FOUND',
  'INVALID_FIELD_TYPE',
  'INVALID_FIELD_VALUE',
  'INVALID_FILTER',
  // 檔案
  'FILE_NOT_FOUND',
  'FILE_TOO_LARGE',
  'UNSUPPORTED_FILE_TYPE',
  'UPLOAD_FAILED',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorShape {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

/** 所有失敗回應都長這樣 */
export interface ApiErrorResponse {
  error: ApiErrorShape;
}

/** 所有成功回應都長這樣 */
export interface ApiSuccessResponse<T> {
  data: T;
  meta?: { cursor?: string | null; total?: number; hasMore?: boolean };
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

export function isApiError(r: unknown): r is ApiErrorResponse {
  return typeof r === 'object' && r !== null && 'error' in r;
}

/** 前端用來判斷要不要跳登入頁 */
export const AUTH_ERROR_CODES: readonly ErrorCode[] = [
  'UNAUTHORIZED',
  'SESSION_EXPIRED',
  'SESSION_REUSED',
  'REFRESH_TOKEN_MISSING',
];
