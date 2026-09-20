/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_WS_URL?: string;
  /** '1' = Demo 模式（純瀏覽器後端，見 src/demo/README.md） */
  readonly VITE_DEMO?: string;
  /** 部署到子路徑時的 base（GitHub Pages 是 /kennote-demo/） */
  readonly VITE_BASE?: string;
  readonly VITE_FEATURE_OT?: string;
  readonly VITE_PROXY_TARGET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
