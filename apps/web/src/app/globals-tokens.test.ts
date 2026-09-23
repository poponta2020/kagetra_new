import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// 配色トークンの正典 globals.css を「ソースレベルで」固定する機械ガード。
// design-spec: docs/features/hokumei-palette/design-spec.md（§2・§3・§8）。
//
// globals.css には同じ色が 2 系統ある:
//   - `@theme` の `--color-*`（Tailwind v4 のユーティリティになる側）
//   - `:root` の `--kg-*`（inline style から var() で参照する側のミラー）
// 片方だけ直すと画面の一部だけ古い色で残るが、typecheck・lint・既存テストは
// どれも落ちない。ここで 2 系統の同値と spec 値との一致を固定する。
//
// ★hex 照合で「どの役の色か」を判定しないこと。success == brand、
// danger == accent、surface == ink-on-brand == white が衝突する。
// このテストは必ずトークン名で引く。

const CSS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'globals.css'),
  'utf8',
)

/** `<selector> {` から、行頭の `}` までの本文を返す（コメントは除去）。 */
function block(selector: '@theme' | ':root'): string {
  const start = CSS.indexOf(`\n${selector} {`)
  if (start < 0) throw new Error(`${selector} ブロックが見つからない`)
  const end = CSS.indexOf('\n}', start + 1)
  return CSS.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, '')
}

/** ブロック内の `--<prefix><name>: <value>;` を name → value（空白を 1 つに畳む）で返す。 */
function decls(body: string, prefix: string): Map<string, string> {
  const out = new Map<string, string>()
  const re = new RegExp(`--${prefix}([a-z0-9-]+)\\s*:\\s*([^;]+);`, 'g')
  for (const m of body.matchAll(re)) {
    out.set(m[1]!, m[2]!.replace(/\s+/g, ' ').trim())
  }
  return out
}

const HEX = /^#[0-9a-f]{6}$/i
const theme = decls(block('@theme'), 'color-')
const kg = decls(block(':root'), 'kg-')
const shadows = decls(block('@theme'), 'shadow-')

/** @theme の値（小文字化）。未定義なら undefined のまま比較に落とす。 */
const t = (name: string) => theme.get(name)?.toLowerCase()
const k = (name: string) => kg.get(name)?.toLowerCase()

// design-spec §2 の確定値（A1 白波・round 4）。palette-check.mjs の PINNED と同じもの。
// round 4 で面と枠線のラダー 5 トークンの彩度を 0.375 倍へ落とした（明度・色相は据え置き）。
const SPEC: Readonly<Record<string, string>> = {
  // §2.1 面と枠線
  surface: '#ffffff',
  canvas: '#dfe8ed',
  'surface-alt': '#d1dbe2',
  'border-soft': '#cad2d9',
  border: '#b6bfc7',
  'border-strong': '#9099a2',
  // §2.2 墨
  ink: '#121824',
  'ink-2': '#283040',
  'ink-meta': '#515c6c',
  'ink-muted': '#8594a5',
  'ink-on-brand': '#ffffff',
  // §2.3 紺
  brand: '#15387d',
  'brand-hover': '#092563',
  'brand-fg': '#0e2c67',
  'brand-bg': '#bdddff',
  // §2.4 success は brand に追随
  success: '#15387d',
  'success-fg': '#0e2c67',
  'success-bg': '#bdddff',
  // §2.5 朱と山吹（据え置き）
  accent: '#b33c2d',
  'accent-fg': '#8f2d20',
  'accent-bg': '#f4d5cf',
  danger: '#b33c2d',
  'danger-fg': '#8f2d20',
  'danger-bg': '#f4d5cf',
  warn: '#b17915',
  'warn-fg': '#785214',
  'warn-bg': '#f5ddb8',
  // §2.6 補足・中立
  'neutral-bg': '#d8dde2',
  'neutral-fg': '#3d4958',
  'info-bg': '#d2dee9',
  'info-fg': '#3d4958',
  // §2.7 LINE 緑（据え置き）
  line: '#06c755',
  'line-hover': '#05a648',
}

