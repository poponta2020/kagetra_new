/* Shared UI primitives for Kagetra mobile screens.
   All sizes in px — don't use rem (keeps scaling predictable inside DC artboards).
   Palette reads from CSS vars in palette-a.css. */

const C = {
  brand: 'var(--brand)',
  brandBg: 'var(--brand-bg)',
  brandFg: 'var(--brand-fg)',
  bg: 'var(--bg)',
  surface: 'var(--surface)',
  surfaceAlt: 'var(--surface-alt)',
  border: 'var(--border)',
  borderSoft: 'var(--border-soft)',
  fg: 'var(--fg)',
  fg2: 'var(--fg2)',
  fg3: 'var(--fg3)',
  fgMute: 'var(--fg-mute)',
  successFg: 'var(--success-fg)',
  successBg: 'var(--success-bg)',
  dangerFg: 'var(--danger-fg)',
  dangerBg: 'var(--danger-bg)',
  infoFg: 'var(--info-fg)',
  infoBg: 'var(--info-bg)',
  warnFg: 'var(--warn-fg)',
  warnBg: 'var(--warn-bg)',
  neutralFg: 'var(--neutral-fg)',
  neutralBg: 'var(--neutral-bg)',
};

// ============================================================
// Pill / badge
// ============================================================
const Pill = ({ tone = 'neutral', size = 'md', children, style = {} }) => {
  const tones = {
    brand:   { bg: C.brandBg,   fg: C.brandFg },
    success: { bg: C.successBg, fg: C.successFg },
    danger:  { bg: C.dangerBg,  fg: C.dangerFg },
    info:    { bg: C.infoBg,    fg: C.infoFg },
    warn:    { bg: C.warnBg,    fg: C.warnFg },
    neutral: { bg: C.neutralBg, fg: C.neutralFg },
  };
  const t = tones[tone];
  const sz = size === 'sm'
    ? { fontSize: 10, padding: '1px 6px', lineHeight: 1.5 }
    : { fontSize: 11, padding: '2px 8px', lineHeight: 1.5 };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      background: t.bg, color: t.fg, borderRadius: 9999,
      fontWeight: 500, whiteSpace: 'nowrap', ...sz, ...style,
    }}>{children}</span>
  );
};

const StatusPill = ({ status, size = 'sm' }) => {
  if (status === 'published') return <Pill tone="success" size={size}>公開</Pill>;
  if (status === 'cancelled') return <Pill tone="danger"  size={size}>中止</Pill>;
  if (status === 'done')      return <Pill tone="info"    size={size}>終了</Pill>;
  return <Pill tone="neutral" size={size}>下書き</Pill>;
};

const GradePill = ({ grade, size = 'sm' }) => (
  <Pill tone="info" size={size} style={{ fontFamily: 'ui-monospace,monospace', fontWeight: 600 }}>{grade}級</Pill>
);

// ============================================================
// Avatar — initial letter on tinted bg, deterministic from id.
// ============================================================
const AVATAR_COLORS = [
  ['#DBEAFE','#1E3A8A'], ['#FEE2E2','#991B1B'], ['#DCFCE7','#14532D'],
  ['#FEF3C7','#92400E'], ['#E9D5FF','#5B21B6'], ['#FCE7F3','#9D174D'],
  ['#CFFAFE','#155E75'], ['#FED7AA','#9A3412'],
];

const Avatar = ({ member, size = 28 }) => {
  if (!member) return null;
  const [bg, fg] = AVATAR_COLORS[member.id % AVATAR_COLORS.length];
  const initial = member.name.slice(0, 1);
  return (
    <div style={{
      width: size, height: size, borderRadius: 9999,
      background: bg, color: fg,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: Math.round(size * 0.45), fontWeight: 600, flexShrink: 0,
    }}>{initial}</div>
  );
};

