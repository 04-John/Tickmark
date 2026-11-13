// Building blocks shared by every screen. Text from the chain is always passed as React children (escaped), never as HTML.
import type { ReactNode } from 'react';
import type { Tone } from './lib/labels.ts';

export function Mark({ size = 28, bare = false }: { size?: number; bare?: boolean }) {
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14.5" className="mark-bg" />
      {!bare && size >= 32 && <path d="M14 22H50M14 32H50M14 42H50" className="mark-rules" strokeWidth="1.6" />}
      <path d="M17 33.5Q22 37.5 27 44Q35 28.5 48 19" fill="none" className="mark-tick" strokeWidth={size < 24 ? 9 : 6.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ href = '#/' }: { href?: string }) {
  return (
    <a className="logo" href={href} aria-label="Tickmark home">
      <Mark size={26} />
      <span>Tickmark</span>
    </a>
  );
}

export function Pill({ tone = 'plain', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`pill t-${tone}`} title={title}>
      {children}
    </span>
  );
}

export function NetworkPill({ network }: { network: string }) {
  return <Pill tone={network === 'testnet' ? 'warn' : 'ok'}>{network === 'testnet' ? 'Testnet' : 'Mainnet'}</Pill>;
}

/** A shimmering placeholder in the shape of what will load. */
export function Sk({ w = '100%', h = 12, r, className = '' }: { w?: number | string; h?: number | string; r?: number; className?: string }) {
  return <span className={`sk ${className}`} style={{ width: w, height: h, borderRadius: r }} aria-hidden="true" />;
}

export function Chevron() {
  return (
    <svg className="chev" width="8" height="13" viewBox="0 0 8 13" aria-hidden="true">
      <path d="M1 1l5.5 5.5L1 12" fill="none" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

const ICONS: Record<string, string> = {
  overview: 'M4 20V11M10 20V5M16 20v-6M3 20h18',
  questions: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5M12 17h.01',
  journal: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  payees: 'M12 4a4 4 0 1 0 0 8a4 4 0 1 0 0-8M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6',
  downloads: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  close: 'M5 12.5l4.5 4.5L19 7',
  verify: 'M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6zM9 12l2 2 4-4',
  search: 'M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14M20 20l-3.5-3.5',
  back: 'M15 18l-6-6 6-6',
  copy: 'M9 9h11v11H9zM5 15V6a2 2 0 0 1 2-2h8',
  share: 'M12 15V3M7 8l5-5 5 5M5 12H4v9h16v-9h-1',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5',
  external: 'M7 17 17 7M9 7h8v8',
  x: 'M6 6l12 12M18 6 6 18',
  info: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 11v5.5M12 7.5h.01',
  more: 'M5 11a1 1 0 1 0 0 2a1 1 0 1 0 0-2M12 11a1 1 0 1 0 0 2a1 1 0 1 0 0-2M19 11a1 1 0 1 0 0 2a1 1 0 1 0 0-2',
  home: 'M4 11 12 4l8 7M6 9.5V20h12V9.5',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  sidebar: 'M4 5h16v14H4zM9.5 5v14',
  sun: 'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4 8 8 0 1 0 20 14.5z',
};

/** Light and dark: one button, the icon of the mode it switches to. */
export function ThemeButton({ theme, onToggle, className = 'tb-btn' }: { theme: 'light' | 'dark'; onToggle: () => void; className?: string }) {
  const to = theme === 'dark' ? 'light' : 'dark';
  return (
    <button type="button" className={className} onClick={onToggle} aria-label={`Switch to ${to} mode`} title={`Switch to ${to} mode`}>
      <Icon name={to === 'dark' ? 'moon' : 'sun'} size={17} />
    </button>
  );
}

export function Icon({ name, size = 18, className = '' }: { name: keyof typeof ICONS | string; size?: number; className?: string }) {
  return (
    <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name] ?? ''} />
    </svg>
  );
}

/** Progress as a ring, like Apple's activity rings: share of 0..1. */
export function Ring({ value, size = 44 }: { value: number; size?: number }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <svg className="ring-mini" width={size} height={size} viewBox="0 0 44 44" aria-hidden="true">
      <circle cx="22" cy="22" r={r} className="ring-track" strokeWidth="5" fill="none" />
      {v > 0 && <circle cx="22" cy="22" r={r} className="ring-fill" strokeWidth="5" fill="none" strokeLinecap="round" strokeDasharray={`${v * c} ${c}`} transform="rotate(-90 22 22)" />}
    </svg>
  );
}

