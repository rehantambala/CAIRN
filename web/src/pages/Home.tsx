import { Link } from 'react-router-dom';
import type { Overview } from '../api';
import { ago, fmt, longDate, signed, tzTime } from '../format';
import { useFetch, useNow } from '../hooks';
import { ErrorBanner, Loading, Section, SourceChip, Empty } from '../components/ui';
import { ItemLine, Milestones, NextBlock, ScoreAnnouncer, ScoreFigure } from '../components/score';
import { AWARD_META } from '../awardMeta';

export function Home() {
  const { data: o, error, loading, reload } = useFetch<Overview>('/overview');
  const now = useNow(15_000);
  if (loading) return <Loading />;
  if (error || !o) return <ErrorBanner error={error ?? new Error('NO_DATA')} retry={reload} />;
  const fetchedAt = new Date(o.now).getTime();
  const t = o.trajectory;
  const tz = o.user.timezone;

  return (
    <>
      <ScoreAnnouncer value={o.score.overall} />

      {/* 01 + 02: the first viewport. Typography only; nothing competes with the score. */}
      <section className="hero block block-pink" aria-label="Current score and objective">
        <div className="frame hero__grid">
          <div className="hero__score enter">
            <p className="label">Current score</p>
            <h1 className="hero__h1"><ScoreFigure value={o.score.overall} /></h1>
          </div>
          <div className="hero__side">
            <div className="enter" style={{ animationDelay: '0.12s' }}>
              <p className="label">Target</p>
              <p className="display-xl fig-2xl">{fmt(o.target)}<span className="mark">+</span></p>
            </div>
            <div className="enter" style={{ animationDelay: '0.24s' }}>
              <p className="label">Remaining</p>
              <p className="display-xl fig-2xl">{fmt(o.remaining)}</p>
            </div>
          </div>
        </div>
        <div className="frame hero__traj enter" style={{ animationDelay: '0.36s' }}>
          <p className="label">Trajectory</p>
          <p className="hero__status"><span className="display-xl fig-lg">{t.status}</span> <span className="muted">{t.note}</span></p>
        </div>
      </section>

      <Section no="03" q="What is next?" tone="ink" label="Next action">
        <NextBlock next={o.next} now={now} fetchedAt={fetchedAt} />
      </Section>

      <Section no="04" q="What happens today?" label="Today's execution">
        <div className="grid-2 grid-2--asym-r">
          <div>
            <h2 className="h-section">Today’s execution</h2>
            <p className="label" style={{ marginTop: 'var(--space-4)' }}>{longDate(o.date)}</p>
            {o.today.targetScoreDelta > 0 && (
              <p className="serif-lead" style={{ marginTop: 'var(--space-5)' }}>
                Deterministic score in this objective: <strong>{signed(o.today.targetScoreDelta)}</strong>. Rating movement is not included because it is uncertain.
              </p>
            )}
            <div className="btn-row" style={{ marginTop: 'var(--space-6)' }}><Link to="/today" className="btn btn--ghost">Open today</Link></div>
          </div>
          <div>
            {o.today.items.length === 0
              ? <Empty title="No objective items">No required work and no contest today.</Empty>
              : <ol className="tlist">{o.today.items.map((it, i) => <ItemLine key={it.id} item={it} index={i} />)}</ol>}
          </div>
        </div>
      </Section>

      <Section no="05" q="What changed?" tone="deep" label="Recent verified changes">
        {o.changes.length === 0
          ? <Empty title="No recorded changes yet">Verified events appear here as platforms sync.</Empty>
          : (
            <ul className="ledger">
              {o.changes.map((c, i) => (
                <li key={i} className="ledger__row">
                  <span className="ledger__k">{ago(c.at, now)}</span>
                  <span className="ledger__v">{c.text}</span>
                  <span />
                </li>
              ))}
            </ul>
          )}
        <h3 className="label" style={{ margin: 'var(--space-9) 0 var(--space-4)' }}>Sources</h3>
        <ul className="ledger">
          {o.sources.map((s) => (
            <li key={s.platform} className="ledger__row">
              <span className="ledger__k">{s.label}</span>
              <span className="ledger__v muted">{s.note ?? ''}</span>
              <SourceChip status={s.status} updatedAt={s.updatedAt} now={now} />
            </li>
          ))}
        </ul>
      </Section>

      <Section no="06" q="How consistent am I?" label="Consistency">
        <ConsistencyBlock c={o.consistency} />
      </Section>

      <Section no="07" q="What have I earned?" label="Awards">
        {o.awards.length === 0
          ? <Empty title="No awards yet">Awards are earned from measured milestones: verified days, rated contests, problems, ratings.</Empty>
          : (
            <ul className="awards awards--earned">
              {o.awards.map((k) => <AwardFigure key={k} k={k} earned />)}
            </ul>
          )}
        <div className="btn-row" style={{ marginTop: 'var(--space-6)' }}><Link to="/awards" className="btn btn--ghost">All awards</Link></div>
      </Section>

      <Section no="08" q="How close am I to 25K+?" tone="pink" label="Trajectory to 25,000 plus">
        <Milestones current={o.score.overall} list={o.milestones.list} />
        <div className="grid-2" style={{ marginTop: 'var(--space-9)' }}>
          <p className="serif-lead">
            {o.reachability.fixedShareOfCurrent > 0.5
              ? `${Math.round(o.reachability.fixedShareOfCurrent * 100)}% of the current score comes from Smart Interviews, InterviewBit and HackerRank, which this instrument records but does not model.`
              : 'Ratings carry the largest score effect because the rating term is squared.'}
          </p>
          <div className="btn-row" style={{ alignSelf: 'end' }}>
            <Link to="/trajectory" className="btn">Trajectory</Link>
            <Link to="/score" className="btn btn--ghost">Score simulator</Link>
          </div>
        </div>
      </Section>
    </>
  );
}

