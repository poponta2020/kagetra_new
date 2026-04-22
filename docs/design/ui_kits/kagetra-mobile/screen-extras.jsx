/* Extra screens — one per artboard.
   Login / Member list / Member detail / RSVP modal / Event form / Admin tally */

// ============================================================
// Login (LINE OAuth style, matches kagetra_new code)
// ============================================================
const LoginScreen = () => (
  <MobileFrame showTopBar={false} showNav={false}>
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '0 32px', background: C.surface,
    }}>
      <div style={{ fontFamily: 'var(--font-display, inherit)', fontSize: 28, fontWeight: 700, color: C.brand, marginBottom: 6, letterSpacing: '0.04em' }}>かげとら</div>
      <div style={{ fontSize: 13, color: C.fg3, marginBottom: 40 }}>会員管理システム</div>

      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 11, color: C.fg3, marginBottom: 4 }}>メールアドレス</div>
        <input style={{
          padding: '10px 12px', border: `1px solid ${C.border}`, borderRadius: 8,
          fontSize: 14, fontFamily: 'inherit', outline: 'none', marginBottom: 8,
        }} placeholder="yamada@example.com" />
        <div style={{ fontSize: 11, color: C.fg3, marginBottom: 4 }}>パスワード</div>
        <input type="password" style={{
          padding: '10px 12px', border: `1px solid ${C.border}`, borderRadius: 8,
          fontSize: 14, fontFamily: 'inherit', outline: 'none', marginBottom: 16,
        }} placeholder="••••••••" />
        <Btn kind="primary" size="lg" block>ログイン</Btn>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0',
          color: C.fg3, fontSize: 11,
        }}>
          <div style={{ flex: 1, height: 1, background: C.borderSoft }} />
          または
          <div style={{ flex: 1, height: 1, background: C.borderSoft }} />
        </div>
        <Btn kind="secondary" size="lg" block style={{ background: '#06C755', color: '#fff', borderColor: 'transparent' }}>
          LINEでログイン
        </Btn>
        <div style={{ fontSize: 11, color: C.brand, textAlign: 'center', marginTop: 16 }}>パスワードを忘れた方</div>
      </div>
    </div>
  </MobileFrame>
);

