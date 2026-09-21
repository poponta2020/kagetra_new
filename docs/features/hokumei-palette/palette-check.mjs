// 北溟パレット（A1 白波）の導出と検証。
//
//   node docs/features/hokumei-palette/palette-check.mjs
//
// やること:
//   1. 各トークンを OKLCH 指定から sRGB hex へ導出する
//   2. design-spec.md に書いた hex（PINNED）と一致することを確認する
//   3. WCAG コントラストと明度ラダーを実測する
// いずれかが崩れたら exit 1。依存パッケージなし（Node 標準のみ）。
//
// globals.css の値を動かすときは、先にここの SPEC / PINNED を直して
// 全チェックが通ることを確認してから globals.css へ写すこと。

const clamp01 = (x) => Math.min(1, Math.max(0, x))
const gam = (x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055)
const lin = (x) => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4))

function oklchToLinear(L, C, h) {
  const hr = (h * Math.PI) / 180
  const a = C * Math.cos(hr)
  const b = C * Math.sin(hr)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}
function oklchToHex(L, C, h) {
  let c = C
  let rgb = oklchToLinear(L, c, h)
  // ガマット外なら彩度だけを落として収める
  while (!rgb.every((v) => v >= -0.0005 && v <= 1.0005) && c > 0) {
    c -= 0.001
    rgb = oklchToLinear(L, c, h)
  }
  return '#' + rgb.map((v) => Math.round(clamp01(gam(clamp01(v))) * 255).toString(16).padStart(2, '0')).join('')
}
function hexToLinear(hex) {
  const h = hex.replace('#', '')
  return [0, 2, 4].map((i) => lin(parseInt(h.slice(i, i + 2), 16) / 255))
}
function hexToOklch(hex) {
  const [r, g, b] = hexToLinear(hex)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  let h = (Math.atan2(bb, a) * 180) / Math.PI
  if (h < 0) h += 360
  return { L, C: Math.hypot(a, bb), h }
}
function contrast(a, b) {
  const lum = (hex) => {
    const [r, g, bl] = hexToLinear(hex)
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// ---------- 導出仕様（OKLCH [L, C, h]） ----------
const SPEC = {
  canvas: [0.925, 0.032, 238],
  'surface-alt': [0.885, 0.038, 238],
  'border-soft': [0.86, 0.035, 240],
  border: [0.8, 0.04, 242],
  'border-strong': [0.68, 0.045, 248],
  ink: [0.21, 0.025, 262],
  'ink-2': [0.31, 0.03, 262],
  'ink-meta': [0.47, 0.03, 258],
  'ink-muted': [0.66, 0.03, 252],
  brand: [0.36, 0.125, 262],
  'brand-hover': [0.29, 0.115, 263],
  'brand-fg': [0.31, 0.11, 262],
  'brand-bg': [0.885, 0.058, 250],
  'neutral-bg': [0.895, 0.008, 250],
  'neutral-fg': [0.4, 0.03, 256],
  'info-bg': [0.895, 0.02, 245],
  // 統計の級トーン（藍 → 水色鼠。A は brand と同値）
  'grade-B': [0.46, 0.105, 258],
  'grade-C': [0.565, 0.085, 252],
  'grade-D': [0.67, 0.065, 246],
  'grade-E': [0.77, 0.045, 240],
  // 影の基色（alpha を掛けて使う）
  'shadow-base': [0.29, 0.06, 258],
}

// ---------- design-spec.md に書いた確定値 ----------
const PINNED = {
  surface: '#ffffff',
  canvas: '#d3eafa',
  'surface-alt': '#c3ddf0',
  'border-soft': '#bdd5e6',
  border: '#a8c2d6',
  'border-strong': '#839bb3',
  ink: '#121824',
  'ink-2': '#283040',
  'ink-meta': '#515c6c',
  'ink-muted': '#8594a5',
  brand: '#15387d',
  'brand-hover': '#092563',
  'brand-fg': '#0e2c67',
  'brand-bg': '#bdddff',
  'neutral-bg': '#d8dde2',
  'neutral-fg': '#3d4958',
  'info-bg': '#d2dee9',
  // 据え置き
  accent: '#b33c2d',
  'accent-fg': '#8f2d20',
  'accent-bg': '#f4d5cf',
  warn: '#b17915',
  'warn-fg': '#785214',
  'warn-bg': '#f5ddb8',
  nonattend: '#f3b4b4',
}

let fails = 0
const fail = (msg) => {
  fails++
  console.log(`  NG  ${msg}`)
}

console.log('== 1. OKLCH 導出 → hex ==')
const derived = {}
for (const [k, v] of Object.entries(SPEC)) {
  derived[k] = oklchToHex(...v)
  const o = hexToOklch(derived[k])
  const pinned = PINNED[k]
  const mark = pinned === undefined ? '    ' : pinned === derived[k] ? 'OK  ' : 'NG  '
  if (pinned !== undefined && pinned !== derived[k]) fails++
  console.log(`  ${mark}${k.padEnd(14)} ${derived[k]}  L ${o.L.toFixed(3)} C ${o.C.toFixed(3)} h ${o.h.toFixed(0).padStart(3)}${pinned && pinned !== derived[k] ? `  (spec は ${pinned})` : ''}`)
}
const T = { ...PINNED, 'ink-on-brand': PINNED.surface, 'info-fg': PINNED['neutral-fg'] }

console.log('\n== 2. 明度ラダー ==')
const L = (k) => hexToOklch(T[k]).L
const ladder = [
  ['surface → canvas', L('surface') - L('canvas'), 0.07],
  ['canvas → surface-alt', L('canvas') - L('surface-alt'), 0.035],
]
for (const [name, d, min] of ladder) {
  const ok = d >= min
  if (!ok) fails++
  console.log(`  ${ok ? 'OK ' : 'NG '} ΔL ${name.padEnd(22)} ${d.toFixed(3)} (下限 ${min})`)
}
for (const k of ['brand-bg', 'accent-bg', 'warn-bg', 'neutral-bg', 'info-bg']) {
  console.log(`      ΔL ${k.padEnd(11)} vs surface ${(L('surface') - L(k)).toFixed(3)} / vs canvas ${Math.abs(L('canvas') - L(k)).toFixed(3)}`)
}

console.log('\n== 3. コントラスト（本文 4.5:1） ==')
const TEXT = [
  ['ink', 'surface'], ['ink', 'canvas'], ['ink', 'surface-alt'],
  ['ink-2', 'surface'], ['ink-2', 'canvas'], ['ink-2', 'surface-alt'],
  ['ink-meta', 'surface'], ['ink-meta', 'canvas'], ['ink-meta', 'surface-alt'],
  ['brand-fg', 'brand-bg'], ['accent-fg', 'accent-bg'], ['warn-fg', 'warn-bg'],
  ['neutral-fg', 'neutral-bg'], ['info-fg', 'info-bg'],
  ['ink-on-brand', 'brand'], ['ink-on-brand', 'brand-hover'],
  ['brand', 'surface'], ['brand', 'canvas'], ['accent', 'surface'], ['accent', 'canvas'],
]
for (const [f, b] of TEXT) {
  const c = contrast(T[f], T[b])
  if (c >= 4.5) console.log(`  OK  ${(f + ' on ' + b).padEnd(28)} ${c.toFixed(2)}`)
  else fail(`${f} on ${b} ${c.toFixed(2)}`)
}
console.log('\n== 4. コントラスト（非テキスト 3:1） ==')
for (const [f, b] of [['warn', 'surface'], ['brand', 'brand-bg']]) {
  const c = contrast(T[f], T[b])
  if (c >= 3) console.log(`  OK  ${(f + ' on ' + b).padEnd(28)} ${c.toFixed(2)}`)
  else fail(`${f} on ${b} ${c.toFixed(2)}`)
}

console.log('\n== 5. 参考値（合否なし） ==')
const ref = (label, a, b) => console.log(`      ${label.padEnd(36)} ${contrast(a, b).toFixed(2)}`)
ref('ink-muted on surface（装飾専用）', T['ink-muted'], T.surface)
ref('border on surface', T.border, T.surface)
ref('border-strong on canvas', T['border-strong'], T.canvas)
ref('nonattend vs brand（出欠バー）', T.nonattend, T.brand)
ref('nonattend on surface-alt（バーの溝）', T.nonattend, T['surface-alt'])
ref('white つまみ on neutral-bg（トグル）', '#ffffff', T['neutral-bg'])
ref('white 紙面 on canvas（文書プレビュー）', '#ffffff', T.canvas)
ref('LINE Flex: white on brand', '#ffffff', T.brand)
const pillChroma = (k) => hexToOklch(T[k]).C.toFixed(3)
console.log(`      brand-bg と neutral-bg は色相がほぼ同じ → 彩度で弁別: ${pillChroma('brand-bg')} vs ${pillChroma('neutral-bg')}`)

console.log('\n== 6. 統計の級トーン（白カード上） ==')
const ramp = [T.brand, derived['grade-B'], derived['grade-C'], derived['grade-D'], derived['grade-E']]
ramp.forEach((hex, i) => {
  const g = 'ABCDE'[i]
  const prev = i > 0 ? `  隣接比 ${contrast(hex, ramp[i - 1]).toFixed(2)}` : ''
  console.log(`      ${g} ${hex}  L ${hexToOklch(hex).L.toFixed(3)}  vs white ${contrast(hex, '#ffffff').toFixed(2)}${prev}`)
})
for (let i = 1; i < ramp.length; i++) {
  if (hexToOklch(ramp[i]).L <= hexToOklch(ramp[i - 1]).L) fail(`級トーンの明度が単調増加でない: ${'ABCDE'[i]}`)
}

console.log('\n== 7. 影の基色 ==')
const sh = derived['shadow-base']
const n = (i) => parseInt(sh.slice(i, i + 2), 16)
console.log(`      ${sh} = rgba(${n(1)}, ${n(3)}, ${n(5)}, α)`)

console.log(`\nFAILS: ${fails}`)
process.exit(fails ? 1 : 0)
