import { Link } from 'react-router-dom';
import type { Trajectory as T } from '../api';
import { fmt, longDate, shortK, signed } from '../format';
import { useFetch } from '../hooks';
import { ErrorBanner, Loading, PageHead, Section, Empty } from '../components/ui';
import { Milestones } from '../components/score';

interface Payload {
  trajectory: T; series: { day: string; score: number }[]; target: number; targetDate: string | null;
  milestones: { value: number; reached: boolean }[];
  reachability: { current: number; projected: number; gained: number; gap: number; coveredShare: number; stillNeeded: number; fixedShareOfCurrent: number };
}

export function Trajectory() {
  const { data: d, error, loading, reload } = useFetch<Payload>('/trajectory');
  if (loading) return <Loading />;
  if (error || !d) return <ErrorBanner error={error ?? new Error('NO_DATA')} retry={reload} />;
  const t = d.trajectory;
  const n = (v: number | null, dp = 0) => (v === null ? '—' : v.toFixed(dp));

  return (
    <>
      <PageHead title="Trajectory" sub={t.note} />
      <section className="section block block-pink" aria-label="Position">
        <div className="frame">
          <div className="grid-3">
            <div><p className="label">Current</p><p className="display-xl fig-2xl">{fmt(t.current)}</p></div>
            <div><p className="label">Target</p><p className="display-xl fig-2xl">{fmt(t.target)}<span className="mark">+</span></p></div>
            <div><p className="label">Remaining</p><p className="display-xl fig-2xl">{fmt(t.remaining)}</p></div>
          </div>
          <div className="traj-state">
            <p className="label">Status</p>
            <p className="display-xl fig-xl">{t.status}</p>
          </div>
        </div>
      </section>

      <Section no="01" q="How fast?" label="Velocity">
        <div className="grid-3">
          <div><p className="label">Recent velocity</p><p className="display-xl fig-xl">{t.velocity === null ? 'INSUFFICIENT DATA' : `${n(t.velocity, 1)} / day`}</p></div>
          <div><p className="label">Required velocity</p><p className="display-xl fig-xl">{t.requiredVelocity === null ? (d.targetDate ? '—' : 'SET A DATE') : `${n(t.requiredVelocity, 1)} / day`}</p>
            {!d.targetDate && <p className="muted" style={{ marginTop: 'var(--space-2)' }}><Link to="/settings">Set a target date</Link> to measure pace.</p>}</div>
          <div><p className="label">Projected at recent pace</p><p className="display-xl fig-xl">{t.projectedDate ? longDate(t.projectedDate) : '—'}</p>
            <p className="muted" style={{ marginTop: 'var(--space-2)' }}>A projection, never a guarantee.</p></div>
        </div>
        <ul className="ledger" style={{ marginTop: 'var(--space-8)' }}>
          {([['1 day', t.gain1], ['7 days', t.gain7], ['14 days', t.gain14], ['30 days', t.gain30]] as const).map(([k, v]) => (
            <li key={k} className="ledger__row"><span className="ledger__k">Gain · {k}</span><span className="ledger__v muted">{v === null ? 'INSUFFICIENT DATA' : ''}</span><span className="ledger__n">{v === null ? '—' : signed(v)}</span></li>
          ))}
        </ul>
        <p className="muted" style={{ marginTop: 'var(--space-3)' }}>Velocity is a trimmed mean of daily gains over the last 14 days, so one large jump cannot set the pace. History: {t.historyDays} day{t.historyDays === 1 ? '' : 's'}.</p>
      </Section>

      <Section no="02" q="How close?" tone="deep" label="Milestones">
        <Milestones current={t.current} list={d.milestones.map((m) => m.value)} />
        <ul className="ledger" style={{ marginTop: 'var(--space-8)' }}>
          {d.milestones.map((m) => (
            <li key={m.value} className="ledger__row"><span className="ledger__k">{shortK(m.value)}</span><span className="ledger__v muted">{m.value === 25000 ? 'Minimum threshold. Tracking continues beyond it.' : ''}</span><span className="state-tag">{m.reached ? 'REACHED' : `${fmt(m.value - t.current)} TO GO`}</span></li>
          ))}
        </ul>
      </Section>

      <Section no="03" q="What does the actual line look like?" label="Score history">
        {d.series.length < 2
          ? <Empty title="INSUFFICIENT DATA">The line appears once snapshots span more than one day. Nothing is back-filled.</Empty>
          : <LineChart points={d.series.map((s) => ({ x: s.day, y: s.score }))} />}
      </Section>

      <Section no="04" q="What could close the gap?" tone="ink" label="Reachability">
        <div className="grid-2">
          <div>
            <p className="label">If ratings reach 1570 · 1400 · 920</p>
            <p className="display-xl fig-2xl mark">{fmt(d.reachability.projected)}</p>
            <p className="serif-lead">Hypothetical and deterministic. Whether those ratings are reached is uncertain.</p>
          </div>
          <div>
            <p className="serif-lead">
              That would cover {Math.round(d.reachability.coveredShare * 100)}% of the remaining {fmt(d.reachability.gap)}.
              {' '}{Math.round(d.reachability.fixedShareOfCurrent * 100)}% of today’s score is recorded from Smart Interviews, InterviewBit and HackerRank; growth there changes the picture and is entered manually.
            </p>
            <div className="btn-row" style={{ marginTop: 'var(--space-5)' }}><Link to="/score" className="btn">Open simulator</Link></div>
          </div>
        </div>
      </Section>
    </>
  );
}

export function LineChart({ points }: { points: { x: string; y: number }[] }) {
  const W = 960, H = 320, P = 40;
  const ys = points.map((p) => p.y);
  const min = Math.min(...ys), max = Math.max(...ys);
  const span = Math.max(1, max - min);
  const X = (i: number) => P + (i / Math.max(1, points.length - 1)) * (W - 2 * P);
  const Y = (v: number) => H - P - ((v - min) / span) * (H - 2 * P);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Score from ${fmt(points[0].y)} to ${fmt(last.y)} over ${points.length} days`} className="chart">
        <line x1={P} y1={H - P} x2={W - P} y2={H - P} stroke="currentColor" strokeWidth="1" />
        <path d={d} fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
        <circle cx={X(points.length - 1)} cy={Y(last.y)} r="7" fill="var(--color-accent)" stroke="currentColor" strokeWidth="2" />
        <text x={P} y={20} fontSize="16" fill="currentColor">{fmt(max)}</text>
        <text x={P} y={H - 12} fontSize="16" fill="currentColor">{fmt(min)}</text>
        <text x={W - P} y={H - 12} fontSize="16" fill="currentColor" textAnchor="end">{last.x}</text>
      </svg>
    </figure>
  );
}
