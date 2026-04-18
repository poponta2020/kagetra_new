import { defineProject } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineProject({
  plugins: [tsconfigPaths(), react()],
  test: {
    name: 'web',
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
    passWithNoTests: true,
    globalSetup: ['./vitest.global-setup.ts'],
    // Test files share one test DB (truncate/insert per test). Running them in
    // parallel causes cross-file interleaving on the same tables. Serialize to
    // keep the DB deterministic.
    fileParallelism: false,
  },
})
