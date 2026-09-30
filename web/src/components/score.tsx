import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import type { Next, Item, Overview } from '../api';
import { countdown, fmt, shortK } from '../format';
import { useCountTo, useNow } from '../hooks';

export function ScoreFigure({ value, className = 'fig-hero' }: { value: number; className?: string }) {
  const shown = useCountTo(value);
  return <span className={`display-xl ${className}`} aria-label={fmt(value)}>{fmt(shown)}</span>;
}

/** Announces a material score change via a polite live region. */
export function ScoreAnnouncer({ value }: { value: number }) {
  const prev = useRef(value);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (prev.current !== value && ref.current) {
      const d = value - prev.current;
      ref.current.textContent = `Score ${fmt(value)}, ${d >= 0 ? 'plus' : 'minus'} ${Math.abs(d)}`;
    }
    prev.current = value;
  }, [value]);
  return <div ref={ref} className="sr-only" role="status" aria-live="polite" aria-atomic="true" />;
}

/**
 * Movement through the target: large milestone numerals on one line, filled up to the current score.
 * Positions are even between milestones; the marker is interpolated inside its segment.
 */
export function Milestones({ current, list }: { current: number; list: number[] }) {
  const points = [current < list[0] ? current : list[0], ...list];
  const start = Math.min(current, list[0]);
  const stops = [start, ...list];
  let idx = 0;
  while (idx < stops.length - 1 && current >= stops[idx + 1]) idx++;
  const a = stops[idx], b = stops[idx + 1] ?? a;
  const frac = b === a ? 1 : (current - a) / (b - a);
  const pos = ((idx + frac) / (stops.length - 1)) * 100;
  void points;
  return (
    <div className="ms" role="img" aria-label={`${fmt(current)} of 25,000 plus. Next milestone ${shortK(list.find((m) => m > current) ?? 25000)}.`}>
      <div className="ms__track" aria-hidden="true">
        <div className="ms__fill" style={{ width: `${pos}%` }} />
        <div className="ms__dot" style={{ left: `${pos}%` }} />
      </div>
      <ol className="ms__list" aria-hidden="true">
        {stops.map((m, i) => (
          <li key={m} className={`ms__item${current >= m && i > 0 ? ' is-reached' : ''}${i === 0 ? ' is-current' : ''}${i === stops.length - 1 ? ' is-target' : ''}`}>
            <span className="display-xl ms__num">{i === 0 ? fmt(m) : shortK(m)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function NextBlock({ next, now, fetchedAt }: { next: Next; now: number; fetchedAt: number }) {
  const left = next.startsInMs !== null ? Math.max(0, next.startsInMs - (now - fetchedAt)) : null;
  const live = next.kind === 'CONTEST' && next.startsInMs === 0;
  return (
    <div className="next">
      <p className="label next__label">NEXT</p>
      <h3 className="display-xl next__title">{next.title}</h3>
      <p className="next__detail">
        {next.kind === 'CONTEST' && !live && left !== null
          ? <>Rated contest · starts in <span className="mark">{countdown(left)}</span></>
          : next.detail}
      </p>
      {next.target && <p className="next__target"><span className="label">Target</span> {next.target}</p>}
      <div className="next__why">
        <p className="label">Why this is next</p>
        <p className="serif-lead">{next.reason}</p>
      </div>
      <div className="btn-row" style={{ marginTop: 'var(--space-6)' }}>
        <Link to={next.href} className="btn">{next.kind === 'CONTEST' || next.kind === 'COMMIT' ? 'Open contest' : next.kind === 'COMPLETE' ? 'View calendar' : 'Open today'}</Link>
      </div>
    </div>
  );
}

export function ItemLine({ item, index }: { item: Item; index: number }) {
  const done = item.completed;
  const status = done ? (item.verification === 'VERIFIED' ? 'VERIFIED' : 'MANUAL') : item.verification === 'PENDING' && item.completedCount > 0 ? 'IN PROGRESS' : 'OPEN';
  const what = item.type === 'PROBLEM_QUOTA' ? `${item.quota} selected problem${item.quota === 1 ? '' : 's'}` : item.type === 'CONTEST' ? 'Rated contest' : item.type === 'CONTEST_PREP' ? `Preparation · ${item.minutes} min` : 'Rest';
  return (
    <li className={`tline${done ? ' is-done' : ''}`}>
      <span className="tline__no display-xl" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
      <div className="tline__body">
        <p className="tline__plat">{item.type === 'CONTEST' ? item.title : item.platform ? item.title : item.title}</p>
        <p className="tline__what">{what}</p>
        {!item.required && item.type !== 'REST' && <p className="muted">Optional</p>}
      </div>
      <div className="tline__state">
        <span className="tline__mark" aria-hidden="true">{done ? '✓' : '○'}</span>
        <span className="state-tag">{status}</span>
        {item.type === 'PROBLEM_QUOTA' && <span className="muted">{item.completedCount} of {item.quota}</span>}
      </div>
    </li>
  );
}

export function sourceSummary(o: Overview) {
  return o.sources.filter((s) => ['leetcode', 'codechef', 'codeforces', 'smartinterviews'].includes(s.platform));
}

export function useTicker() { return useNow(15_000); }
