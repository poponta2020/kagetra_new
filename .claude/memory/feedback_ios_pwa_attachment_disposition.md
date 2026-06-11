---
name: feedback-ios-pwa-attachment-disposition
description: iOS standalone PWA は Content-Disposition attachment を白画面死させる。inline 許可は fail-closed allowlist でのみ広げる
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 8960db3b-571a-484e-b095-af4e6a2d3b00
---

iOS ホーム画面 PWA (standalone) の in-app ブラウザ（`target="_blank"` で開くオーバーレイ）は `Content-Disposition: attachment` をダウンロードマネージャに渡せず、**白い画面が開いてすぐ閉じる/無反応**で死ぬ（WebKit 既知挙動）。PC では正常ダウンロードできるため気づきにくい。

**Why:** PR #139 (Issue #138, 2026-06-11) で実害。admin 添付 route が PDF のみ inline / 他は attachment+octet-stream だったため、多摩大会の .doc 添付が PWA で開けなかった。PDF だけ開けるので発覚が遅れた。

**How to apply:**
- 管理画面向けのファイル配信 route は、inert なプレビュー型（PDF / Office 文書 doc/docx/xls/xlsx/ppt/pptx / ラスタ画像 / text/plain・csv）を**実 MIME + `inline`** で返し、iOS QuickLook にプレビューさせる
- ただし inline 許可は **fail-closed allowlist** でのみ広げること。送信者制御の Content-Type に blocklist（危険型だけ除外）で inline を許すのは、未列挙 active content（`*+xml`、ecmascript 系等）を網羅できず fail-open になる（Codex が PR #139 R1/R2 で 2 段階指摘）
- 応答 Content-Type を「allowlist 定数 or octet-stream」に限定すれば stored 値をエコーしないのでヘッダ注入も構造的に不可能になり、MIME 文字列検証も不要
- 非認証の公開 route（[[impl_event_line_broadcast_task1]] の token route）は別物: XSS 完全遮断のため全型 attachment 固定を維持（PR #70 の決定）

関連: [[feedback-attachment-mime-blocklist]] [[impl-fix-mail-attachment-pwa-inline]]
