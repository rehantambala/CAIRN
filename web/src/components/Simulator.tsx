import { useEffect, useMemo, useRef, useState } from 'react';
import { post, type ScoreInputs } from '../api';
import { fmt, signed } from '../format';

interface SimResult {
  current: { overall: number }; simulated: { overall: number; leetcode: { total: number }; codechef: { total: number }; codeforces: { total: number } };
  delta: number; remainingAfter: number; target: number; effects: { key: string; label: string; from: number; to: number; effect: number }[]; note: string;
}

const PLATS = [['leetcode', 'LeetCode'], ['codechef', 'CodeChef'], ['codeforces', 'Codeforces']] as const;
const MANUAL = [['smartinterviews', 'Smart Interviews'], ['interviewbit', 'InterviewBit'], ['hackerrank', 'HackerRank']] as const;

function Num({ label, value, onChange, max }: { label: string; value: number; onChange: (n: number) => void; max: number }) {
  const id = useMemo(() => `n-${Math.random().toString(36).slice(2, 8)}`, []);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} className="input" type="number" inputMode="numeric" min={0} max={max} value={value}
        onChange={(e) => onChange(Math.max(0, Math.min(max, Math.floor(Number(e.target.value) || 0))))} />
    </div>
  );
}

export function Simulator({ base, target }: { base: ScoreInputs; target: number }) {
  const [sim, setSim] = useState<ScoreInputs>(base);
  const [res, setRes] = useState<SimResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const my = ++seq.current;
    const t = setTimeout(() => {
      post<SimResult>('/score/simulate', sim).then((r) => { if (my === seq.current) { setRes(r); setErr(null); } })
        .catch((e) => { if (my === seq.current) setErr(e.message); });
    }, 160);
    return () => clearTimeout(t);
  }, [sim]);

  const setRated = (p: (typeof PLATS)[number][0], k: 'problems' | 'rating' | 'contests', v: number) => setSim((s) => ({ ...s, [p]: { ...s[p], [k]: v } }));

  return (
    <div className="grid-2 grid-2--asym">
      <div className="stack-lg">
        {PLATS.map(([p, label]) => (
          <fieldset key={p} className="fs">
            <legend className="h-sub">{label}</legend>
            <div className="form-grid">
              <Num label="Problems" value={sim[p].problems} onChange={(v) => setRated(p, 'problems', v)} max={100000} />
              <Num label="Rating" value={sim[p].rating} onChange={(v) => setRated(p, 'rating', v)} max={4500} />
              <Num label="Contests" value={sim[p].contests} onChange={(v) => setRated(p, 'contests', v)} max={10000} />
            </div>
          </fieldset>
        ))}
        <fieldset className="fs">
          <legend className="h-sub">Other platforms (as recorded)</legend>
          <div className="form-grid">
            {MANUAL.map(([p, label]) => <Num key={p} label={label} value={sim[p]} onChange={(v) => setSim((s) => ({ ...s, [p]: v }))} max={1_000_000} />)}
          </div>
        </fieldset>
        <div className="btn-row"><button className="btn btn--ghost" onClick={() => setSim(base)}>Reset to today</button></div>
      </div>

      <div className="sim__out" aria-live="polite">
        <p className="kicker">You would be at</p>
        <p className="display fig-hero sim__fig">{res ? fmt(res.simulated.overall) : '…'}</p>
        {err && <p className="error-text" role="alert">{err}</p>}
        {res && (
          <>
            <p className="lead" style={{ marginTop: 'var(--space-5)' }}>
              {signed(res.delta)} from today. {res.remainingAfter === 0 ? `That clears ${fmt(target)}+.` : `${fmt(res.remainingAfter)} still to go.`}
            </p>
            <ul className="ledger" style={{ marginTop: 'var(--space-6)' }}>
              {PLATS.map(([p, label]) => (
                <li key={p} className="ledger__row"><span className="ledger__k">{label}</span><span className="ledger__v" /><span className="ledger__n">{fmt(res.simulated[p].total)}</span></li>
              ))}
            </ul>
            {res.effects.length > 0 && (
              <>
                <p className="kicker" style={{ margin: 'var(--space-6) 0 var(--space-3)' }}>What each change is worth</p>
                <ul className="ledger">
                  {res.effects.map((e) => (
                    <li key={e.key} className="ledger__row"><span className="ledger__k">{e.label}</span><span className="ledger__v">{fmt(e.from)} → {fmt(e.to)}</span><span className="ledger__n">{signed(e.effect)}</span></li>
                  ))}
                </ul>
              </>
            )}
            <p className="small" style={{ marginTop: 'var(--space-5)' }}>
              This is pure arithmetic on the formula. Whether a contest actually moves your rating is not predicted here.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
