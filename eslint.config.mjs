import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**', '**/next-env.d.ts', 'apps/web/public/map-worker.mjs'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.cjs'],
    languageOptions: { globals: { require: 'readonly', process: 'readonly', fetch: 'readonly', console: 'readonly', setTimeout: 'readonly', __dirname: 'readonly', global: 'readonly', URL: 'readonly' } },
    rules: { '@typescript-eslint/no-require-imports': 'off' }
  }
);