/** An auditor's tick, drawn in one stroke: the mark that something was checked. */
export function TickDrawn({ size = 46 }: { size?: number }) {
  return (
    <svg className="tick-drawn" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <path d="M12 34Q19 39 25 48Q36 26 54 13" fill="none" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" pathLength={1} />
    </svg>
  );
}

export function Stat({ label, value, note, tone = 'plain', href, aside }: { label: string; value: ReactNode; note?: ReactNode; tone?: Tone; href?: string; aside?: ReactNode }) {
  const body = (
    <>
      {aside && <span className="stat-aside">{aside}</span>}
      <span className="stat-label">{label}</span>
      <span className="stat-value num">{value}</span>
      {note !== undefined && <span className="stat-note">{note}</span>}
    </>
  );
  return href ? (
    <a className={`stat t-${tone}`} href={href}>
      {body}
    </a>
  ) : (
    <div className={`stat t-${tone}`}>{body}</div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" className={v === value ? 'on' : ''} aria-pressed={v === value} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

/** iOS inset grouped list: a section header, white rounded rows, an optional footer. */
export function Group({ title, footer, children, className = '' }: { title?: ReactNode; footer?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`group ${className}`}>
      {title && <h2 className="group-title">{title}</h2>}
      <div className="group-body">{children}</div>
      {footer && <p className="group-foot">{footer}</p>}
    </section>
  );
}

export function Row({ href, onClick, children, chevron = !!(href || onClick), className = '' }: { href?: string; onClick?: () => void; children: ReactNode; chevron?: boolean; className?: string }) {
  const inner = (
    <>
      {children}
      {chevron && <Chevron />}
    </>
  );
  if (href)
    return (
      <a className={`row ${className}`} href={href}>
        {inner}
      </a>
    );
  if (onClick)
    return (
      <button type="button" className={`row ${className}`} onClick={onClick}>
        {inner}
      </button>
    );
  return <div className={`row ${className}`}>{inner}</div>;
}

export function Stamp({ id, block, small }: { id: number; block: number; small?: boolean }) {
  return (
    <div className={`stamp ${small ? 'small' : ''}`}>
      <b>✓ Closed by vote #{id}</b>
      <span className="num">block {block.toLocaleString('en-US')}</span>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <b>{title}</b>
      {children && <span>{children}</span>}
    </div>
  );
}

// ---------------------------------------------------------------- motion

const MORPH_ICONS = {
  send: 'M22 2 11 13M22 2l-7 20-4-9-9-4z',
  pencil: 'M4 20l4-1 10.5-10.5a2.1 2.1 0 0 0-3-3L5 16zM14 7l3 3',
  tick: 'M5 12.5l4.5 4.5L19 7',
  arrow: 'M5 12h14M13 6l6 6-6 6',
};

/**
 * The main action of a screen. On hover (or keyboard focus) its words change to what it will do here and now
 * ("Review questions" → "Explain $0.72") and its icon loops: the tick draws itself, the pencil writes, the arrow sends.
 * Both labels share one grid cell, so the button never changes width.
 */
export function MorphButton({ label, hover, icon, href, onClick, tone = 'primary', size }: { label: string; hover: string; icon: keyof typeof MORPH_ICONS; href?: string; onClick?: () => void; tone?: 'primary' | 'ok' | 'gray'; size?: 'sm' | 'lg' }) {
  const body = (
    <>
      <span className={`morph-icon m-${icon}`} aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d={MORPH_ICONS[icon]} pathLength={1} />
        </svg>
      </span>
      <span className="morph-labels">
        <span className="m-a">{label}</span>
        <span className="m-b" aria-hidden="true">
          {hover}
        </span>
      </span>
    </>
  );
  const cls = `btn btn-${tone} morph ${size ? `btn-${size}` : ''}`;
  return href ? (
    <a className={cls} href={href} title={hover}>
      {body}
    </a>
  ) : (
    <button type="button" className={cls} onClick={onClick} title={hover}>
      {body}
    </button>
  );
}

/** A disclosure row: a one-line summary that opens smoothly into its content. */
export function Disclosure({ title, summary, children, defaultOpen = false }: { title: string; summary?: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="disclosure" open={defaultOpen}>
      <summary>
        <svg className="disc-chev" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M3 1.5 6.5 5 3 8.5" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <b>{title}</b>
        {summary && <span className="disc-summary">{summary}</span>}
      </summary>
      <div className="disc-body">{children}</div>
    </details>
  );
}

/** A round checkbox whose tick draws itself when checked. */
export function Check({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} aria-label={label} className={`check ${checked ? 'on' : ''}`} onClick={onChange}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 12.5l4.5 4.5L19 7" pathLength={1} />
      </svg>
    </button>
  );
}
