import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: 'mail-worker',
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    globalSetup: ['./vitest.global-setup.ts'],
    globals: true,
    include: ['test/**/*.test.ts'],
    passWithNoTests: true,
    // Pipeline tests TRUNCATE mail_messages between cases. Serialize file
    // execution to keep the DB deterministic, mirroring apps/web.
    fileParallelism: false,
  },
})
