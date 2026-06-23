---
name: project-attachment-storage-growth
description: メール添付が Postgres bytea に無期限蓄積する件のバックログ。対策未着手・データファーストで実測先行
metadata: 
  node_type: memory
  type: project
  originSessionId: 6e2870f8-3d28-4beb-a4af-cde92ead8d80
---

メール添付 (`mail_attachments.data` bytea) は取り込み(fetch)時に Postgres 内へ保存され、削除する本番コードが一切ない。`dismissMail`（対応不要）も `triageStatus` を processed にするだけで添付には触れない。親 `mail_messages` 行の cascade 削除以外に消える経路がなく、処理済み・noise 含め全添付が無期限に蓄積する。上限は 30MB/件（超過は行ごと非保存）のみ。

2026-06-20 ユーザーが「なんとかしたい」と表明。ただし**現状はバックログ・未スコープ・実装未着手**。方針はデータファースト：先に本番で総バイト/件数/月次増加/classification別内訳を実測し「今困る/いつか困る」を判定してから設計に進む。Oracle Cloud Always Free のブロックストレージ合計200GBで小規模会のため当面余裕の可能性大（→「当面監視のみ」結論も十分あり得る）。

対策候補（実測後に選択）：①処理済み＋一定期間経過後に bytea を null 化（最軽量／`data` を nullable 化要／LINE共有トークン・イベント紐付け済み添付は本体が要るので除外スコープ要／行・メタ・extracted_text は履歴として残す）②R2 退避（本命だが変更大、R2は [[project_production_deploy]] のバックアップで既使用）③当面は監視のみ（サイズ計測＋しきい値アラート）。関連 [[project_mail_inbox_mailer]]。
