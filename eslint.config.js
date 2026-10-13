// Flat config without external parser so `npm run lint` works post-install.
// TS-aware upgrade: add `@typescript-eslint/parser` then set `languageOptions.parser`.
module.exports = [
  {
    ignores: ['dist/**', 'dist-electron/**', 'release/**', 'node_modules/**'],
  },
  {
    files: ['electron/**/*.ts', 'src/**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2020, sourceType: 'module' },
    rules: {},
  },
]
