import { safeHref } from '../api';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { post, type Item, type Platform } from '../api';
import { signed } from '../format';
import { useAnnouncer } from './ui';
import { Pips } from './score';

const STATE_WORD = { done: 'Verified', manual: 'Recorded by you', progress: 'In progress', open: 'Open' } as const;

export function TodayItem({ item, index, onChange, current, auto }: { item: Item; index: number; onChange: () => void; current?: boolean; auto: boolean }) {
  const done = item.completed;
  const { say, region } = useAnnouncer();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(!!current);
  const state = done ? (item.verification === 'VERIFIED' ? 'done' : 'manual') : item.completedCount > 0 ? 'progress' : 'open';

  async function mark(s: { platform: Platform; externalId: string }) {
    setBusy(s.externalId); setErr(null);
    try {
      const r = await post<{ isNew: boolean; overall: number; scoreDelta: number }>('/problems/solve', s);
      say(`Recorded. The score is ${r.overall}, a change of ${signed(r.scoreDelta)}.`);
      onChange();
    } catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  }
  async function sync() {
    if (!item.platform) return;
    setBusy('sync'); setErr(null);
    try {
      const r = await post<{ ok: boolean; message: string }>(`/sync/${item.platform}`);
      if (!r.ok) setErr(r.message); else onChange();
    } catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  }

  const what = item.type === 'PROBLEM_QUOTA' ? `${item.completedCount} of ${item.quota}`
    : item.type === 'CONTEST' ? (item.required ? 'Committed' : 'Optional')
      : item.type === 'CONTEST_PREP' ? `${item.minutes} minutes · optional` : 'Rest day';
  const label = item.title;

  return (
    <li className={`q q--${state}${current ? ' is-current' : ''}`}>
      {region}
      <span className="q__no display" aria-hidden="true">{done ? '✓' : String(index + 1).padStart(2, '0')}</span>
      <div className="q__main">
        <div className="q__head">
          <h3 className="q__plat">{label}</h3>
          <span className="state" data-s={state}>{STATE_WORD[state]}</span>
        </div>
        <div className="q__prog">
          {item.type === 'PROBLEM_QUOTA' && <Pips total={item.quota} on={item.completedCount} />}
          <span className="meta">{what}{item.points > 0 && !done ? ` · +${item.points} points` : ''}</span>
        </div>

        {item.type === 'PROBLEM_QUOTA' && (
          <div className="q__more">
            <button type="button" className="q__toggle" aria-expanded={open} aria-controls={`q-${item.id}`} onClick={() => setOpen(!open)}>
              <span className="q__chev" aria-hidden="true" />{done ? 'Problems you solved' : open ? 'Hide the problems' : 'Choose a problem'}
            </button>
            {open && (
              <div id={`q-${item.id}`} className="q__panel">
                {item.suggestions.length > 0 && (
                  <ul className="picks">
                    {item.suggestions.map((s) => (
                      <li key={s.externalId} className="pick">
                        <span className="pick__k">{[s.difficulty, s.topic].filter(Boolean).join(' · ') || 'Unrated'}</span>
                        <a className="pick__t" href={safeHref(s.url)} target="_blank" rel="noreferrer noopener">{s.title}<span className="sr-only"> (opens in a new tab)</span></a>
                        {!auto && !done && (
                          <button className="btn btn--ghost btn--sm" disabled={busy !== null} aria-busy={busy === s.externalId}
                            onClick={() => mark({ platform: s.platform, externalId: s.externalId })} aria-label={`Mark ${s.title} as solved`}>
                            {busy === s.externalId ? 'Recording…' : 'Mark as solved'}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {item.guidance && <p className="small q__note">{item.guidance}{item.practiceUrl && <> <a href={safeHref(item.practiceUrl)} target="_blank" rel="noreferrer noopener">Open the practice page</a></>}</p>}
                {auto && !done && <p className="small q__note">This platform is read from your public profile. Solve the problem, then select Check now; the score is recalculated from your verified total.</p>}
                {!auto && !done && <p className="small q__note">A problem you mark yourself is recorded as unverified. Connecting the platform in Preferences verifies it.</p>}
                {auto && <div className="btn-row" style={{ marginTop: 'var(--space-4)' }}><button className="btn btn--sm" onClick={sync} disabled={busy !== null} aria-busy={busy === 'sync'}>{busy === 'sync' ? 'Reading…' : 'Check now'}</button></div>}
                <p className="small q__why">{item.reason}</p>
              </div>
            )}
          </div>
        )}
        {item.type === 'CONTEST' && item.contestId && <div className="btn-row" style={{ marginTop: 'var(--space-4)' }}><Link to={`/contests?focus=${item.contestId}`} className="btn btn--sm">Open contest</Link></div>}
        {err && <p className="error-text" role="alert" style={{ marginTop: 'var(--space-3)' }}>{err}</p>}
      </div>
    </li>
  );
}
