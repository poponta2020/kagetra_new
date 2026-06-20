---
name: no-scope-creep
description: 依頼の核を超えてスコープを膨らませない。周辺の「あった方が良い整備」に逸れない
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 85f6ce81-70fc-4ccb-8988-ba69aa23a261
---

ユーザーの依頼の**核**に集中し、周辺の整備へ勝手に広げない。

**Why**: 2026-06-21 の会話で2回実害。①検証ハーネスを scripts へ移植＋.gitignore 整備＋Google Drive 同期の議論に逸れた、②本番DB閲覧環境（DBeaver+SSHトンネル+read-onlyユーザー）の構築手順に逸れた。どちらもユーザーに「それは今回私が依頼したものではない」と明示的に切られた。実際の依頼は「parser のバグ修正」「Excel を DB 投入」だった。

**How to apply**: 依頼を一文で言い直し、それに直接効く作業だけ進める。「ついでに整備」「将来のために」と感じたら、着手前に一言で要否を確認するか、記録だけして本筋に戻る。便利で正しそうな周辺作業ほど本筋から離れやすい。[[project_dev_rules]] のスコープ管理（Phase外要望は記録、混ぜない）と同趣旨。
