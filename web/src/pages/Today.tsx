import { useState } from 'react';
import { Link } from 'react-router-dom';
import { post, type Item, type Objective, type Next, type Platform } from '../api';
import { longDate, signed } from '../format';
import { useFetch, useNow } from '../hooks';
import { ErrorBanner, Loading, PageHead, Section, Empty, useAnnouncer } from '../components/ui';
import { NextBlock } from '../components/score';

interface TodayPayload { date: string; objective: Objective; next: Next }

export function Today() {
  const { data, error, loading, reload } = useFetch<TodayPayload>('/today');
  const now = useNow();
  const [fetchedAt] = useState(() => Date.now());
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBanner error={error ?? new Error('NO_DATA')} retry={reload} />;
  const o = data.objective;
  const required = o.items.filter((i) => i.required);
  const done = required.filter((i) => i.completed).length;

  return (
    <>
      <PageHead title="Today" sub={`${longDate(data.date)}. ${o.isRest ? 'Recovery day.' : `${done} of ${required.length} required actions verified.`}`} />
      <section className="section block block-ink" aria-label="Next action">
        <div className="frame"><NextBlock next={data.next} now={now} fetchedAt={fetchedAt} /></div>
      </section>
      <section className="section" aria-label="Execution">
        <div className="frame">
          {o.items.length === 0 && <Empty title="No objective">No unsolved problems in the pool and no rated contest today.</Empty>}
          <ol className="tday">
            {o.items.map((it, i) => <TodayItem key={it.id} item={it} index={i} onChange={reload} />)}
          </ol>
          {o.rationale.length > 0 && (
            <div style={{ marginTop: 'var(--space-9)' }}>
              <p className="label">How this objective was set</p>
              {o.rationale.map((r, i) => <p key={i} className="serif-lead" style={{ marginTop: 'var(--space-3)' }}>{r}</p>)}
            </div>
          )}
          {o.targetScoreDelta > 0 && (
            <p className="label" style={{ marginTop: 'var(--space-6)' }}>Deterministic score in this objective {signed(o.targetScoreDelta)} · rating movement not included (uncertain)</p>
          )}
        </div>
      </section>
    </>
  );
}

function TodayItem({ item, index, onChange }: { item: Item; index: number; onChange: () => void }) {
  const done = item.completed;
  const status = done ? (item.verification === 'VERIFIED' ? 'VERIFIED' : 'MANUAL') : item.completedCount > 0 ? 'IN PROGRESS' : 'OPEN';
  const { say, region } = useAnnouncer();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const auto = item.platform === 'codeforces';

  async function mark(s: { platform: Platform; externalId: string }) {
    setBusy(s.externalId); setErr(null);
    try {
      const r = await post<{ isNew: boolean; overall: number; scoreDelta: number }>('/problems/solve', s);
      say(`Recorded manually. Score ${r.overall}, ${signed(r.scoreDelta)}.`);
      onChange();
    } catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  }

  async function sync() {
    setBusy('sync'); setErr(null);
    try {
      const r = await post<{ ok: boolean; message: string }>('/sync/codeforces');
      if (!r.ok) setErr(r.message); else onChange();
    } catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  }

  return (
    <li className={`tday__item${done ? ' is-done' : ''}`}>
      {region}
      <div className="tday__no display-xl" aria-hidden="true">{String(index + 1).padStart(2, '0')}</div>
      <div className="tday__main">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 className="display-xl fig-xl tday__plat">{item.title}</h2>
          <span className="tday__state"><span aria-hidden="true">{done ? '✓' : '○'}</span> <span className="state-tag">{status}</span></span>
        </div>
        <p className="tday__what">
          {item.type === 'PROBLEM_QUOTA' && <>{item.quota} selected problem{item.quota === 1 ? '' : 's'} · {item.completedCount} of {item.quota} done</>}
          {item.type === 'CONTEST' && <>Rated contest{item.required ? ' · committed' : ' · optional until committed'}</>}
          {item.type === 'CONTEST_PREP' && <>Preparation · {item.minutes} min · optional</>}
          {item.type === 'REST' && 'No required work today'}
        </p>
        <p className="serif-lead tday__why">{item.reason}</p>

        {item.type === 'PROBLEM_QUOTA' && (
          <div className="tday__problems">
            {item.suggestions.length > 0 && (
              <ul className="ledger">
                {item.suggestions.map((s) => (
                  <li key={s.externalId} className="ledger__row">
                    <span className="ledger__k">{s.difficulty ?? '—'}{s.topic ? ` · ${s.topic}` : ''}</span>
                    <a className="ledger__v" href={s.url} target="_blank" rel="noreferrer noopener">{s.title}<span className="sr-only"> (opens in a new tab)</span></a>
                    {!auto && !done && (
                      <button className="btn btn--ghost btn--sm" disabled={busy !== null} aria-busy={busy === s.externalId}
                        onClick={() => mark({ platform: s.platform, externalId: s.externalId })}
                        aria-label={`Mark ${s.title} as solved manually`}>
                        {busy === s.externalId ? 'Recording' : 'Mark solved'}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {item.guidance && <p className="muted" style={{ marginTop: 'var(--space-3)' }}>{item.guidance}{item.practiceUrl && <> <a href={item.practiceUrl} target="_blank" rel="noreferrer noopener">Open practice</a></>}</p>}
            {auto && <div className="btn-row" style={{ marginTop: 'var(--space-4)' }}><button className="btn btn--sm" onClick={sync} disabled={busy !== null} aria-busy={busy === 'sync'}>{busy === 'sync' ? 'Syncing' : 'Sync Codeforces'}</button></div>}
            {!auto && <p className="muted" style={{ marginTop: 'var(--space-3)' }}>Manual confirmation is recorded as MANUAL, not VERIFIED. Importing your platform stats verifies it.</p>}
          </div>
        )}
        {item.type === 'CONTEST' && item.contestId && <div className="btn-row" style={{ marginTop: 'var(--space-4)' }}><Link to={`/contests?focus=${item.contestId}`} className="btn btn--sm">Open contest</Link></div>}
        {err && <p className="error-text" role="alert" style={{ marginTop: 'var(--space-3)' }}>{err}</p>}
      </div>
    </li>
  );
}