// ============================================================
// Member list (会員一覧)
// ============================================================
const MemberList = () => (
  <MobileFrame activeNav="members" title="会員">
    <div style={{ overflowY: 'auto', height: '100%', background: C.surface }}>
      <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.borderSoft}` }}>
        <div style={{
          background: C.neutralBg, borderRadius: 8, padding: '8px 12px',
          fontSize: 13, color: C.fgMute,
        }}>🔍 名前・ふりがなで検索</div>
        <div style={{ display: 'flex', gap: 6, marginTop: 10, overflowX: 'auto' }}>
          {['すべて','A級','B級','C級','D級','E級'].map((l,i) => (
            <div key={l} style={{
              padding: '4px 10px', borderRadius: 9999, fontSize: 11, fontWeight: 500,
              background: i === 0 ? C.brand : C.surface,
              color: i === 0 ? '#fff' : C.fg2,
              border: `1px solid ${i === 0 ? C.brand : C.border}`,
              whiteSpace: 'nowrap',
            }}>{l}</div>
          ))}
        </div>
      </div>
      {/* grouped by kana — simplified, just show "あ行" */}
      <div style={{
        padding: '6px 14px', background: C.surfaceAlt,
        fontSize: 11, fontWeight: 600, color: C.fg3,
        borderBottom: `1px solid ${C.borderSoft}`,
      }}>あ行</div>
      {MEMBERS.slice(6, 7).map(m => (
        <MemberRow key={m.id} m={m} />
      ))}
      <div style={{
        padding: '6px 14px', background: C.surfaceAlt,
        fontSize: 11, fontWeight: 600, color: C.fg3,
        borderBottom: `1px solid ${C.borderSoft}`,
      }}>か行</div>
      {MEMBERS.filter(m => ['か','き','く','け','こ'].includes(m.yomi[0])).map(m => (
        <MemberRow key={m.id} m={m} />
      ))}
      <div style={{
        padding: '6px 14px', background: C.surfaceAlt,
        fontSize: 11, fontWeight: 600, color: C.fg3,
        borderBottom: `1px solid ${C.borderSoft}`,
      }}>さ行</div>
      {MEMBERS.filter(m => ['さ','し','す','せ','そ'].includes(m.yomi[0])).map(m => (
        <MemberRow key={m.id} m={m} />
      ))}
    </div>
  </MobileFrame>
);

const MemberRow = ({ m }) => (
  <div style={{
    padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12,
    borderBottom: `1px solid ${C.borderSoft}`,
  }}>
    <Avatar member={m} size={36} />
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 14, fontWeight: 500 }}>{m.name}</div>
      <div style={{ fontSize: 10, color: C.fg3 }}>{m.yomi}</div>
    </div>
    <GradePill grade={m.grade} />
    <div style={{ fontSize: 16, color: C.fgMute }}>›</div>
  </div>
);

// ============================================================
// Member detail
// ============================================================
const MemberDetail = () => {
  const m = MEMBERS[0];
  const myEvents = EVENTS.filter(e => e.attendIds.includes(m.id));
  return (
    <MobileFrame showTopBar={false} activeNav="members">
      <AppBar title="会員詳細" action={<div style={{ fontSize: 13, color: C.brand, fontWeight: 500 }}>編集</div>} />
      <div style={{ overflowY: 'auto', height: 'calc(100% - 44px)' }}>
        {/* hero */}
        <div style={{ padding: '20px 16px', textAlign: 'center', background: C.surface, borderBottom: `1px solid ${C.borderSoft}` }}>
          <div style={{ display: 'inline-block', marginBottom: 10 }}>
            <Avatar member={m} size={72} />
          </div>
          <div style={{ fontFamily: 'var(--font-display, inherit)', fontSize: 18, fontWeight: 700 }}>{m.name}</div>
          <div style={{ fontSize: 12, color: C.fg3, marginTop: 2 }}>{m.yomi}</div>
          <div style={{ marginTop: 10, display: 'inline-flex', gap: 6 }}>
            <GradePill grade={m.grade} />
            <Pill tone="neutral" size="sm">会員</Pill>
          </div>
        </div>

        <div style={{ padding: '14px 16px', background: C.surface, borderBottom: `1px solid ${C.borderSoft}` }}>
          <SectionLabel>基本情報</SectionLabel>
          <DescList items={[
            ['会員番号', 'K-0001'],
            ['年齢', `${m.age}歳`],
            ['所属級', `${m.grade}級`],
            ['入会日', '2018年4月1日'],
            ['連絡先', 'yamada@example.com'],
            ['電話', '090-1234-5678'],
          ]}/>
        </div>

        <div style={{ padding: '14px 16px', background: C.surface }}>
          <SectionLabel action={`${myEvents.length}件 →`}>参加予定のイベント</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {myEvents.map(ev => (
              <div key={ev.id} style={{
                border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px',
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <div style={{ width: 40, textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: C.fg3 }}>{parseInt(ev.date.slice(5,7))}月</div>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>{parseInt(ev.date.slice(8))}</div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ev.title}</div>
                  <div style={{ fontSize: 10, color: C.fg3 }}>{ev.loc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </MobileFrame>
  );
};

// ============================================================
// RSVP modal (sheet) — opens on tap
// ============================================================
const RsvpModal = () => {
  const ev = EVENTS[0];
  return (
    <MobileFrame showTopBar={false} showNav={false}>
      {/* backdrop */}
      <div style={{
        position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)',
      }} />
      {/* dimmed content under */}
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        background: C.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16,
        padding: '6px 16px 20px',
        boxShadow: '0 -8px 24px rgba(0,0,0,0.1)',
      }}>
        {/* grabber */}
        <div style={{ width: 36, height: 4, background: C.border, borderRadius: 9999, margin: '0 auto 14px' }} />
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>{ev.title}</div>
        <div style={{ fontSize: 12, color: C.fg3, marginBottom: 18 }}>{ev.dateLabel} · {ev.loc}</div>

        <div style={{ fontSize: 12, fontWeight: 600, color: C.fg3, marginBottom: 8 }}>出欠を選択</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
          {[
            { k: 'attend', l: '参加する', fg: C.successFg, bg: C.successBg, active: true },
            { k: 'absent', l: '参加しない', fg: C.dangerFg, bg: C.dangerBg },
            { k: 'maybe',  l: '未定', fg: C.fg2, bg: C.neutralBg },
          ].map(o => (
            <div key={o.k} style={{
              padding: '12px 14px', borderRadius: 8,
              border: `1.5px solid ${o.active ? o.fg : C.border}`,
              background: o.active ? o.bg : C.surface,
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <div style={{
                width: 18, height: 18, borderRadius: 9999,
                border: `2px solid ${o.active ? o.fg : C.border}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {o.active && <div style={{ width: 8, height: 8, borderRadius: 9999, background: o.fg }} />}
              </div>
              <div style={{ fontSize: 14, fontWeight: 500, color: o.active ? o.fg : C.fg }}>{o.l}</div>
            </div>
          ))}
        </div>

        <div style={{ fontSize: 12, fontWeight: 600, color: C.fg3, marginBottom: 8 }}>コメント (任意)</div>
        <textarea style={{
          width: '100%', padding: '10px 12px', border: `1px solid ${C.border}`, borderRadius: 8,
          fontSize: 13, fontFamily: 'inherit', outline: 'none', resize: 'none', height: 60,
          boxSizing: 'border-box', marginBottom: 14,
        }} placeholder="例: 少し遅れます" />

        <div style={{ display: 'flex', gap: 8 }}>
          <Btn kind="secondary" size="md" block>キャンセル</Btn>
          <Btn kind="primary" size="md" block>回答する</Btn>
        </div>
      </div>
    </MobileFrame>
  );
};

