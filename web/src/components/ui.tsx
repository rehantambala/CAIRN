import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ago } from '../format';
import { useReveal } from '../hooks';
import type { SourceState } from '../api';

export function Loading({ label = 'One moment' }: { label?: string }) {
  return <div className="loading frame" role="status" aria-live="polite">{label}…</div>;
}

export function ErrorBanner({ error, retry }: { error: Error; retry?: () => void }) {
  return (
    <div className="frame" style={{ padding: 'var(--space-8) var(--gutter)' }}>
      <div className="banner" role="alert">
        <p className="h-sub">We could not load this</p>
        <p className="body" style={{ marginTop: 'var(--space-3)' }}>
          {error.message === 'UNAUTHENTICATED' ? 'Your session ended. Sign in again.' : `${error.message}. Nothing has been changed.`}
        </p>
        {retry && <div className="btn-row" style={{ marginTop: 'var(--space-4)' }}><button className="btn btn--sm" onClick={retry}>Try again</button></div>}
      </div>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <p className="kicker">{title}</p>
      {children && <p className="empty__t" style={{ marginTop: 'var(--space-4)' }}>{children}</p>}
    </div>
  );
}

const SOURCE_WORD: Record<SourceState, string> = { LIVE: 'Live', SYNCED: 'Synced', IMPORTED: 'Imported', MANUAL: 'Manual', STALE: 'Stale', ERROR: 'Error' };

export function SourceChip({ status, updatedAt, now }: { status: SourceState; updatedAt?: string | null; now?: number }) {
  return (
    <span className="row" style={{ gap: 'var(--space-3)' }}>
      <span className="chip" data-s={status}>{SOURCE_WORD[status]}</span>
      {updatedAt !== undefined && <span className="muted">{ago(updatedAt, now)}</span>}
    </span>
  );
}

export function Section({
  kicker, tone, children, id, className = '', label,
}: { kicker?: string; tone?: 'pink' | 'deep' | 'ink'; children: ReactNode; id?: string; className?: string; label?: string }) {
  const r = useReveal<HTMLElement>();
  return (
    <section id={id} ref={r.ref} aria-label={label ?? kicker} className={`section ${tone ? `block block-${tone}` : ''} ${r.className} ${className}`}>
      <div className="frame">
        {kicker && <p className="kicker" style={{ marginBottom: 'var(--space-6)' }}>{kicker}</p>}
        {children}
      </div>
    </section>
  );
}

export function PageHead({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <header className="pagehead block block-pink">
      <div className="frame enter">
        <h1 className="display fig-2xl">{title}</h1>
        {sub && <p className="lead" style={{ marginTop: 'var(--space-5)' }}>{sub}</p>}
        {children}
      </div>
    </header>
  );
}

/** Polite live region: announces material changes without moving focus. */
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
