import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

// Lint for the app, the serverless functions, the committed scripts and the
// tests. The rules are the ones that catch real bugs — undefined names, hooks
// called conditionally, a JSX list without keys, unreachable code — plus
// unused names, which are where dead code hides. Style is left to the
// surrounding file. `npm run lint`; part of `npm run check` and the commit guard.
export default [
  {
    ignores: ['dist/**', 'node_modules/**', '.smoke/**', 'reports/**', 'data/**', '.local/**', 'coverage/**', 'scripts/**/*', '!scripts/i18n_parity.mjs', '!scripts/smoke.mjs', '!scripts/checks.mjs'],
  },
  js.configs.recommended,
  // The app carries eslint-disable comments for react-hooks/exhaustive-deps,
  // which is off below; they are not reported as unused.
  { linterOptions: { reportUnusedDisableDirectives: 'off' } },
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    settings: { react: { version: '18.3' } },
    plugins: { react, 'react-hooks': reactHooks },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      'react-hooks/rules-of-hooks': 'error',
      // Off: the app predates the rule, and effects that read state on
      // purpose would need restructuring, not a lint fix.
      'react-hooks/exhaustive-deps': 'off',
      'react/prop-types': 'off',
      'react/no-unescaped-entities': 'off',
    },
  },
  {
    files: ['api/**/*.js', 'scripts/*.mjs', 'tests/**/*.js', '*.config.js', '.claude/hooks/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
  {
    // The smoke's page.evaluate callbacks run in the browser.
    files: ['scripts/smoke.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true, varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];
