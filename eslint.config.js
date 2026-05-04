import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import jsxA11yPlugin from 'eslint-plugin-jsx-a11y';
import reactHooksPlugin from 'eslint-plugin-react-hooks';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      'jsx-a11y': jsxA11yPlugin,
      'react-hooks': reactHooksPlugin,
    },
    rules: {
      ...jsxA11yPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      // Overly strict in v7 for ArcGIS init and i18n-driven announcer patterns
      'react-hooks/set-state-in-effect': 'off',
    },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
);
