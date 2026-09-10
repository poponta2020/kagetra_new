---
name: feature-def-annual-registration-renewal
description: annual-registration-renewal（年度確認）要件定義
type: project
---

**annual-registration-renewal（年度確認）要件定義（2026-09-09 承認・design locked・技術計画・Issue 作成まで完了）**。正典= docs/features/annual-registration-renewal/{requirements.md, design-spec.md(locked), implementation-plan.md, design-mock/}。親 Issue #619、子 #620〜#630（T1〜T11、5 Wave＋別リポジトリ 1 レーン）。

**機能の骨子**: 3 月に全日協から届く「会員名簿（確認用・3/1 現在）」を基に管理者が退会届・変更届を紙で作る年度更新を、①管理者が年度確認を開始（年度・締切・一言。対象者＝zen_nichikyo ON ∧ 未退会 ∧ 非ゲスト、開始時に固定＋スナップショット JSONB）②会員が /renewal で「登録する／登録しない」＋名簿の列の行内修正（users へ一括保存・name は再合成しない）＋「4月からの学年」（絶対値で保存・4/1 以降に反映、最終学年は進学／卒業／留年）③管理者ボード（N/M 確認済み・4 タブ・正会員／准会員ごとの名簿の写し・前→後の差分・代理回答）④登録完了で「登録しない」の全日協フラグ OFF（5 月頃）、に置き換える。会員区分は定款第 6 条（3/31 時点で 20 歳）から導出、公認資格（読手 B/A・準公認審判員）を users に追加。

**LINE**: Messaging API push（人数分課金）ではなく match-tracker の line-chat-worker（OAM チャット予約送信・Playwright・同一 VM）を複数アプリ対応（APPS_JSON）にして共用。kagetra は /api/line-chat-worker/{tasks,[id]/result,session-warning} を X-Service-Token で提供（WorkerTask 互換・固有項目なし・mentions を後方互換で追加）。案内は開始時、リマインドは 19:30 バッチ→20:00 予約（3 日おき＋締切前日・当日・マージン 5 分・10 分刻みで分割）。未回答者は OAM の @候補選択でメンション（ユーザーが手動で可能なことを確認済み・PoC ゲート AC-31・不一致はテキスト列挙）。Bot はプールから 1 体を purpose='club_chat' へ CAS 転換、join webhook で webhook 側グループ ID を捕捉（表示名取得用）。

**設計判断（deep-advisor 相談済み）**: JSONB スナップショット（型付き・zod・キー固定）／line_chat_tasks は (renewal,kind,target_date,split_index) の部分 UNIQUE（CANCELLED 除外）＋日単位の冪等＋再試行は同一行／新規 timer 2 本（19:30 リマインド・00:05 学年反映）で lifecycle に相乗りしない／renewal_members.user_id は CASCADE（deleteMember を塞がない）／status='system' は流用しない／match-tracker の 30 分マージンを写さない（写すと 19:30→20:00 設計が全滅）／ログイン後の S1 戻りは既存フローで不可＝案内文で代替。

**AC**: 34 件（auto-test 30 / verify 1 / manual 3）。特徴: AC-16b 分割・AC-16c 表示名解決失敗のフォールバック・AC-31 PoC ゲート・AC-22 ワーカー契約互換。

**Wave**: W1=T1(main スキーマ 0066) → W2=T2 純ロジック・T3 S3+webhook・T4 タスク store+API・T7 S5 → W3=T5 store+Actions(main) → W4=T6 S1+S4・T8 バッチ+systemd・T9 S2 → W5=T10 docs(main)。T11 match-tracker は別レーン（main 手動・kagetra 出荷をブロックしない）。

**未消化**: Claude Design push（DesignSync 認可なし・remote_pushed: false）・docs/全日協登録/（実提出物＝PII・gitignore 済み）・AC-30/31/32 は本番・PoC。
