import { defineProject } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineProject({
  plugins: [tsconfigPaths(), react()],
  test: {
    name: 'web',
    environment: 'jsdom',
    setupFiles: [],
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
    passWithNoTests: true,
  },
})
