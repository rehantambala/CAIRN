import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ago } from '../format';
import { useReveal } from '../hooks';
import { Mark } from './Mark';
import type { Connection, SourceState } from '../api';

export function Loading({ label = 'Retrieving your position' }: { label?: string }) {
  // A free server sleeps when idle. After a few seconds the wait is explained rather than left unexplained.
  const [slow, setSlow] = useState(false);
  useEffect(() => { const t = window.setTimeout(() => setSlow(true), 5000); return () => window.clearTimeout(t); }, []);
  return (
    <div className="loading frame" role="status" aria-live="polite">
      <Mark size={96} mode="build" className="loading__mark" />
      <p className="loading__t">{label}</p>
      <p className="loading__s" data-on={slow}>{slow ? 'The server is starting after a period of inactivity. This can take up to a minute.' : ''}</p>
      <div className="skel" aria-hidden="true"><span className="skel__a" /><span className="skel__b" /><span className="skel__c" /></div>
    </div>
  );
}

export function ErrorBanner({ error, retry }: { error: Error; retry?: () => void }) {
  return (
    <div className="frame" style={{ padding: 'var(--space-8) var(--gutter)' }}>
      <div className="banner" role="alert">
        <p className="h-sub">This page could not be loaded</p>
        <p className="body" style={{ marginTop: 'var(--space-3)' }}>
          {error.message === 'UNAUTHENTICATED' ? 'Your session has ended. Please sign in again.' : `${error.message}. Nothing has been changed.`}
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

// Figures are as fresh as their last synchronisation; nothing is presented as "live".
const SOURCE_WORD: Record<SourceState, string> = { LIVE: 'Synced', SYNCED: 'Synced', IMPORTED: 'Imported', MANUAL: 'Manual', STALE: 'Stale', ERROR: 'Error' };

const CONNECTION_WORD: Record<Connection, string> = {
  NOT_CONNECTED: 'Not connected', PENDING_VERIFICATION: 'Pending verification', CONNECTED: 'Connected', SYNCED: 'Synced',
  STALE: 'Stale', ERROR: 'Error', MANUAL: 'Manual', UNAVAILABLE: 'Unavailable',
};
const CONNECTION_STYLE: Record<Connection, SourceState> = {
  NOT_CONNECTED: 'MANUAL', PENDING_VERIFICATION: 'STALE', CONNECTED: 'SYNCED', SYNCED: 'SYNCED', STALE: 'STALE', ERROR: 'ERROR', MANUAL: 'MANUAL', UNAVAILABLE: 'STALE',
};
export function ConnectionChip({ c }: { c: Connection }) {
  return <span className="chip" data-s={CONNECTION_STYLE[c]}>{CONNECTION_WORD[c]}</span>;
}

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
}: { kicker?: string; tone?: 'sky' | 'deep' | 'ink'; children: ReactNode; id?: string; className?: string; label?: string }) {
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
    <header className="pagehead block block-sky">
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
