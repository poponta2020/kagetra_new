// PWA アイコン生成スクリプト
// アイコン変更時は public/icons/icon.svg を編集してこのスクリプトを再実行し、
// 生成された PNG をコミットすること（CI では再生成しない）。
//
// 実行: pnpm --filter @kagetra/web exec tsx scripts/generate-pwa-icons.ts

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const publicDir = path.resolve(__dirname, '../public')
const sourceSvg = path.join(publicDir, 'icons/icon.svg')

async function main() {
  const svgBuffer = await readFile(sourceSvg)

  // 192x192 (any purpose)
  await sharp(svgBuffer)
    .resize(192, 192)
    .png()
    .toFile(path.join(publicDir, 'icons/icon-192.png'))

  // 512x512 (any purpose)
  await sharp(svgBuffer)
    .resize(512, 512)
    .png()
    .toFile(path.join(publicDir, 'icons/icon-512.png'))

  // 180x180 (apple-touch-icon)
  await sharp(svgBuffer)
    .resize(180, 180)
    .png()
    .toFile(path.join(publicDir, 'apple-touch-icon.png'))

  // 512x512 maskable: safe zone 80% に文字を収め、外側 20% は背景色で拡張。
  // Android アダプティブアイコンが外周をトリミングしても文字が欠けない。
  const safeZoneSize = Math.round(512 * 0.8)
  const innerPng = await sharp(svgBuffer)
    .resize(safeZoneSize, safeZoneSize)
    .png()
    .toBuffer()

  await sharp({
    create: {
      width: 512,
      height: 512,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite([{ input: innerPng, gravity: 'center' }])
    .png()
    .toFile(path.join(publicDir, 'icons/icon-maskable-512.png'))

  console.log('PWA icons generated:')
  console.log('  - public/icons/icon-192.png')
  console.log('  - public/icons/icon-512.png')
  console.log('  - public/icons/icon-maskable-512.png')
  console.log('  - public/apple-touch-icon.png')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
