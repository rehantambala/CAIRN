import { useMemo, useState } from 'react';
import { post, type Platform } from '../api';
import { ago } from '../format';
import { useFetch, useNow } from '../hooks';
import { ErrorBanner, Loading, PageHead, Empty } from '../components/ui';

interface P { platform: Platform; id: string; title: string; url: string | null; difficulty: string | null; topic: string | null; solved: boolean }
interface Payload {
  selectedToday: { platform: Platform; externalId: string; title: string; url: string; difficulty: string | null; topic: string | null; reason: string; solved: boolean }[];
  recentlySolved: { platform: Platform; id: string; title: string; url: string | null; difficulty: string | null; topic: string | null; at: string; source: string }[];
  pool: P[];
  manualAllowed: Record<Platform, boolean>;
}
const PLAT_LABEL: Record<string, string> = { leetcode: 'LeetCode', codechef: 'CodeChef', codeforces: 'Codeforces' };

export function Problems() {
  const { data, error, loading, reload } = useFetch<Payload>('/problems');
  const now = useNow(60_000);
  const [q, setQ] = useState('');
  const [plat, setPlat] = useState<'all' | Platform>('all');
  const [show, setShow] = useState<'unsolved' | 'all'>('unsolved');
  const [busy, setBusy] = useState<string | null>(null);

  const list = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.pool.filter((p) =>
      (plat === 'all' || p.platform === plat) && (show === 'all' || !p.solved) &&
      (!needle || p.title.toLowerCase().includes(needle) || (p.topic ?? '').toLowerCase().includes(needle)));
  }, [data, q, plat, show]);

  if (loading) return <Loading />;
  if (error || !data) return <ErrorBanner error={error ?? new Error('NO_DATA')} retry={reload} />;

  async function mark(p: { platform: Platform; id: string }) {
    setBusy(p.id);
    try { await post('/problems/solve', { platform: p.platform, externalId: p.id }); await reload(); } finally { setBusy(null); }
  }

  return (
    <>
      <PageHead title="Practice" sub="Problems are selected for you. A problem already solved is never suggested again." />

      <section className="section" aria-label="Selected today">
        <div className="frame">
          <p className="kicker" style={{ marginBottom: 'var(--space-6)' }}>Selected for today</p>
          {data.selectedToday.length === 0
            ? <Empty title="No selection">No problems are suggested today. Use the pool below.</Empty>
            : (
              <ul className="ledger">
                {data.selectedToday.map((s) => (
                  <li key={s.platform + s.externalId} className="ledger__row">
                    <span className="ledger__k">{PLAT_LABEL[s.platform]} · {s.difficulty ?? '—'}{s.topic ? ` · ${s.topic}` : ''}</span>
                    <span className="ledger__v"><a href={s.url} target="_blank" rel="noreferrer noopener">{s.title}</a><br /><span className="muted">{s.reason}</span></span>
                    <span className="state">{s.solved ? '✓ Solved' : '○ Open'}</span>
                  </li>
                ))}
              </ul>
            )}
        </div>
      </section>

      <section className="section block block-deep" aria-label="Recently solved">
        <div className="frame">
          <p className="kicker" style={{ marginBottom: 'var(--space-6)' }}>Recently solved</p>
          {data.recentlySolved.length === 0
            ? <Empty title="No accepted problems recorded">Accepted submissions appear here after a synchronisation or an import.</Empty>
            : (
              <ul className="ledger">
                {data.recentlySolved.map((s) => (
                  <li key={s.platform + s.id} className="ledger__row">
                    <span className="ledger__k">{PLAT_LABEL[s.platform]}{s.difficulty ? ` · ${s.difficulty}` : ''}</span>
                    <span className="ledger__v">{s.url ? <a href={s.url} target="_blank" rel="noreferrer noopener">{s.title}</a> : s.title}</span>
                    <span className="muted">{new Date(s.at).getFullYear() < 2000 ? 'before the baseline' : ago(s.at, now)} · {s.source === 'MANUAL' ? 'recorded by you' : 'verified'}</span>
                  </li>
                ))}
              </ul>
            )}
        </div>
      </section>

      <section className="section" aria-label="Pool">
        <div className="frame">
          <p className="kicker" style={{ marginBottom: 'var(--space-6)' }}>The problem pool</p>
          <div className="form-grid">
            <div className="field"><label htmlFor="q">Search</label><input id="q" className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Title or topic" /></div>
            <div className="field"><label htmlFor="pl">Platform</label>
              <select id="pl" className="select" value={plat} onChange={(e) => setPlat(e.target.value as any)}>
                <option value="all">All</option><option value="leetcode">LeetCode</option><option value="codechef">CodeChef</option><option value="codeforces">Codeforces</option>
              </select></div>
            <div className="field"><label htmlFor="sh">Show</label>
              <select id="sh" className="select" value={show} onChange={(e) => setShow(e.target.value as any)}>
                <option value="unsolved">Unsolved</option><option value="all">All</option>
              </select></div>
          </div>
          <p className="muted" style={{ margin: 'var(--space-4) 0' }} aria-live="polite">{list.length} problem{list.length === 1 ? '' : 's'}</p>
          {list.length === 0
            ? <Empty title="No matches">Adjust the search or the platform.</Empty>
            : (
              <ul className="ledger">
                {list.slice(0, 120).map((p) => (
                  <li key={p.platform + p.id} className="ledger__row">
                    <span className="ledger__k">{PLAT_LABEL[p.platform]} · {p.difficulty ?? '—'}</span>
                    <span className="ledger__v">{p.url ? <a href={p.url} target="_blank" rel="noreferrer noopener">{p.title}</a> : p.title}{p.topic && <span className="muted"> · {p.topic}</span>}</span>
                    {p.solved ? <span className="state">✓ Solved</span>
                      : data.manualAllowed[p.platform] ? <button className="btn btn--ghost btn--sm" disabled={busy !== null} aria-busy={busy === p.id} onClick={() => mark(p)} aria-label={`Mark ${p.title} as solved`}>Mark as solved</button>
                      : <span className="muted">Verified automatically</span>}
                  </li>
                ))}
              </ul>
            )}
        </div>
      </section>
    </>
  );
}
