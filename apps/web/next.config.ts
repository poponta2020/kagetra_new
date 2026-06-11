import path from 'node:path'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // @kagetra/mail-worker is consumed via its TS source `exports` map
  // (apps/mail-worker/package.json). Its files use `.js` import suffixes
  // (NodeNext convention) which webpack only resolves to `.ts` when the
  // package is in `transpilePackages`. Mirrors the existing @kagetra/shared
  // entry; without it, /admin/mail-inbox/[id] fails to compile because
  // actions.ts → classifier.ts → ../persist/draft.js cannot be resolved.
  //
  // Deploy coupling (Issue #135): everything listed here is compiled INTO the
  // web bundle at build time, so a source change in these packages requires a
  // web rebuild + restart even when apps/web/ itself is untouched.
  // scripts/deploy/auto-deploy.sh's WEB target detection must cover each
  // bundled package's directory — keep the two in sync when adding entries.
  transpilePackages: ['@kagetra/shared', '@kagetra/mail-worker'],
  output: 'standalone',
  // monorepo の root を明示。Next.js 15 は auto-detect するが、CI/prod 差異リスク回避のため明示 (Phase B Phase 0 Discovery 結果)。
  outputFileTracingRoot: path.join(__dirname, '../../'),
  // dev で Hono RPC client (apps/web/src/lib/api.ts) の相対 path '/hono-api/*' を http://localhost:3001 に転送する。本番は nginx が同じ path を api 3001 に proxy_pass するので、ここでは production=空配列。
  async rewrites() {
    return process.env.NODE_ENV === 'production'
      ? []
      : [{ source: '/hono-api/:path*', destination: 'http://localhost:3001/hono-api/:path*' }]
  },
  webpack: (config) => {
    // Resolve `import './foo.js'` against `./foo.ts` so the `.js`-suffixed
    // relative imports inside @kagetra/mail-worker (NodeNext / TS bundler
    // convention) work when bundled by Next's webpack — without this the
    // `from '../persist/draft.js'` style throws Module not found at compile
    // time. See nodejs.org/api/esm.html#mandatory-file-extensions.
    config.resolve = config.resolve ?? {}
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
    }
    return config
  },
}

export default nextConfig
