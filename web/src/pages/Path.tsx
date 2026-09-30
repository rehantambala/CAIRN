import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { ManualComponent, RatedComponent, ScoreInputs, Source, Trajectory } from '../api';
import { ago, fmt, longDate, shortK, signed } from '../format';
import { useFetch, useNow } from '../hooks';
import { gradient, STATUS_WORD, statusLine } from '../copy';
import { ErrorBanner, Loading, PageHead, Section, SourceChip, Empty } from '../components/ui';
import { GoalBar } from '../components/score';
import { Bars, LineChart } from '../components/charts';
import { Simulator } from '../components/Simulator';

interface TrajPayload {
  trajectory: Trajectory; series: { day: string; score: number }[]; target: number; targetDate: string | null;
  milestones: { value: number; reached: boolean }[];
  reachability: { current: number; projected: number; gained: number; gap: number; coveredShare: number; stillNeeded: number; fixedShareOfCurrent: number };
}
interface ScorePayload { overall: number; components: RatedComponent[]; manual: ManualComponent[]; inputs: ScoreInputs; target: number; remaining: number; sources: Source[] }
interface Analytics { velocity: { day: string; gain: number }[]; contribution: { label: string; value: number }[] }

export function Path() {
  const traj = useFetch<TrajPayload>('/trajectory');
  const score = useFetch<ScorePayload>('/score');
  const an = useFetch<Analytics>('/analytics');
  const now = useNow(30_000);
  const [open, setOpen] = useState<string | null>(null);
  const err = traj.error ?? score.error;
  if (err) return <ErrorBanner error={err} retry={() => { void traj.reload(); void score.reload(); }} />;
  if (traj.loading || score.loading || !traj.data || !score.data) return <Loading />;
  const d = traj.data, s = score.data, t = d.trajectory;
  const g = gradient(t.current, d.milestones.find((m) => !m.reached)?.value ?? null, t.target);
  const n = (v: number | null, dp = 0) => (v === null ? '—' : v.toFixed(dp));
  const total = (an.data?.contribution ?? []).reduce((a, c) => a + c.value, 0);

  return (
    <>
      <PageHead title="Path" sub={`Your score is ${fmt(t.current)}. ${fmt(t.remaining)} points remain to the target.`}>
        <div style={{ marginTop: 'var(--space-8)' }}>
          <GoalBar current={t.current} target={t.target} milestones={d.milestones.map((m) => m.value)} />
        </div>
        <p className="body" style={{ marginTop: 'var(--space-8)' }}>{g.near} {g.far}</p>
      </PageHead>

      <Section kicker="Pace" tone="deep">
        <h2 className="statement statement--wide">{STATUS_WORD[t.status] ?? t.status}.</h2>
        <p className="body" style={{ marginTop: 'var(--space-4)' }}>{statusLine(t.status, t.historyDays)}</p>
        <div className="grid-3" style={{ marginTop: 'var(--space-9)' }}>
          <div>
            <p className="kicker">Recent rate of gain</p>
            <p className="display fig-2xl" style={{ marginTop: 'var(--space-4)' }}>{t.velocity === null ? '—' : n(t.velocity, 1)}<span className="unit"> a day</span></p>
            {t.velocity === null && <p className="small" style={{ marginTop: 'var(--space-2)' }}>Seven days of history are required.</p>}
          </div>
          <div>
            <p className="kicker">Rate the target date requires</p>
            <p className="display fig-2xl" style={{ marginTop: 'var(--space-4)' }}>{t.requiredVelocity === null ? '—' : n(t.requiredVelocity, 1)}<span className="unit"> a day</span></p>
            {!d.targetDate && <p className="small" style={{ marginTop: 'var(--space-2)' }}><Link to="/settings">Set a target date</Link> so that this can be measured.</p>}
          </div>
          <div>
            <p className="kicker">Projected arrival at the recent rate</p>
            <p className="display fig-xl" style={{ marginTop: 'var(--space-4)' }}>{t.projectedDate ? longDate(t.projectedDate) : '—'}</p>
            <p className="small" style={{ marginTop: 'var(--space-2)' }}>A projection, not a commitment.</p>
          </div>
        </div>
        <ul className="ledger" style={{ marginTop: 'var(--space-9)' }}>
          {([['Yesterday', t.gain1], ['Last 7 days', t.gain7], ['Last 14 days', t.gain14], ['Last 30 days', t.gain30]] as const).map(([k, v]) => (
            <li key={k} className="ledger__row"><span className="ledger__k">{k}</span><span className="ledger__v">{v === null ? 'Insufficient history' : ''}</span><span className="ledger__n">{v === null ? '—' : signed(v)}</span></li>
          ))}
        </ul>
        {an.data && an.data.velocity.length >= 2 && (
          <div style={{ marginTop: 'var(--space-8)' }}>
            <p className="kicker" style={{ marginBottom: 'var(--space-4)' }}>Daily change</p>
            <Bars data={an.data.velocity.map((v) => ({ k: v.day.slice(5), v: v.gain }))} />
          </div>
        )}
      </Section>

      <Section kicker="Score history">
        {d.series.length < 2
          ? <Empty title="History begins today">A chart appears once the score has more than one day of history. Nothing is back-filled.</Empty>
          : <LineChart points={d.series.map((p) => ({ x: p.day, y: p.score }))} />}
        <ul className="ledger" style={{ marginTop: 'var(--space-8)' }}>
          {d.milestones.map((m) => (
            <li key={m.value} className="ledger__row">
              <span className="ledger__k">{shortK(m.value)}</span>
              <span className="ledger__v">{m.value === 25000 ? 'The minimum target. Tracking continues beyond it.' : ''}</span>
              <span className="state">{m.reached ? '✓ Reached' : `${fmt(m.value - t.current)} points remain`}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section kicker="Where your points come from" tone="deep">
        <h2 className="statement statement--wide">
          {d.reachability.fixedShareOfCurrent > 0.5
            ? `${Math.round(d.reachability.fixedShareOfCurrent * 100)} per cent of your score rests on Smart Interviews, InterviewBit and HackerRank.`
            : 'Ratings carry the greatest effect, because the rating term is squared.'}
        </h2>
        <p className="body" style={{ marginTop: 'var(--space-4)' }}>VECTOR records those three but does not model them, so you enter their figures in Settings.</p>
        <ul className="ledger" style={{ marginTop: 'var(--space-8)' }}>
          {(an.data?.contribution ?? []).map((c) => (
            <li key={c.label} className="ledger__row">
              <span className="ledger__k">{c.label}</span>
              <span className="ledger__v"><span className="bar" style={{ width: `${Math.max(1, (c.value / Math.max(1, total)) * 100)}%` }} aria-hidden="true" /></span>
              <span className="ledger__n">{fmt(c.value)}</span>
            </li>
          ))}
        </ul>
        <ul className="ledger" style={{ marginTop: 'var(--space-9)' }}>
          {s.components.map((c) => (
            <li key={c.platform} className="ledger__row">
              <span className="ledger__k">{c.label}</span>
              <span className="ledger__v">
                <button className="link-btn" aria-expanded={open === c.platform} onClick={() => setOpen(open === c.platform ? null : c.platform)}>
                  {c.problems} problems · rating {c.rating} · {c.contests} contests
                </button>
                <span className="row" style={{ marginTop: 'var(--space-2)' }}><SourceChip status={c.source.status} updatedAt={c.source.updatedAt} now={now} /></span>
                {open === c.platform && (
                  <dl className="parts">
                    <div><dt>From problems</dt><dd>{fmt(c.parts.problems)}</dd></div>
                    <div><dt>From rating</dt><dd>{fmt(c.parts.rating)}</dd></div>
                    <div><dt>From contests</dt><dd>{fmt(c.parts.contests)}</dd></div>
                    <div><dt>A rise of 25 in rating adds</dt><dd>{signed(c.marginal.ratingPlus25)}</dd></div>
                    <div><dt>A rise of 100 in rating adds</dt><dd>{signed(c.marginal.ratingPlus100)}</dd></div>
                    {c.marginal.ratingToThreshold > 0 && <div><dt>Rating points before gains begin to score</dt><dd>{c.marginal.ratingToThreshold}</dd></div>}
                  </dl>
                )}
              </span>
              <span className="ledger__n">{fmt(c.total)}</span>
            </li>
          ))}
          {s.manual.map((m) => (
            <li key={m.platform} className="ledger__row">
              <span className="ledger__k">{m.label}</span>
              <span className="ledger__v"><SourceChip status={m.source.status} updatedAt={m.source.updatedAt} now={now} /></span>
              <span className="ledger__n">{fmt(m.total)}</span>
            </li>
          ))}
        </ul>
        <p className="small" style={{ marginTop: 'var(--space-4)' }}>Most recent updates: {s.sources.map((x) => `${x.label} ${ago(x.updatedAt, now)}`).join(' · ')}</p>
      </Section>

      <Section kicker="Scenario">
        <h2 className="statement statement--wide">Change a figure to see its effect on the score.</h2>
        <div style={{ marginTop: 'var(--space-9)' }}><Simulator base={s.inputs} target={s.target} /></div>
      </Section>

      <Section kicker="Closing the gap" tone="ink">
        <div className="grid-2">
          <div>
            <p className="lead">Were your ratings to reach 1570, 1400 and 920, your score would be</p>
            <p className="display fig-hero mark" style={{ marginTop: 'var(--space-5)' }}>{fmt(d.reachability.projected)}</p>
          </div>
          <div style={{ alignSelf: 'end' }}>
            <p className="body">That would cover {Math.round(d.reachability.coveredShare * 100)} per cent of the remaining {fmt(d.reachability.gap)} points. It is a scenario, not a forecast: whether those ratings are reached is the uncertain element.</p>
          </div>
        </div>
      </Section>

      <Section kicker="The formula" tone="deep">
        <details className="formula">
          <summary>Show how the score is calculated</summary>
          <div className="stack" style={{ marginTop: 'var(--space-5)' }}>
            <p className="lead"><strong>LeetCode</strong> = problems × 10 + (max(0, rating − 1300))² ÷ 10 + contests × 50</p>
            <p className="lead"><strong>CodeChef</strong> = problems × 2 + (max(0, rating − 1200))² ÷ 10 + contests × 50</p>
            <p className="lead"><strong>Codeforces</strong> = problems × 2 + (max(0, rating − 800))² ÷ 10 + contests × 50</p>
            <p className="body">Each platform total is rounded down. The rating term is zero at or below its baseline. Smart Interviews, InterviewBit and HackerRank are added as entered.</p>
          </div>
        </details>
      </Section>
    </>
  );
}