// ============================================================
// Event create/edit form
// ============================================================
const EventForm = () => (
  <MobileFrame showTopBar={false}>
    <AppBar title="イベント作成" action={<div style={{ fontSize: 13, color: C.brand, fontWeight: 600 }}>保存</div>} />
    <div style={{ overflowY: 'auto', height: 'calc(100% - 44px - 52px)', background: C.bg }}>
      <Field label="タイトル" value="第55回北海道選手権大会" />
      <Field label="開催日" value="2025-10-05" />
      <Field label="開始時刻" value="09:00" inline right={<Field inline noWrap label="終了" value="17:00" />} />
      <Field label="会場" value="札幌市教育文化会館" />

      <div style={{ background: C.surface, padding: '12px 16px', borderBottom: `1px solid ${C.borderSoft}` }}>
        <div style={{ fontSize: 11, color: C.fg3, marginBottom: 6 }}>公認/非公認</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {['公認','非公認'].map((l,i) => (
            <div key={l} style={{
              flex: 1, padding: '8px 0', textAlign: 'center', borderRadius: 8,
              border: `1px solid ${i === 0 ? C.brand : C.border}`,
              background: i === 0 ? C.brandBg : C.surface,
              color: i === 0 ? C.brandFg : C.fg2,
              fontSize: 13, fontWeight: 500,
            }}>{l}</div>
          ))}
        </div>
      </div>

      <div style={{ background: C.surface, padding: '12px 16px', borderBottom: `1px solid ${C.borderSoft}` }}>
        <div style={{ fontSize: 11, color: C.fg3, marginBottom: 6 }}>対象級</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {['A','B','C','D','E'].map((g) => (
            <div key={g} style={{
              padding: '6px 14px', borderRadius: 9999, fontSize: 12,
              border: `1px solid ${['A','B','C'].includes(g) ? C.brand : C.border}`,
              background: ['A','B','C'].includes(g) ? C.brandBg : C.surface,
              color: ['A','B','C'].includes(g) ? C.brandFg : C.fg3,
              fontWeight: 600, fontFamily: 'ui-monospace,monospace',
            }}>{g}級</div>
          ))}
        </div>
      </div>

      <Field label="定員" value="64 名" />
      <Field label="会内締切" value="2025-09-28" />
      <Field label="大会申込締切" value="2025-09-20" />

      <div style={{ background: C.surface, padding: '12px 16px', borderBottom: `1px solid ${C.borderSoft}` }}>
        <div style={{ fontSize: 11, color: C.fg3, marginBottom: 6 }}>連絡事項</div>
        <textarea style={{
          width: '100%', padding: '10px 12px', border: `1px solid ${C.border}`, borderRadius: 8,
          fontSize: 13, fontFamily: 'inherit', outline: 'none', resize: 'none', height: 80,
          boxSizing: 'border-box',
        }} defaultValue="今年度の北海道選手権大会です。各級ごとにトーナメント形式で実施します。" />
      </div>

      <div style={{ padding: '14px 16px' }}>
        <Btn kind="secondary" size="md" block>下書きとして保存</Btn>
      </div>
    </div>
  </MobileFrame>
);

