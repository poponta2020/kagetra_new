import { fileURLToPath } from 'node:url'
import { defineProject } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineProject({
  plugins: [tsconfigPaths(), react()],
  resolve: {
    alias: {
      // `server-only` の実体は「import されたら throw する」1行のマーカー。
      // Next のビルドだけが `react-server` condition で空実装へ差し替えるため、
      // vitest からは素の index.js が読まれて即 throw する。サーバー専用モジュール
      // （lib/entry-form/* など）を単体テストできるよう空実装へ向ける（パッケージ
      // 同梱の ./empty.js は exports に載っておらず直接指せない）。
      'server-only': fileURLToPath(new URL('./src/test-utils/server-only-stub.ts', import.meta.url)),
    },
  },
  test: {
    name: 'web',
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
    passWithNoTests: true,
    globalSetup: ['./vitest.global-setup.ts'],
    // ★ローカルは並列・**CI は直列**（2026-09-07 に両方を実測して決めた）。
    //
    // 以前は全テストファイルが1つのテスト DB を共有していたため常に直列化が必要
    // だった。いまは vitest.setup.ts が worker ごとに `<worktree DB>_w<VITEST_POOL_ID>`
    // を用意する（@kagetra/shared/test-db）ので、ファイル間でテーブルを取り合わない。
    // 開発機（12コア）では 675s→188s。
    //
    // ただし **CI（GitHub ubuntu-latest = 4 vCPU）では並列化すると逆に遅くなる**:
    // worker 3つ + 同じ4コアに載る Postgres が競合し、集計テスト時間が 600s→2278s
    // に膨らんで実時間も 12分→14.5分に悪化。さらに `beforeEach(truncateAll)` が
    // 10 秒の hookTimeout を超えて落ちた（run 34094874364）。コア数が足りない環境
    // では直列の方が速い。CI を速くしたいなら worker を増やすのではなく
    // `--shard` でジョブを分割する（＝ランナーを増やす）のが筋。
    //
    // **同じ worker 内のファイルは直列**なので、どちらの経路でも truncate/insert
    // の決定性は保たれる。
    fileParallelism: !process.env.CI,
  },
})
