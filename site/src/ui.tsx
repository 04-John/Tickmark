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
};

export function Icon({ name, size = 18, className = '' }: { name: keyof typeof ICONS | string; size?: number; className?: string }) {
  return (
    <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name] ?? ''} />
    </svg>
  );
}

export function Stat({ label, value, note, tone = 'plain', href }: { label: string; value: ReactNode; note?: ReactNode; tone?: Tone; href?: string }) {
  const body = (
    <>
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
