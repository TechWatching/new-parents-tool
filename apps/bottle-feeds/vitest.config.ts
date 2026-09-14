import { fileURLToPath } from 'node:url'
import { configDefaults, defineConfig, mergeConfig } from 'vite-plus'
import viteConfig from './vite.config'

// `test.env` only exposes variables to test code. Set the process timezone
// before Vitest starts its workers so Date parsing is deterministic too.
process.env.TZ = 'UTC'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      // Pin the timezone so date/time formatting assertions are deterministic
      // regardless of the machine running the tests (CI runs in UTC already).
      env: { TZ: 'UTC' },
      exclude: [...configDefaults.exclude, 'e2e/**'],
      root: fileURLToPath(new URL('./', import.meta.url)),
    },
  }),
)
