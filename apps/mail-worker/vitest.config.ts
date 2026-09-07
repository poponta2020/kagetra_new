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
    // ★ローカルは並列・**CI は直列**（apps/web/vitest.config.mts の同じ判断に揃える。
    // 4 vCPU の CI ランナーでは worker を増やすと Postgres と競合して逆に遅くなる）。
    // pipeline テストは `mail_messages` を TRUNCATE するので以前は常に直列化が必要
    // だったが、いまは vitest.setup.ts が worker ごとに
    // `<worktree DB>_w<VITEST_POOL_ID>` を用意する（@kagetra/shared/test-db）ので、
    // ファイル間で同じテーブルを取り合わない。開発機（12コア）では 69s→20s。
    // **同じ worker 内のファイルは直列**なので truncate の決定性は保たれる。
    fileParallelism: !process.env.CI,
  },
})
