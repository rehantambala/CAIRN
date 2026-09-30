import { useState } from 'react';
import { Link } from 'react-router-dom';
import { post, type Item, type Platform } from '../api';
import { signed } from '../format';
import { useAnnouncer } from './ui';
import { Pips } from './score';

export function TodayItem({ item, index, onChange, open }: { item: Item; index: number; onChange: () => void; open?: boolean }) {
  const done = item.completed;
  const { say, region } = useAnnouncer();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const auto = item.platform === 'codeforces';
  const word = done ? (item.verification === 'VERIFIED' ? '✓ Verified' : '○ Recorded by you') : item.completedCount > 0 ? '● In progress' : '○ Open';

  async function mark(s: { platform: Platform; externalId: string }) {
    setBusy(s.externalId); setErr(null);
    try {
      const r = await post<{ isNew: boolean; overall: number; scoreDelta: number }>('/problems/solve', s);
      say(`Recorded. The score is ${r.overall}, a change of ${signed(r.scoreDelta)}.`);
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

  const what = item.type === 'PROBLEM_QUOTA' ? `${item.completedCount} of ${item.quota}`
    : item.type === 'CONTEST' ? (item.required ? 'Committed' : 'Optional')
      : item.type === 'CONTEST_PREP' ? `${item.minutes} minutes · optional` : 'Rest day';

  return (
    <li className={`q${done ? ' is-done' : ''}`}>
      {region}
      <span className="q__no display" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
      <div className="q__main">
        <div className="q__head">
          <h3 className="q__plat">{item.title}</h3>
          <span className="state">{word}</span>
        </div>
        <div className="q__prog">
          {item.type === 'PROBLEM_QUOTA' && <Pips total={item.quota} on={item.completedCount} />}
          <span className="meta">{what}{item.points > 0 && !done ? ` · +${item.points} points` : ''}</span>
        </div>

        {item.type === 'PROBLEM_QUOTA' && (
          <details className="q__more" open={open}>
            <summary>{done ? 'Problems you solved' : 'Choose a problem'}</summary>
            {item.suggestions.length > 0 && (
              <ul className="ledger">
                {item.suggestions.map((s) => (
                  <li key={s.externalId} className="ledger__row q__row">
                    <span className="ledger__k">{[s.difficulty, s.topic].filter(Boolean).join(' · ') || '—'}</span>
                    <a className="ledger__v" href={s.url} target="_blank" rel="noreferrer noopener">{s.title}<span className="sr-only"> (opens in a new tab)</span></a>
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
            {item.guidance && <p className="small" style={{ marginTop: 'var(--space-3)' }}>{item.guidance}{item.practiceUrl && <> <a href={item.practiceUrl} target="_blank" rel="noreferrer noopener">Open the practice page</a></>}</p>}
            {auto && <div className="btn-row" style={{ marginTop: 'var(--space-4)' }}><button className="btn btn--sm" onClick={sync} disabled={busy !== null} aria-busy={busy === 'sync'}>{busy === 'sync' ? 'Checking Codeforces…' : 'Check Codeforces'}</button></div>}
            {!auto && !done && <p className="small" style={{ marginTop: 'var(--space-3)' }}>A problem you mark yourself is recorded as unverified. Importing your platform figures verifies it.</p>}
            <p className="small q__why">{item.reason}</p>
          </details>
        )}
        {item.type === 'CONTEST' && item.contestId && <div className="btn-row" style={{ marginTop: 'var(--space-4)' }}><Link to={`/contests?focus=${item.contestId}`} className="btn btn--sm">Open contest</Link></div>}
        {err && <p className="error-text" role="alert" style={{ marginTop: 'var(--space-3)' }}>{err}</p>}
      </div>
    </li>
  );
}
