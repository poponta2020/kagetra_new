/* Dashboard — timeline with name chips.
   Per user:
   - Timeline layout (V2 base)
   - Participants as name chips showing surnames (NOT avatars)
   - No 未回答 count, no 未回答 badge
   - Show 参加 badge when user is attending
   - Relabel "会内締切" → "締切"
   - No 公認/非公認
   - No venue (loc)
   - No time
*/

const Dashboard = () => {
  const upcoming = EVENTS.filter(e => e.status === 'published')
    .sort((a,b) => a.date.localeCompare(b.date));

  return (
    <MobileFrame activeNav="home">
      <div style={{ padding: '14px 14px 24px', overflowY: 'auto', height: '100%' }}>
        <div style={{ fontFamily: 'var(--font-display, inherit)', fontSize: 18, fontWeight: 700, marginBottom: 2 }}>今後の予定</div>
        <div style={{ fontSize: 12, color: C.fg3, marginBottom: 16 }}>{upcoming.length}件のイベント</div>

        <div style={{ position: 'relative', paddingLeft: 58 }}>
          {/* vertical line */}
          <div style={{ position: 'absolute', left: 40, top: 8, bottom: 8, width: 2, background: C.borderSoft }} />
          {upcoming.map((ev) => {
            const [m, d] = ev.date.slice(5).split('-');
            return (
              <div key={ev.id} style={{ marginBottom: 14, position: 'relative' }}>
                {/* date chip */}
                <div style={{
                  position: 'absolute', left: -58, top: 0, width: 44,
                  textAlign: 'center',
                }}>
                  <div style={{
                    background: C.surface,
                    border: `1px solid ${C.border}`,
                    borderRadius: 8, padding: '4px 0',
                  }}>
                    <div style={{ fontSize: 10, color: C.fg3, lineHeight: 1 }}>{parseInt(m)}月</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: C.fg, lineHeight: 1.2 }}>{parseInt(d)}</div>
                  </div>
                </div>
                {/* dot */}
                <div style={{
                  position: 'absolute', left: -20, top: 14, width: 10, height: 10, borderRadius: 9999,
                  background: ev.myResponse === 'attend' ? C.brand : C.surface,
                  border: `2px solid ${ev.myResponse === 'attend' ? C.brand : C.border}`,
                }} />
                <Card pad={12}>
                  {/* title + optional 参加 badge */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                    <div style={{ fontFamily: 'var(--font-display, inherit)', fontSize: 14, fontWeight: 600, flex: 1, lineHeight: 1.35 }}>{ev.title}</div>
                    {ev.myResponse === 'attend' && <Pill tone="success" size="sm">参加</Pill>}
                  </div>

                  {/* deadline */}
                  {ev.deadline && (
                    <div style={{ fontSize: 11, color: C.fg3, marginBottom: 8 }}>
                      締切 {ev.deadline.slice(5).replace('-', '/')}
                    </div>
                  )}

                  {/* participant name chips — surnames only, all shown */}
                  {ev.attendIds.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {[...ev.attendIds]
                        .sort((a, b) => {
                          const ga = memberById(a).grade;
                          const gb = memberById(b).grade;
                          return ga.localeCompare(gb);
                        })
                        .map(id => {
                        const mem = memberById(id);
                        const surname = mem.name.split(' ')[0];
                        return (
                          <div key={id} style={{
                            fontSize: 11, padding: '2px 8px', borderRadius: 9999,
                            background: C.neutralBg, color: C.neutralFg, fontWeight: 500,
                          }}>{surname}</div>
                        );
                      })}
                    </div>
                  )}
                  {ev.attendIds.length === 0 && (
                    <div style={{ fontSize: 11, color: C.fgMute }}>まだ参加表明なし</div>
                  )}
                </Card>
              </div>
            );
          })}
        </div>
      </div>
    </MobileFrame>
  );
};

Object.assign(window, { Dashboard });
