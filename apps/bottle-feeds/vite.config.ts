import { fileURLToPath, URL } from 'node:url'

import { defineConfig, lazyPlugins } from 'vite-plus'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import ui from '@nuxt/ui/vite'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig({
  fmt: {
    semi: false,
    singleQuote: true,
    printWidth: 100,
    sortPackageJson: false,
    ignorePatterns: [],
  },
  lint: {
    plugins: ['eslint', 'typescript', 'unicorn', 'oxc', 'vue', 'vitest'],
    categories: {
      correctness: 'error',
    },
    env: {
      browser: true,
      builtin: true,
    },
    ignorePatterns: ['**/dist/**', '**/dist-ssr/**', '**/coverage/**'],
    rules: {
      'no-array-constructor': 'error',
      'typescript/ban-ts-comment': 'error',
      'typescript/no-empty-object-type': 'error',
      'typescript/no-explicit-any': 'error',
      'typescript/no-namespace': 'error',
      'typescript/no-require-imports': 'error',
      'typescript/no-unnecessary-type-constraint': 'error',
      'typescript/no-unsafe-function-type': 'error',
      'vite-plus/prefer-vite-plus-imports': 'error',
    },
    overrides: [
      {
        files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts', '**/*.vue'],
        rules: {
          'constructor-super': 'off',
          'getter-return': 'off',
          'no-class-assign': 'off',
          'no-const-assign': 'off',
          'no-dupe-class-members': 'off',
          'no-dupe-keys': 'off',
          'no-func-assign': 'off',
          'no-import-assign': 'off',
          'no-new-native-nonconstructor': 'off',
          'no-obj-calls': 'off',
          'no-redeclare': 'off',
          'no-setter-return': 'off',
          'no-this-before-super': 'off',
          'no-undef': 'off',
          'no-unreachable': 'off',
          'no-unsafe-negation': 'off',
          'no-var': 'error',
          'no-with': 'off',
          'prefer-const': 'error',
          'prefer-rest-params': 'error',
          'prefer-spread': 'error',
        },
      },
      {
        files: ['e2e/**/*.{test,spec}.{js,ts,jsx,tsx}'],
        rules: {
          'no-empty-pattern': 'off',
          'playwright/consistent-spacing-between-blocks': 'warn',
          'playwright/expect-expect': 'warn',
          'playwright/max-nested-describe': 'warn',
          'playwright/missing-playwright-await': 'error',
          'playwright/no-conditional-expect': 'warn',
          'playwright/no-conditional-in-test': 'warn',
          'playwright/no-duplicate-hooks': 'warn',
          'playwright/no-duplicate-slow': 'warn',
          'playwright/no-element-handle': 'warn',
          'playwright/no-eval': 'warn',
          'playwright/no-focused-test': 'error',
          'playwright/no-force-option': 'warn',
          'playwright/no-nested-step': 'warn',
          'playwright/no-networkidle': 'error',
          'playwright/no-page-pause': 'warn',
          'playwright/no-skipped-test': 'warn',
          'playwright/no-standalone-expect': 'error',
          'playwright/no-unsafe-references': 'error',
          'playwright/no-unused-locators': 'error',
          'playwright/no-useless-await': 'warn',
          'playwright/no-useless-not': 'warn',
          'playwright/no-wait-for-navigation': 'error',
          'playwright/no-wait-for-selector': 'warn',
          'playwright/no-wait-for-timeout': 'warn',
          'playwright/prefer-hooks-in-order': 'warn',
          'playwright/prefer-hooks-on-top': 'warn',
          'playwright/prefer-locator': 'warn',
          'playwright/prefer-to-have-count': 'warn',
          'playwright/prefer-to-have-length': 'warn',
          'playwright/prefer-web-first-assertions': 'error',
          'playwright/valid-describe-callback': 'error',
          'playwright/valid-expect': 'error',
          'playwright/valid-expect-in-promise': 'error',
          'playwright/valid-test-tags': 'error',
          'playwright/valid-title': 'error',
        },
        jsPlugins: ['eslint-plugin-playwright'],
      },
      {
        files: ['src/**/__tests__/*'],
        rules: {
          'vitest/expect-expect': 'error',
          'vitest/no-commented-out-tests': 'error',
          'vitest/no-conditional-expect': 'error',
          'vitest/no-disabled-tests': 'warn',
          'vitest/no-focused-tests': 'error',
          'vitest/no-identical-title': 'error',
          'vitest/no-import-node-test': 'error',
          'vitest/no-interpolation-in-snapshots': 'error',
          'vitest/no-mocks-import': 'error',
          'vitest/no-standalone-expect': 'error',
          'vitest/no-unneeded-async-expect-function': 'error',
          'vitest/prefer-called-exactly-once-with': 'error',
          'vitest/require-mock-type-parameters': 'off',
          'vitest/require-local-test-context-for-concurrent-snapshots': 'error',
          'vitest/valid-describe-callback': 'error',
          'vitest/valid-expect': 'error',
          'vitest/valid-expect-in-promise': 'error',
          'vitest/valid-title': 'error',
        },
      },
    ],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    jsPlugins: [
      {
        name: 'vite-plus',
        specifier: 'vite-plus/oxlint-plugin',
      },
    ],
  },
  run: {
    tasks: {
      'build-parallel': {
        command: 'echo Build complete',
        dependsOn: ['type-check', 'build-only'],
      },
    },
  },
  plugins: lazyPlugins(() => [
    tailwindcss(),
    ui({
      // The app has a single, intentionally light "cosy" theme, so we opt out
      // of Nuxt UI's automatic light/dark color mode switching.
      colorMode: false,
      ui: {
        colors: {
          primary: 'coral',
          secondary: 'mint',
          // Nuxt UI's neutral prop only accepts its built-in neutrals; we pick
          // 'slate' here and override the neutral CSS vars to our sage ramp in style.css.
          neutral: 'slate',
        },
      },
    }),
    vue(),
    vueDevTools(),
  ]),
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
