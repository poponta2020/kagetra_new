import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: 'shared',
    environment: 'node',
    // Pure schema/type smoke tests — no DB, no globalSetup needed.
    include: ['__tests__/**/*.test.ts'],
    passWithNoTests: true,
  },
})
