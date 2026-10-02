import { useState } from 'react';
import { Link } from 'react-router-dom';
import { fmt, signed } from '../format';

interface Line { key: string; label: string; ours: number }

/**
 * Compares the figures CAIRN holds with a row of the Smart Interviews leaderboard, one platform at a time, so the
 * platform that disagrees is identifiable at once. Nothing entered here is stored or sent anywhere.
 */
export function Reconcile({ lines, overall }: { lines: Line[]; overall: number }) {
  const [theirs, setTheirs] = useState<Record<string, string>>({});
  const set = (k: string, v: string) => setTheirs({ ...theirs, [k]: v });
  const num = (k: string) => (theirs[k]?.trim() ? Number(theirs[k]) : null);
  const all = [{ key: 'overall', label: 'Overall', ours: overall }, ...lines];
  const diffs = all.map((l) => { const t = num(l.key); return { ...l, t, d: t === null || Number.isNaN(t) ? null : l.ours - t }; });
  const entered = diffs.filter((d) => d.d !== null);
  const off = diffs.filter((d) => d.key !== 'overall' && d.d !== null && d.d !== 0);
  const overallOff = diffs[0].d;

  return (
    <div className="stack">
      <p className="body">Enter the figures from your leaderboard row. Each difference is set against the figure CAIRN holds, so the platform that disagrees is identified at once. Nothing entered here is saved.</p>
      <div className="form-grid">
        {all.map((l) => (
          <div className="field" key={l.key}>
            <label htmlFor={`lb-${l.key}`}>{l.label} on the leaderboard</label>
            <input id={`lb-${l.key}`} className="input" type="number" min={0} inputMode="numeric" value={theirs[l.key] ?? ''} onChange={(e) => set(l.key, e.target.value)} />
          </div>
        ))}
      </div>
      {entered.length > 0 && (
        <ul className="ledger">
          {diffs.filter((d) => d.d !== null).map((d) => (
            <li key={d.key} className="ledger__row">
              <span className="ledger__k">{d.label}</span>
              <span className="ledger__v">CAIRN {fmt(d.ours)} · leaderboard {fmt(d.t!)}</span>
              <span className="state">{d.d === 0 ? '✓ Agrees' : `${signed(d.d!)} · ${d.d! < 0 ? 'CAIRN is lower' : 'CAIRN is higher'}`}</span>
            </li>
          ))}
        </ul>
      )}
      {overallOff !== null && overallOff !== 0 && off.length === 0 && (
        <p className="small">The overall figures differ, but no platform figure has been entered to locate the difference. Enter the platform totals from your row.</p>
      )}
      {off.length > 0 && (
        <p className="small">
          {off.some((d) => ['leetcode', 'codechef', 'codeforces'].includes(d.key)) && 'A difference on LeetCode, CodeChef or Codeforces means the platform and the leaderboard were read at different times, or the leaderboard has not refreshed since a contest. Synchronise in Preferences and compare again. '}
          {off.some((d) => ['smartinterviews', 'interviewbit', 'hackerrank'].includes(d.key)) && <>A difference on Smart Interviews, InterviewBit or HackerRank means the figure entered in <Link to="/settings#profiles">Preferences</Link> is out of date. Enter the leaderboard columns there; they are added exactly as the leaderboard adds them.</>}
        </p>
      )}
    </div>
  );
}
