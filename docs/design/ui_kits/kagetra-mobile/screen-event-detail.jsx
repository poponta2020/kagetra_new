/* Event detail — V3 single-column scroll, no 出欠バー, RSVP: 参加 only (toggles to キャンセル) */

// Local variant — the shared AttendanceCounts (primitives.jsx) supports
// both 'cards' and 'bar'; this screen renders only the cards layout and is
// kept separate so redefining it can't overwrite the shared binding.
const EventDetailAttendanceCounts = ({ ev }) => (
  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
    {[
      { l: '参加',   n: ev.attendIds.length,  fg: C.successFg, bg: C.successBg },
      { l: '不参加', n: ev.absentIds.length,  fg: C.dangerFg,  bg: C.dangerBg  },
      { l: '未回答', n: ev.unansweredCount,    fg: C.warnFg,    bg: C.warnBg    },
    ].map((s,i) => (
      <div key={i} style={{
        background: s.bg, borderRadius: 8, padding: '10px 8px', textAlign: 'center',
      }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: s.fg, lineHeight: 1 }}>{s.n}</div>
        <div style={{ fontSize: 10, color: s.fg, marginTop: 4, opacity: 0.8 }}>{s.l}</div>
      </div>
    ))}
  </div>
);

// Single RSVP button. 未回答 → 「参加する」, attending → 「参加をキャンセル」
const RsvpBar = ({ attending, onToggle }) => (
  <div style={{
    position: 'absolute', left: 0, right: 0, bottom: 0,
    background: C.surface, borderTop: `1px solid ${C.border}`,
    padding: '10px 14px 14px',
    boxShadow: '0 -4px 12px rgba(0,0,0,0.04)',
  }}>
    <button
      onClick={onToggle}
      style={{
        width: '100%', padding: '12px 0', borderRadius: 8,
        border: attending ? `1px solid ${C.border}` : 'none',
        background: attending ? C.surface : C.brand,
        color: attending ? C.fg2 : '#fff',
        fontWeight: 600, fontSize: 15, fontFamily: 'inherit', cursor: 'pointer',
      }}>
      {attending ? '参加をキャンセル' : '参加する'}
    </button>
  </div>
);

const EventDetail = () => {
  const ev = EVENTS[0];
  const [attending, setAttending] = React.useState(false);

  return (
    <MobileFrame activeNav="events" showTopBar={false}>
      <AppBar title="" action={<div style={{ fontSize: 13, color: C.brand, fontWeight: 500 }}>編集</div>} />
      <div style={{ overflowY: 'auto', height: 'calc(100% - 44px - 68px)' }}>
        <div style={{ padding: '8px 16px 18px', background: C.surface, borderBottom: `1px solid ${C.borderSoft}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            {ev.official && <Pill tone="brand" size="sm">公認</Pill>}
            <StatusPill status={ev.status} />
            {attending && <Pill tone="success" size="sm">参加</Pill>}
          </div>
          <div style={{ fontFamily: 'var(--font-display, inherit)', fontSize: 20, fontWeight: 700, lineHeight: 1.3, marginBottom: 10 }}>{ev.title}</div>
          <div style={{
            display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 8, rowGap: 4,
            fontSize: 13, color: C.fg2,
          }}>
            <span style={{ color: C.fg3 }}>日時</span><span>{ev.dateLabel} {ev.time}</span>
            <span style={{ color: C.fg3 }}>会場</span><span>{ev.loc}</span>
            <span style={{ color: C.fg3 }}>定員</span><span>{ev.capacity}名</span>
            <span style={{ color: C.fg3 }}>対象</span>
            <span><div style={{ display: 'inline-flex', gap: 4 }}>{ev.grades.map(g => <GradePill key={g} grade={g} />)}</div></span>
            <span style={{ color: C.fg3 }}>締切</span><span style={{ color: C.warnFg, fontWeight: 500 }}>{ev.deadline.slice(5).replace('-', '/')}</span>
          </div>
        </div>

        {/* attendance summary (counts only, no bar) */}
        <div style={{ padding: '14px 16px', background: C.surface, borderBottom: `1px solid ${C.borderSoft}` }}>
          <SectionLabel>出欠状況</SectionLabel>
          <EventDetailAttendanceCounts ev={ev} />
        </div>

        {/* participants inline */}
        <div style={{ padding: '14px 16px', background: C.surface, borderBottom: `1px solid ${C.borderSoft}` }}>
          <SectionLabel action={`${ev.attendIds.length}名 →`}>参加者</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {[...ev.attendIds].sort((a, b) => memberById(a).grade.localeCompare(memberById(b).grade)).slice(0, 5).map((id, i) => {
              const mem = memberById(id);
              return (
                <div key={id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 0',
                  borderTop: i === 0 ? 'none' : `1px solid ${C.borderSoft}`,
                }}>
                  <Avatar member={mem} size={26} />
                  <div style={{ flex: 1, fontSize: 13 }}>{mem.name}</div>
                  <GradePill grade={mem.grade} />
                </div>
              );
            })}
          </div>
        </div>

        {/* description */}
        <div style={{ padding: '14px 16px', background: C.surface, borderBottom: `1px solid ${C.borderSoft}` }}>
          <SectionLabel>連絡事項</SectionLabel>
          <div style={{ fontSize: 12, color: C.fg2, lineHeight: 1.7 }}>{ev.description}</div>
        </div>

        {/* attachments */}
        <div style={{ padding: '14px 16px', background: C.surface }}>
          <SectionLabel>添付ファイル</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {['開催要項.pdf'].map(f => (
              <div key={f} style={{
                border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px',
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <div style={{ width: 28, height: 28, borderRadius: 6, background: C.dangerBg, color: C.dangerFg,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700 }}>PDF</div>
                <div style={{ flex: 1, fontSize: 13 }}>{f}</div>
                <div style={{ fontSize: 11, color: C.fg3 }}>1.2MB</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <RsvpBar attending={attending} onToggle={() => setAttending(a => !a)} />
    </MobileFrame>
  );
};

Object.assign(window, { EventDetail });
