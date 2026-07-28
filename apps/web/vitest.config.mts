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
    // Test files share one test DB (truncate/insert per test). Running them in
    // parallel causes cross-file interleaving on the same tables. Serialize to
    // keep the DB deterministic.
    fileParallelism: false,
  },
})
