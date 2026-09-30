import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import type { Item, Next } from '../api';
import { countdown, fmt, shortK } from '../format';
import { useCountTo } from '../hooks';
import { doneHeadline } from '../copy';

export function ScoreFigure({ value, className = 'fig-hero' }: { value: number; className?: string }) {
  const shown = useCountTo(value);
  return <span className={`display ${className}`} aria-label={fmt(value)}>{fmt(shown)}</span>;
}

/** Announces a material score change via a polite live region. */
export function ScoreAnnouncer({ value }: { value: number }) {
  const prev = useRef(value);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (prev.current !== value && ref.current) {
      const d = value - prev.current;
      ref.current.textContent = `The score is ${fmt(value)}, a change of ${d >= 0 ? 'plus' : 'minus'} ${Math.abs(d)}.`;
    }
    prev.current = value;
  }, [value]);
  return <div ref={ref} className="sr-only" role="status" aria-live="polite" aria-atomic="true" />;
}

/** Progress from zero to the target, with the milestones as ticks. Fill is the true ratio. */
export function GoalBar({ current, target, milestones }: { current: number; target: number; milestones: number[] }) {
  const pct = Math.min(100, (current / target) * 100);
  return (
    <div role="img" aria-label={`${fmt(current)} of ${fmt(target)}. ${Math.floor(pct)} per cent.`}>
      <div className="gbar" aria-hidden="true">
        <div className="gbar__fill" style={{ width: `${pct}%` }} />
        {milestones.map((m) => <span key={m} className={`gbar__tick${m >= target ? ' is-target' : ''}`} style={{ left: `${Math.min(100, (m / target) * 100)}%` }} />)}
      </div>
      <div className="gbar__labels" aria-hidden="true">
        {milestones.map((m) => <span key={m} style={{ left: `${Math.min(100, (m / target) * 100)}%` }} className={m >= target ? 'mark' : ''}>{shortK(m)}</span>)}
      </div>
    </div>
  );
}

export function Pips({ total, on }: { total: number; on: number }) {
  return (
    <span className="pips" aria-hidden="true">
      {Array.from({ length: Math.min(total, 12) }, (_, i) => <span key={i} className={`pip${i < on ? ' is-on' : ''}`} />)}
    </span>
  );
}

export function NextBlock({ next, items, delta, now, fetchedAt }: { next: Next; items: Item[]; delta: number; now: number; fetchedAt: number }) {
  const left = next.startsInMs !== null ? Math.max(0, next.startsInMs - (now - fetchedAt)) : null;
  const isContest = next.kind === 'CONTEST' || next.kind === 'COMMIT';
  const complete = next.kind === 'COMPLETE';
  const firstOpen = items.find((i) => !i.completed && i.type === 'PROBLEM_QUOTA' && i.suggestions.length > 0);
  const url = firstOpen?.suggestions[0]?.url ?? firstOpen?.practiceUrl ?? null;
  const headline = (next.target ?? next.title).replace(/^Begin with\s+/i, '').replace(/^Solve\s+/i, '');

  if (complete) {
    return (
      <div className="next next--done">
        <p className="kicker">Next action</p>
        <h2 className="display fig-2xl next__done">{doneHeadline(delta, true)}</h2>
        <p className="lead">{next.reason}</p>
        <div className="btn-row" style={{ marginTop: 'var(--space-8)' }}>
          <Link to="/log" className="btn btn--big">Open the log</Link>
          <Link to="/path" className="btn btn--ghost btn--big">Open the path</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="next">
      <p className="kicker">Next action</p>
      {isContest && left !== null && left > 0 ? (
        <>
          <p className="lead next__pre">{next.title} begins in</p>
          <p className="display fig-hero mark next__count" aria-label={`Begins in ${countdown(left)}`}>{countdown(left)}</p>
        </>
      ) : (
        <h2 className="statement statement--wide next__title">{headline}</h2>
      )}
      {!isContest && <p className="body next__detail">{next.detail}{next.target ? ` · ${next.title}` : ''}</p>}
      <p className="lead next__why">{next.reason}</p>
      <div className="btn-row" style={{ marginTop: 'var(--space-8)' }}>
        {isContest
          ? <Link to={next.href} className="btn btn--big">Open the contest</Link>
          : url
            ? <a href={url} target="_blank" rel="noreferrer noopener" className="btn btn--big">Begin now<span className="sr-only"> (opens in a new tab)</span></a>
            : <Link to={next.href} className="btn btn--big">Open today’s list</Link>}
        {!isContest && <a href="#today-list" className="link-arrow">View the full list</a>}
      </div>
    </div>
  );
}
