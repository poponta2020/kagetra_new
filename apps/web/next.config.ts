import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // @kagetra/mail-worker is consumed via its TS source `exports` map
  // (apps/mail-worker/package.json). Its files use `.js` import suffixes
  // (NodeNext convention) which webpack only resolves to `.ts` when the
  // package is in `transpilePackages`. Mirrors the existing @kagetra/shared
  // entry; without it, /admin/mail-inbox/[id] fails to compile because
  // actions.ts → classifier.ts → ../persist/draft.js cannot be resolved.
  transpilePackages: ['@kagetra/shared', '@kagetra/mail-worker'],
  output: 'standalone',
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
