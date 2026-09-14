/// <reference types="node" />
import { defineConfig, devices } from '@playwright/test'
import { env } from 'node:process'

const base = env.PWA_BASE === '/' ? '/' : '/new-parents-tool/'
const configured = env.PWA_BACKEND === 'configured'
const mode = `${base === '/' ? 'root' : 'pages'}-${configured ? 'configured' : 'blank'}`

export default defineConfig({
  testDir: './e2e/pwa',
  testMatch: '**/*.pwa.ts',
  outputDir: `test-results/pwa-${mode}`,
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  use: {
    baseURL: `http://localhost:4181${base}`,
    serviceWorkers: 'allow',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: `chromium-pwa-${mode}`,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `vp build --base=${base} --outDir=.playwright-cli/pwa-dist && vp preview --base=${base} --outDir=.playwright-cli/pwa-dist --host=localhost --port=4181 --strictPort`,
    url: `http://localhost:4181${base}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      // Reserved test domain and syntactically valid public key. The browser
      // test must observe the available sign-in UI, not silently disabled config.
      VITE_SUPABASE_URL: configured ? 'https://offline-pwa.invalid' : '',
      VITE_SUPABASE_PUBLISHABLE_KEY: configured
        ? 'sb_publishable_offline_regression_public_key'
        : '',
    },
  },
})
