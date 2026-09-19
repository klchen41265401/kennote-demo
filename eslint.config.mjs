// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      'reference/**',
      // packages/editor-core 由編輯器核心代理維護，帶有自己的 tsconfig / vitest 設定。
      // TODO(M2-A 結束後)：把它納入根 lint，屆時一併清掉它的 lint 問題。
      'packages/editor-core/**',
      'e2e/**',
      'data/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    // 04 §7.4 鐵律 2：程式碼中禁止直接讀 process.env，一律 import { env }
    files: ['apps/server/src/**/*.ts'],
    ignores: ['apps/server/src/env.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message: '禁止直接讀 process.env，請 import { env } from "./env"（04 §7.4 鐵律 2）',
        },
      ],
    },
  },
);
