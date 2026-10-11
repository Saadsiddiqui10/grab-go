// ESLint for the whole monorepo.
//
// TypeScript already does the heavy lifting (strict mode, noUnused*), so this
// config is about what the compiler cannot see: hooks called conditionally or
// with stale dependencies, floating `any`s, and accidental debugging left in.
// Formatting is not linted.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.expo/**',
      'apps/mobile/ios/**',
      'apps/mobile/android/**',
      'apps/api/prisma/migrations/**',
      '**/*.d.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      // The compiler reports unused code already; `_`-prefixed is deliberate.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },

  // React code: the dashboards, the shared UI package and the mobile app.
  {
    files: [
      'apps/mobile/**/*.{ts,tsx}',
      'apps/merchant-dashboard/src/**/*.{ts,tsx}',
      'apps/admin-dashboard/src/**/*.{ts,tsx}',
      'packages/ui/src/**/*.{ts,tsx}',
    ],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },

  // Config files and scripts run in Node and may use require().
  {
    files: ['**/*.{js,cjs,mjs}', 'scripts/**'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'no-console': 'off',
    },
  },

  // End-to-end tests assert on raw wire JSON; typing every response would
  // only duplicate the API's types, so untyped payloads are allowed there.
  {
    files: ['apps/api/e2e/**'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },

  // Seed and import scripts report progress on the console.
  {
    files: ['apps/api/prisma/**', 'apps/api/scripts/**'],
    rules: { 'no-console': 'off' },
  },
);
