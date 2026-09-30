import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ago } from '../format';
import { useReveal } from '../hooks';
import type { SourceState } from '../api';

export function Loading({ label = 'Loading' }: { label?: string }) {
  return <div className="loading frame" role="status" aria-live="polite">{label}</div>;
}

export function ErrorBanner({ error, retry }: { error: Error; retry?: () => void }) {
  return (
    <div className="frame" style={{ padding: 'var(--space-8) var(--gutter)' }}>
      <div className="banner banner--error" role="alert">
        <p className="label">SYNC ERROR</p>
        <p>{error.message === 'UNAUTHENTICATED' ? 'Session ended. Sign in again.' : `Data could not be loaded (${error.message}). Nothing on this page has been changed.`}</p>
        {retry && <div className="btn-row" style={{ marginTop: 'var(--space-4)' }}><button className="btn btn--ghost btn--sm" onClick={retry}>Retry</button></div>}
      </div>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <p className="label">{title}</p>
      {children && <p className="empty__t" style={{ marginTop: 'var(--space-3)' }}>{children}</p>}
    </div>
  );
}

export function SourceChip({ status, updatedAt, now }: { status: SourceState; updatedAt?: string | null; now?: number }) {
  return (
    <span className="row" style={{ gap: 'var(--space-3)' }}>
      <span className="chip" data-s={status}>{status}</span>
      {updatedAt !== undefined && <span className="muted">{ago(updatedAt, now)}</span>}
    </span>
  );
}

export function Section({
  no, q, tone, children, id, className = '', label,
}: { no: string; q: string; tone?: 'pink' | 'deep' | 'ink'; children: ReactNode; id?: string; className?: string; label?: string }) {
  const r = useReveal<HTMLElement>();
  return (
    <section
      id={id}
      ref={r.ref}
      aria-label={label ?? q}
      className={`section ${tone ? `block block-${tone}` : ''} ${r.className} ${className}`}
    >
      <div className="frame">
        <div className="eyebrow"><span className="eyebrow__no">{no}</span><span className="eyebrow__q">{q}</span></div>
        {children}
      </div>
    </section>
  );
}

export function PageHead({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="page-head-wrap">
      <header className="page-head frame enter">
        <h1 className="h-page">{title}</h1>
        {sub && <p className="page-head__sub">{sub}</p>}
        {children}
      </header>
    </div>
  );
}

/** Polite live region: announces material score changes without moving focus. */
export function useAnnouncer() {
  const [msg, setMsg] = useState('');
  const t = useRef<number | undefined>(undefined);
  const say = (m: string) => {
    setMsg('');
    window.clearTimeout(t.current);
    t.current = window.setTimeout(() => setMsg(m), 60);
  };
  useEffect(() => () => window.clearTimeout(t.current), []);
  const region = <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{msg}</div>;
  return { say, region };
}
