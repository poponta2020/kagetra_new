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
    // ★`fileParallelism: false` は外した（2026-09-07）。以前は全テストファイルが
    // 1つのテスト DB を共有していたため直列化が必須で、Vitest だけで11分かかり
    // CI の timeout を押し上げていた。いまは vitest.setup.ts が worker ごとに
    // `<worktree DB>_w<id>` を用意する（@kagetra/shared/test-db）ので、ファイル間で
    // 同じテーブルを取り合うことはない。**同じ worker 内のファイルは従来どおり
    // 直列**なので、truncate/insert の決定性はそのまま保たれる。
  },
})
