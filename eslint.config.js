import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';

export default ts.config(
  { ignores: ['**/node_modules/', '**/dist/', '**/build/', '**/.svelte-kit/', 'docs/'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: { parserOptions: { parser: ts.parser } },
    rules: {
      // L'application est toujours servie à la racine de sa propre adresse (pas de « base path »),
      // et certains liens visent l'API (/api/...), qui n'est pas une route SvelteKit.
      'svelte/no-navigation-without-resolve': 'off',
    },
  },
);