export function ConsistencyBlock({ c }: { c: Overview['consistency'] }) {
  const pct = (v: number | null) => (v === null ? 'INSUFFICIENT DATA' : `${v}%`);
  return (
    <div className="stack-lg">
      <div className="grid-3">
        {([['Execution rate', c.executionRate], ['Weekly objective completion', c.weeklyCompletion], ['Contest attendance', c.contestAttendance]] as const).map(([k, v]) => (
          <div key={k}>
            <p className="label">{k}</p>
            <p className={`display-xl ${v === null ? 'fig-lg' : 'fig-2xl'}`} style={{ marginTop: 'var(--space-3)' }}>{pct(v)}</p>
          </div>
        ))}
      </div>
      <div className="grid-3">
        <div><p className="label">Planned sessions</p><p className="display-xl fig-xl">{c.plannedSessions}</p></div>
        <div><p className="label">Completed</p><p className="display-xl fig-xl">{c.completedSessions}</p></div>
        <div><p className="label">Consecutive complete days</p><p className="display-xl fig-xl">{c.consecutiveComplete}</p></div>
      </div>
      <div className="grid-2">
        <div>
          <p className="label">Primary bottleneck</p>
          {c.bottleneck
            ? <p className="serif-lead">Most missed execution windows occur between {c.bottleneck.window}.</p>
            : <p className="serif-lead">INSUFFICIENT DATA. A pattern is named only after at least three missed committed windows cluster together.</p>}
        </div>
        {c.recommendation && <div><p className="label">Recommendation</p><p className="serif-lead">{c.recommendation}</p></div>}
      </div>
    </div>
  );
}

export function AwardFigure({ k, earned }: { k: string; earned: boolean }) {
  const m = AWARD_META[k];
  if (!m) return null;
  return (
    <li className={`award${earned ? ' is-earned' : ''}`}>
      <span className="display-xl award__fig">{m.figure}</span>
      <span className="award__unit label">{m.unit}</span>
      <span className="award__title">{m.title}</span>
      <span className="state-tag">{earned ? 'EARNED' : 'NOT YET'}</span>
    </li>
  );
}

void tzTime;