// Stack of overlapping avatars.
const AvatarStack = ({ ids, max = 5, size = 22 }) => {
  const shown = ids.slice(0, max);
  const extra = ids.length - shown.length;
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      {shown.map((id, i) => (
        <div key={id} style={{ marginLeft: i === 0 ? 0 : -6, boxShadow: `0 0 0 1.5px ${C.surface}`, borderRadius: 9999 }}>
          <Avatar member={memberById(id)} size={size} />
        </div>
      ))}
      {extra > 0 && (
        <div style={{
          marginLeft: -6, width: size, height: size, borderRadius: 9999,
          background: C.neutralBg, color: C.neutralFg, boxShadow: `0 0 0 1.5px ${C.surface}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: Math.round(size * 0.4), fontWeight: 600,
        }}>+{extra}</div>
      )}
    </div>
  );
};

// ============================================================
// MobileFrame — 375×700 chrome
// ============================================================
const MobileFrame = ({ children, title = 'かげとら', user = '山田さん', showTopBar = true, showNav = true, activeNav = 'home' }) => (
  <div style={{
    width: 375, height: 700, background: C.bg,
    display: 'flex', flexDirection: 'column', color: C.fg,
    fontFamily: 'var(--font-sans, "Noto Sans JP", ui-sans-serif, system-ui, sans-serif)',
  }}>
    {/* Status bar */}
    <div style={{
      height: 24, background: C.surface,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 14px', fontSize: 11, color: C.fg2, fontWeight: 500, flexShrink: 0,
    }}>
      <span>9:41</span>
      <span style={{ letterSpacing: '0.4em' }}>●●●</span>
    </div>
    {showTopBar && (
      <div style={{
        height: 44, background: C.surface,
        borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 16px', flexShrink: 0,
      }}>
        <div style={{ fontFamily: 'var(--font-display, inherit)', fontWeight: 700, fontSize: 16, color: C.brand, letterSpacing: '0.02em' }}>{title}</div>
        <div style={{ fontSize: 12, color: C.fg3 }}>{user}</div>
      </div>
    )}
    <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>{children}</div>
    {showNav && (
      <div style={{
        height: 52, background: C.surface, borderTop: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'stretch', flexShrink: 0,
      }}>
        {[
          { id: 'home', l: 'ホーム' },
          { id: 'events', l: 'イベント' },
          { id: 'schedule', l: '予定' },
          { id: 'members', l: '会員' },
        ].map(it => {
          const a = it.id === activeNav;
          return (
            <div key={it.id} style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 500,
              color: a ? C.brand : C.fg3,
              borderTop: a ? `2px solid ${C.brand}` : '2px solid transparent',
              marginTop: -1,
            }}>{it.l}</div>
          );
        })}
      </div>
    )}
  </div>
);

// ============================================================
// AppBar variant: back arrow + title + optional action
// ============================================================
const AppBar = ({ onBack = true, title, action }) => (
  <div style={{
    height: 44, background: C.surface,
    borderBottom: `1px solid ${C.border}`,
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '0 12px', flexShrink: 0,
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
      {onBack && (
        <div style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.fg2, fontSize: 20 }}>‹</div>
      )}
      <div style={{ fontSize: 15, fontWeight: 600, color: C.fg, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
    </div>
    {action && <div style={{ flexShrink: 0 }}>{action}</div>}
  </div>
);

// ============================================================
// Section header — small, uppercase-ish
// ============================================================
const SectionLabel = ({ children, action }) => (
  <div style={{
    display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
    padding: '0 4px', marginBottom: 8,
  }}>
    <div style={{ fontSize: 12, fontWeight: 600, color: C.fg3, letterSpacing: '0.02em' }}>{children}</div>
    {action && <div style={{ fontSize: 12, color: C.brand, fontWeight: 500 }}>{action}</div>}
  </div>
);

// ============================================================
// Card container
// ============================================================
const Card = ({ children, style = {}, pad = 14, interactive = false }) => (
  <div style={{
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: 10,
    padding: pad,
    ...style,
  }}>{children}</div>
);

// ============================================================
// Button
// ============================================================
const Btn = ({ kind = 'primary', size = 'md', children, style = {}, block = false }) => {
  const kinds = {
    primary: { bg: C.brand, color: '#fff', border: 'transparent' },
    secondary: { bg: C.surface, color: C.fg2, border: C.border },
    ghost: { bg: 'transparent', color: C.brand, border: 'transparent' },
    danger: { bg: C.dangerBg, color: C.dangerFg, border: 'transparent' },
  };
  const sizes = {
    sm: { padding: '6px 12px', fontSize: 12, height: 32 },
    md: { padding: '10px 16px', fontSize: 14, height: 40 },
    lg: { padding: '12px 20px', fontSize: 15, height: 48 },
  };
  const k = kinds[kind]; const s = sizes[size];
  return (
    <button style={{
      background: k.bg, color: k.color, border: `1px solid ${k.border}`,
      borderRadius: 8, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
      width: block ? '100%' : 'auto',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      ...s, ...style,
    }}>{children}</button>
  );
};

// ============================================================
// DescList — <dt>/<dd> style rows
// ============================================================
const DescList = ({ items }) => (
  <div>
    {items.map(([k, v], i) => (
      <div key={k} style={{
        display: 'flex', alignItems: 'flex-start',
        padding: '10px 0',
        borderTop: i === 0 ? 'none' : `1px solid ${C.borderSoft}`,
        fontSize: 13,
      }}>
        <div style={{ width: 96, flexShrink: 0, color: C.fg3, fontSize: 12, paddingTop: 1 }}>{k}</div>
        <div style={{ flex: 1, color: C.fg }}>{v}</div>
      </div>
    ))}
  </div>
);

// ============================================================
// AttendanceCounts — 3-up cards (参加/不参加/未回答) OR a stacked bar
// ============================================================
const AttendanceCounts = ({ ev, variant = 'cards' }) => {
  if (variant === 'bar') {
    const total = Math.max(ev.attendIds.length + ev.absentIds.length + ev.unansweredCount, 1);
    return (
      <div>
        <div style={{ display: 'flex', height: 8, borderRadius: 9999, overflow: 'hidden', background: C.borderSoft }}>
          {ev.attendIds.length > 0   && <div style={{ flex: ev.attendIds.length,  background: C.brand    }} />}
          {ev.absentIds.length > 0   && <div style={{ flex: ev.absentIds.length,  background: '#F3B4B4' }} />}
          {ev.unansweredCount > 0     && <div style={{ flex: ev.unansweredCount,    background: '#F3D78A' }} />}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11 }}>
          <span style={{ color: C.successFg }}>● 参加 {ev.attendIds.length}</span>
          <span style={{ color: C.dangerFg }}>● 不参加 {ev.absentIds.length}</span>
          <span style={{ color: C.warnFg }}>● 未回答 {ev.unansweredCount}</span>
        </div>
      </div>
    );
  }
  return (
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
};

// Expose
Object.assign(window, { C, Pill, StatusPill, GradePill, Avatar, AvatarStack, MobileFrame, AppBar, SectionLabel, Card, Btn, DescList, AttendanceCounts });