// @theme 名 → :root 名。ここに無いものは同名（`brand` → `--kg-brand`）。
const MIRROR_RENAME: Readonly<Record<string, string>> = {
  canvas: 'bg',
  ink: 'fg',
  'ink-2': 'fg-2',
  'ink-meta': 'fg-3',
  'ink-muted': 'fg-muted',
  'ink-on-brand': 'fg-on-brand',
  line: 'line-green',
  'line-hover': 'line-green-hv',
}
const mirrorName = (name: string) => MIRROR_RENAME[name] ?? name

// :root 側だけにある hex トークン（@theme を持たない意図的な非対称。spec §2.7）
const KG_ONLY = ['nonattend'] as const

describe('globals.css @theme --color-*（design-spec §2）', () => {
  it('トークン名の集合が spec と一致する（新設・削除 0）', () => {
    expect([...theme.keys()].sort()).toEqual(Object.keys(SPEC).sort())
  })

  it.each(Object.entries(SPEC))('--color-%s が %s', (name, hex) => {
    expect(t(name)).toBe(hex)
  })
})

describe('globals.css :root --kg-* ミラー', () => {
  it.each(Object.keys(SPEC))('--color-%s と対応する --kg-* が同値', (name) => {
    const mirrored = k(mirrorName(name))
    expect(mirrored, `--kg-${mirrorName(name)} が無い`).toBeDefined()
    expect(mirrored).toBe(t(name))
  })

  it('hex 値を持つ --kg-* はミラー + 意図的な :root 専用分だけ（増減 0）', () => {
    const hexKg = [...kg.entries()].filter(([, v]) => HEX.test(v)).map(([n]) => n)
    const expected = [...Object.keys(SPEC).map(mirrorName), ...KG_ONLY]
    expect(hexKg.sort()).toEqual(expected.sort())
  })
})

describe('同値関係（design-spec §2.4・§2.5・§2.6）', () => {
  it.each([
    ['success', 'brand'],
    ['success-bg', 'brand-bg'],
    ['success-fg', 'brand-fg'],
    ['danger', 'accent'],
    ['danger-bg', 'accent-bg'],
    ['danger-fg', 'accent-fg'],
    ['info-fg', 'neutral-fg'],
    ['ink-on-brand', 'surface'],
  ])('%s == %s', (a, b) => {
    expect(t(a)).toBeDefined()
    expect(t(a)).toBe(t(b))
  })
})

describe('据え置く値（design-spec §2.5・§2.7）', () => {
  it.each([
    ['accent', '#b33c2d'],
    ['accent-fg', '#8f2d20'],
    ['accent-bg', '#f4d5cf'],
    ['warn', '#b17915'],
    ['warn-fg', '#785214'],
    ['warn-bg', '#f5ddb8'],
    ['line', '#06c755'],
    ['line-hover', '#05a648'],
  ])('--color-%s は %s のまま', (name, hex) => {
    expect(t(name)).toBe(hex)
  })

  it('--kg-nonattend は #f3b4b4 のまま', () => {
    expect(k('nonattend')).toBe('#f3b4b4')
  })
})

describe('影（design-spec §3）', () => {
  // 3 段の割り当て・2 層・alpha は据え置き。基色だけ rgba(23, 43, 73) へ。
  const EXPECTED: Readonly<Record<string, string>> = {
    sm: '0 1px 2px rgba(23, 43, 73, 0.1), 0 3px 8px rgba(23, 43, 73, 0.07)',
    nav: '0 -1px 3px rgba(23, 43, 73, 0.06), 0 -4px 14px rgba(23, 43, 73, 0.08)',
    lg: '0 8px 28px rgba(23, 43, 73, 0.2), 0 2px 6px rgba(23, 43, 73, 0.1)',
  }

  it('影トークンは sm / nav / lg の 3 本だけ', () => {
    expect([...shadows.keys()].sort()).toEqual(Object.keys(EXPECTED).sort())
  })

  it.each(Object.entries(EXPECTED))('--shadow-%s が 2 層・基色 rgba(23, 43, 73)', (name, value) => {
    expect(shadows.get(name)).toBe(value)
    expect(shadows.get(name)!.match(/rgba\(23, 43, 73, /g)).toHaveLength(2)
  })
})
