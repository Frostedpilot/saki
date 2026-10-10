// eslint.config.mjs — repo lint (KI-06 follow-up: this file did not exist).
//
// engine/ + server/ are CommonJS; web-client/ is strict TypeScript (tsc runs
// in `npm run build`, so the TS rules here are style-level, not type-level).
// Run: `npm run lint`. CI fails on errors; warnings do not fail the build.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'server/public/**',
      'web-client/public/**',
      'web-client/src/assets/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-console': 'off',
    },
  },
  {
    files: ['engine/**/*.js', 'server/**/*.js', 'scripts/**/*.mjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        console: 'readonly',
        process: 'readonly',
        module: 'writable',
        require: 'readonly',
        __dirname: 'readonly',
        Buffer: 'readonly',
        performance: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
      },
    },
    rules: {
      // The codebase is CommonJS by design ("type": "commonjs" in every
      // package.json); require() is the module system, not a smell.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['web-client/src/**/*.ts'],
    rules: {
      // tsc is the type gate; these are the footguns tsc cannot see.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'off', // TS handles this
    },
  },
  {
    files: ['**/*.test.js', '**/*.test.ts', 'engine/tests/**/*.js', 'server/test/**/*.js'],
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  }
);
