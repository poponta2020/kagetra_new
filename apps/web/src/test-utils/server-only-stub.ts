// `server-only` の実体は「import されたら throw する」だけのマーカーで、Next の
// ビルドだけが `react-server` condition で空実装へ差し替える。vitest からは素の
// index.js が読まれて即 throw するため、vitest.config.mts の alias でこの空
// モジュールへ向けている（パッケージの ./empty.js は exports に無く直接指せない）。
export {}
