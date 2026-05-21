---
name: kagetra-lightsail-route-53
description: 旧 kagetra (hokudaicarta.com) は AWS Lightsail で稼働中、DNS は Lightsail DNS ゾーン (裏で Route 53) — kagetra_new デプロイ時に発覚
metadata: 
  node_type: memory
  type: reference
  originSessionId: 64e40636-9ca5-4e46-a6e3-e34219eb9fb8
---

# 旧 kagetra インフラ構成

`hokudaicarta.com` (旧 kagetra、本番稼働中) は **AWS Lightsail** で運用されている。Lightsail には DNS ゾーン機能があり、表向きは Lightsail コンソールで管理するが、裏では **AWS Route 53** が権威ネームサーバーとして使われる。

## 確認方法と裏付け (2026-05-21 発見)

- `nslookup -type=NS hokudaicarta.com 8.8.8.8` → `ns-643.awsdns-16.net` 他 awsdns-* 4 件
- root `hokudaicarta.com` A レコード = `54.168.76.17` (Lightsail インスタンス)
- お名前.com のネームサーバー設定は AWS Lightsail / Route 53 を指している (移管はしていない)

## kagetra_new (`new.hokudaicarta.com`) DNS の追加先

- **Lightsail コンソール → Networking → DNS zones → `hokudaicarta.com`** で `new` A レコードを追加する
- Route 53 コンソールから直接追加してもよいが、Lightsail で管理しているなら Lightsail UI が正
- お名前.com Navi の「DNS 設定/転送設定」で追加しても **効力なし** (NS が awsdns を向いているため)

## doc の不整合 (要 PR fix)

`docs/deploy/dns-ssl.md` は「お名前.com Navi で A レコード追加」と書いてあるが、実態と合っていない。Lightsail DNS ゾーン用に書き換え必要。

## 並行稼働期間の注意

- 旧 kagetra (`hokudaicarta.com`) の root A レコードは **絶対に触らない** (本番稼働中)
- `new.hokudaicarta.com` は kagetra_new の Oracle Cloud インスタンス (`140.238.51.41`) に向ける
- Phase 4 完了 + データ移行完了後、ドメイン cutover (`new.` → root) を別 PR で実施予定 ([[project_production_deploy]])
