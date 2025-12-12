import eslint from '@eslint/js';
import configPrettier from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import unicornPlugin from 'eslint-plugin-unicorn';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  // Enable type-aware linting for TypeScript files
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        // Use the project service so ESLint can leverage TS type info
        projectService: true,
        // Allow type-aware linting for standalone TS config files
        allowDefaultProject: ['vite.config.ts'],
      },
    },
  },
  // Scope type-checked recommendations strictly to TS files
  ...tseslint.configs.recommendedTypeChecked.map((cfg) => ({
    ...cfg,
    files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
  })),
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
      },
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  {
    ignores: ['vite.config.ts'],
  },
  {
    plugins: {
      import: importPlugin,
      unicorn: unicornPlugin,
    },
    rules: {
      // import hygiene
      'import/no-duplicates': 'error',
      'import/no-useless-path-segments': 'error',
      'import/no-extraneous-dependencies': [
        'error',
        {
          devDependencies: [
            '**/eslint.config.*',
            '**/vite.config.*',
            '**/*.config.*',
            '**/scripts/**',
            '**/*.test.*',
            '**/*.spec.*',
            '.github/**',
          ],
          optionalDependencies: false,
          peerDependencies: true,
        },
      ],
      // import ordering (low-noise, helpful for readability)
      'import/order': [
        'warn',
        {
          'groups': ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'object', 'type'],
          'newlines-between': 'always',
          'alphabetize': { order: 'asc', caseInsensitive: true },
        },
      ],

      // unused vars/imports (use TS version, disable base rule to avoid false positives)
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],

      // code quality
      'eqeqeq': ['error', 'always'],
      // Allow console.warn/error for error reporting; flag others
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-explicit-any': 'warn',

      // unicorn essentials
      'unicorn/prefer-node-protocol': 'error',
      'unicorn/prefer-string-starts-ends-with': 'error',
      'unicorn/prefer-array-find': 'error',
      'unicorn/throw-new-error': 'error',

      // typescript consistency (balanced)
      '@typescript-eslint/consistent-type-imports': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-require-imports': 'error',

      // (Type-aware rules moved to TS-only override below)
    },
  },
  // Node environment for config and build scripts
  {
    files: ['eslint.config.js', 'vite.config.*', '*.config.*', 'scripts/**'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  // Declarations: relax strictness for ambient types
  {
    files: ['**/*.d.ts'],
    rules: {
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
  // TS-only: enable balanced type-aware rules
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
      '@typescript-eslint/await-thenable': 'warn',

      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',

      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'warn',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
    },
  },
  // Disable ESLint rules that would conflict with Prettier formatting
  configPrettier,
);
