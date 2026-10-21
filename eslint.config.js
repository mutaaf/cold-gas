import globals from 'globals';

// Correctness-only lint: catches undefined identifiers and broken imports — the classic
// failure when carving main.js into modules. Style is not enforced.
export default [
  { ignores: ['dist/', 'node_modules/', 'playwright-report/', 'test-results/', '.wrangler/', '**/.wrangler/', 'src/vendor/'] },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node, WebSocketPair: 'readonly' },
    },
    rules: {
      'no-undef': 'error',
      'no-import-assign': 'error',
      'no-const-assign': 'error',
      'no-dupe-keys': 'error',
      'no-unreachable': 'error',
    },
  },
];
