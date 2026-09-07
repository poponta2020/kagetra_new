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
    // ★`fileParallelism: false` は外した（2026-09-07）。pipeline テストは
    // `mail_messages` を TRUNCATE するので以前は直列化が必須だったが、いまは
    // vitest.setup.ts が worker ごとに `<worktree DB>_w<VITEST_POOL_ID>` を用意する
    // （@kagetra/shared/test-db）ので、ファイル間で同じテーブルを取り合わない。
    // **同じ worker 内のファイルは従来どおり直列**なので truncate の決定性は保たれる。
  },
})