const Field = ({ label, value, inline = false, right, noWrap = false }) => {
  if (inline) {
    return (
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 11, color: C.fg3, marginBottom: 6 }}>{label}</div>
        <div style={{
          padding: '10px 12px', border: `1px solid ${C.border}`, borderRadius: 8,
          fontSize: 13, background: C.surface,
        }}>{value}</div>
      </div>
    );
  }
  if (right) {
    return (
      <div style={{ background: C.surface, padding: '12px 16px', borderBottom: `1px solid ${C.borderSoft}`, display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: C.fg3, marginBottom: 6 }}>{label}</div>
          <div style={{
            padding: '10px 12px', border: `1px solid ${C.border}`, borderRadius: 8,
            fontSize: 13, background: C.surface,
          }}>{value}</div>
        </div>
        {right}
      </div>
    );
  }
  return (
    <div style={{ background: C.surface, padding: '12px 16px', borderBottom: `1px solid ${C.borderSoft}` }}>
      <div style={{ fontSize: 11, color: C.fg3, marginBottom: 6 }}>{label}</div>
      <div style={{
        padding: '10px 12px', border: `1px solid ${C.border}`, borderRadius: 8,
        fontSize: 13, background: C.surface,
      }}>{value}</div>
    </div>
  );
};

// ============================================================
// Admin tally — 出欠集計画面
// ============================================================
const AdminTally = () => {
  const ev = EVENTS[0];
  const byGrade = {};
  MEMBERS.forEach(m => {
    byGrade[m.grade] ??= { attend: 0, absent: 0, unans: 0 };
    if (ev.attendIds.includes(m.id)) byGrade[m.grade].attend++;
    else if (ev.absentIds.includes(m.id)) byGrade[m.grade].absent++;
    else byGrade[m.grade].unans++;
  });

  return (
    <MobileFrame showTopBar={false} activeNav="events">
      <AppBar title="出欠集計" action={<div style={{ fontSize: 13, color: C.brand, fontWeight: 500 }}>書出</div>} />
      <div style={{ overflowY: 'auto', height: 'calc(100% - 44px - 52px)' }}>
        <div style={{ padding: '14px 16px', background: C.surface, borderBottom: `1px solid ${C.borderSoft}` }}>
          <div style={{ fontSize: 11, color: C.fg3, marginBottom: 2 }}>{ev.dateLabel} · {ev.loc}</div>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>{ev.title}</div>
          <Card pad={12} style={{ background: C.surfaceAlt, border: 'none' }}>
            <AttendanceCounts ev={ev} variant="bar" />
          </Card>
        </div>

        <div style={{ padding: '14px 16px' }}>
          <SectionLabel>級別集計</SectionLabel>
          <Card pad={0}>
            {/* header row */}
            <div style={{
              display: 'grid', gridTemplateColumns: '60px 1fr 1fr 1fr',
              padding: '10px 14px', background: C.surfaceAlt,
              borderBottom: `1px solid ${C.borderSoft}`,
              fontSize: 10, fontWeight: 600, color: C.fg3,
              borderTopLeftRadius: 10, borderTopRightRadius: 10,
            }}>
              <div>級</div>
              <div style={{ textAlign: 'right' }}>参加</div>
              <div style={{ textAlign: 'right' }}>不参加</div>
              <div style={{ textAlign: 'right' }}>未回答</div>
            </div>
            {Object.entries(byGrade).map(([g, v], i) => (
              <div key={g} style={{
                display: 'grid', gridTemplateColumns: '60px 1fr 1fr 1fr',
                padding: '12px 14px',
                borderTop: i === 0 ? 'none' : `1px solid ${C.borderSoft}`,
                fontSize: 13, alignItems: 'center',
              }}>
                <div><GradePill grade={g} /></div>
                <div style={{ textAlign: 'right', fontWeight: 600, color: v.attend > 0 ? C.successFg : C.fgMute }}>{v.attend}</div>
                <div style={{ textAlign: 'right', color: v.absent > 0 ? C.dangerFg : C.fgMute }}>{v.absent}</div>
                <div style={{ textAlign: 'right', color: v.unans > 0 ? C.warnFg : C.fgMute, fontWeight: v.unans > 0 ? 600 : 400 }}>{v.unans}</div>
              </div>
            ))}
          </Card>
        </div>

        <div style={{ padding: '0 16px 16px' }}>
          <SectionLabel action="リマインド送信 →">未回答者 ({ev.unansweredCount}名)</SectionLabel>
          <Card pad={0}>
            {MEMBERS.filter(m => !ev.attendIds.includes(m.id) && !ev.absentIds.includes(m.id)).slice(0, 5).map((m, i) => (
              <div key={m.id} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 14px',
                borderTop: i === 0 ? 'none' : `1px solid ${C.borderSoft}`,
              }}>
                <Avatar member={m} size={28} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{m.name}</div>
                  <div style={{ fontSize: 10, color: C.fg3 }}>{m.grade}級</div>
                </div>
                <div style={{ fontSize: 11, color: C.brand, fontWeight: 500 }}>通知</div>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </MobileFrame>
  );
};

Object.assign(window, { LoginScreen, MemberList, MemberDetail, RsvpModal, EventForm, AdminTally });
