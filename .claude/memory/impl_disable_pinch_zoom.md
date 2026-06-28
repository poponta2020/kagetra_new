---
name: impl_disable_pinch_zoom
description: "モバイルのピンチズーム＋入力フォーカス時iOS自動ズームを viewport で抑制(PR#192)。非自明=Next.jsはdefault viewportをフィールド単位merge/15px baseのフォーカスズームもmaximum-scale=1で止まる/Codexのaccessibility指摘をoverride ship"
metadata: 
  node_type: memory
  type: project
  originSessionId: 14bc8e4c-e32f-4c7c-914d-bd3c29d97ecd
---

PR #192 merge `3c0ee83`(2026-06-29)。`apps/web/src/app/layout.tsx` の `viewport` export に `maximumScale: 1` + `userScalable: false` を追加し、全ルートのピンチズーム＋テキスト入力(input/textarea/select)フォーカス時の iOS 自動ズームを抑制。姉妹アプリ match-tracker(`maximum-scale=1.0`)同等。quickfix・1ファイル7行・新規migrationなし。

非自明:
- **Next.js は default viewport(`width=device-width, initial-scale=1`)をフィールド単位で merge** する(`next/dist/lib/metadata/default-metadata.js` の `createDefaultViewport` ＋ `resolve-metadata.js` の `mergeViewport` が source に書いたキーだけ上書き)。よって自前 export に width/initialScale を書かなくても出力meta には含まれる＝`maximumScale` 追加**だけ**で match-tracker と等価。handover の「現状 width/initialScale がある」は実ファイル未記載だが結論は同じ。
- **ベース font-size が 15px**(`--kg-text-base: 0.9375rem`, <16px in globals.css)のため iOS は入力フォーカス時に自動ズームするが、`maximum-scale=1` でズーム上限1x＝この自動ズームも no-op。**同じ1変更でピンチ＋入力フォーカスズームの両症状をカバー**。font-size:16px の CSS ガード案は設計の 15px タイプスケールを壊し match-tracker とも非等価になるため**不採用**。`userScalable:false` は iOS Safari では無視されるが Android Chrome 側の補強。
- `viewportFit:'cover'` は safe-area 用に維持([[project_sticky_mobile_shell]] の MobileShell BottomNav が依存)。
- **Codex auto-review は needs_changes**（「ズーム禁止=アクセシビリティ退行」、コード欠陥0・既に handover で受容済みのプロダクト判断への異議のみ）→ ユーザー判断で **override し ship**。PC の Ctrl+ホイール等ページズームは viewport 管轄外で対象外。
- 残 DoD=iPhone 実機目視(ピンチ不可＋テキスト入力フォーカスでズームしない＋既存レイアウト崩れなし)。本番 auto-deploy 対象。
