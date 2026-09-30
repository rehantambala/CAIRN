import { useEffect, useMemo, useRef, useState } from 'react';
import { post, type ManualComponent, type RatedComponent, type ScoreInputs, type Source } from '../api';
import { ago, fmt, signed } from '../format';
import { useFetch, useNow } from '../hooks';
import { ErrorBanner, Loading, PageHead, Section, SourceChip } from '../components/ui';
import { ScoreFigure } from '../components/score';

interface ScorePayload {
  overall: number; components: RatedComponent[]; manual: ManualComponent[]; inputs: ScoreInputs;
  target: number; remaining: number; sources: Source[];
}
interface SimResult {
  current: { overall: number }; simulated: { overall: number; leetcode: { total: number }; codechef: { total: number }; codeforces: { total: number } };
  delta: number; remainingAfter: number; target: number; effects: { key: string; label: string; from: number; to: number; effect: number }[]; note: string;
}

export function ScorePage() {
  const { data, error, loading, reload } = useFetch<ScorePayload>('/score');
  const now = useNow(30_000);
  const [open, setOpen] = useState<string | null>(null);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBanner error={error ?? new Error('NO_DATA')} retry={reload} />;

  return (
    <>
      <PageHead title="Score" sub="Every number is derived from stored facts. Nothing here is estimated by a model.">
        <div className="score-hero">
          <ScoreFigure value={data.overall} />
          <p className="label">Overall · target {fmt(data.target)}+ · remaining {fmt(data.remaining)}</p>
        </div>
      </PageHead>

      <section className="section" aria-label="Breakdown">
        <div className="frame">
          <div className="formula serif-lead">
            <p><strong>LeetCode</strong> = problems × 10 + (max(0, rating − 1300))² ÷ 10 + contests × 50</p>
            <p><strong>CodeChef</strong> = problems × 2 + (max(0, rating − 1200))² ÷ 10 + contests × 50</p>
            <p><strong>Codeforces</strong> = problems × 2 + (max(0, rating − 800))² ÷ 10 + contests × 50</p>
            <p className="muted">Each platform total is rounded down. The rating term is zero at or below its baseline. Smart Interviews, InterviewBit and HackerRank are recorded as entered; no formula is assumed for them.</p>
          </div>

          <ul className="ledger" style={{ marginTop: 'var(--space-8)' }}>
            <li className="ledger__row">
              <span className="ledger__k">Overall</span><span className="ledger__v muted">Sum of all components</span><span className="ledger__n">{fmt(data.overall)}</span>
            </li>
            {data.components.map((c) => (
              <li key={c.platform} className="ledger__row ledger__row--open">
                <span className="ledger__k">{c.label}</span>
                <span className="ledger__v">
                  <button className="link-btn" aria-expanded={open === c.platform} onClick={() => setOpen(open === c.platform ? null : c.platform)}>
                    {c.problems} problems · {c.rating} rating · {c.contests} contests
                  </button>
                  <span className="row" style={{ marginTop: 'var(--space-2)' }}><SourceChip status={c.source.status} updatedAt={c.source.updatedAt} now={now} />{c.source.note && <span className="muted">{c.source.note}</span>}</span>
                  {open === c.platform && (
                    <dl className="parts">
                      <div><dt>Problems</dt><dd>{fmt(c.parts.problems)}</dd></div>
                      <div><dt>Rating term</dt><dd>{fmt(c.parts.rating)}</dd></div>
                      <div><dt>Contests</dt><dd>{fmt(c.parts.contests)}</dd></div>
                      <div><dt>+25 rating (hypothetical)</dt><dd>{signed(c.marginal.ratingPlus25)}</dd></div>
                      <div><dt>+100 rating (hypothetical)</dt><dd>{signed(c.marginal.ratingPlus100)}</dd></div>
                      {c.marginal.ratingToThreshold > 0 && <div><dt>Below scoring threshold by</dt><dd>{c.marginal.ratingToThreshold}</dd></div>}
                    </dl>
                  )}
                </span>
                <span className="ledger__n">{fmt(c.total)}</span>
              </li>
            ))}
            {data.manual.map((m) => (
              <li key={m.platform} className="ledger__row">
                <span className="ledger__k">{m.label}</span>
                <span className="ledger__v"><span className="row"><SourceChip status={m.source.status} updatedAt={m.source.updatedAt} now={now} />{m.source.note && <span className="muted">{m.source.note}</span>}</span></span>
                <span className="ledger__n">{fmt(m.total)}</span>
              </li>
            ))}
          </ul>
          <p className="muted" style={{ marginTop: 'var(--space-4)' }}>Sources last touched: {data.sources.map((s) => `${s.label} ${ago(s.updatedAt, now)}`).join(' · ')}</p>
        </div>
      </section>

      <Section no="SIM" q="What if?" tone="deep" label="Score simulator">
        <Simulator base={data.inputs} target={data.target} />
      </Section>
    </>
  );
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

function Simulator({ base, target }: { base: ScoreInputs; target: number }) {
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
            <div className="grid-3">
              <Num label="Problems" value={sim[p].problems} onChange={(v) => setRated(p, 'problems', v)} max={100000} />
              <Num label="Rating" value={sim[p].rating} onChange={(v) => setRated(p, 'rating', v)} max={4500} />
              <Num label="Contests" value={sim[p].contests} onChange={(v) => setRated(p, 'contests', v)} max={10000} />
            </div>
          </fieldset>
        ))}
        <fieldset className="fs">
          <legend className="h-sub">Recorded contributions</legend>
          <div className="grid-3">
            {MANUAL.map(([p, label]) => <Num key={p} label={label} value={sim[p]} onChange={(v) => setSim((s) => ({ ...s, [p]: v }))} max={1_000_000} />)}
          </div>
        </fieldset>
        <div className="btn-row"><button className="btn btn--ghost" onClick={() => setSim(base)}>Reset to current</button></div>
      </div>

      <div className="sim__out" aria-live="polite">
        <p className="label">Projected score</p>
        <p className="display-xl fig-2xl">{res ? fmt(res.simulated.overall) : '…'}</p>
        {err && <p className="error-text" role="alert">{err}</p>}
        {res && (
          <>
            <ul className="ledger" style={{ marginTop: 'var(--space-5)' }}>
              <li className="ledger__row"><span className="ledger__k">From current</span><span className="ledger__v" /><span className="ledger__n">{signed(res.delta)}</span></li>
              <li className="ledger__row"><span className="ledger__k">Distance to {fmt(target)}+</span><span className="ledger__v" /><span className="ledger__n">{res.remainingAfter === 0 ? 'REACHED' : fmt(res.remainingAfter)}</span></li>
              <li className="ledger__row"><span className="ledger__k">LeetCode</span><span className="ledger__v" /><span className="ledger__n">{fmt(res.simulated.leetcode.total)}</span></li>
              <li className="ledger__row"><span className="ledger__k">CodeChef</span><span className="ledger__v" /><span className="ledger__n">{fmt(res.simulated.codechef.total)}</span></li>
              <li className="ledger__row"><span className="ledger__k">Codeforces</span><span className="ledger__v" /><span className="ledger__n">{fmt(res.simulated.codeforces.total)}</span></li>
            </ul>
            <h3 className="label" style={{ margin: 'var(--space-6) 0 var(--space-3)' }}>Effect of each change</h3>
            {res.effects.length === 0 ? <p className="serif-lead">Change a value to see its effect.</p> : (
              <ul className="ledger">
                {res.effects.map((e) => (
                  <li key={e.key} className="ledger__row">
                    <span className="ledger__k">{e.label}</span>
                    <span className="ledger__v">{fmt(e.from)} → {fmt(e.to)}</span>
                    <span className="ledger__n">{signed(e.effect)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="serif-lead" style={{ marginTop: 'var(--space-5)' }}>
              <strong>DETERMINISTIC SCORE EFFECT</strong>: what the formula gives for the values above.{' '}
              <strong>UNCERTAIN RATING OUTCOME</strong>: whether a contest moves a rating, and by how much. That is not predicted here.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
