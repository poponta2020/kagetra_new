import { defineConfig } from "tsup"

// @kagetra/shared は exports が .ts を直接指している (build step なし)。
// 本番では node が .ts の relative import (拡張子なし) を解決できないため、
// tsup でバンドルに含める。PR #36 (apps/api) と同様の対応。
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  outDir: "dist",
  clean: true,
  noExternal: ["@kagetra/shared"],
})
