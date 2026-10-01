import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DayState, Overview, Strategist } from '../api';
import { ago, fmt, signed } from '../format';
import { useFetch, useNow } from '../hooks';
import { dayLine, dayMood, gradient, greetingWord, streakHead, streakLine, STATUS_WORD, statusLine } from '../copy';
import { ErrorBanner, Loading, Section, SourceChip, Empty } from '../components/ui';
import { GoalBar, NextBlock, ScoreAnnouncer, ScoreFigure } from '../components/score';
import { TodayItem } from '../components/TodayItem';
import { Contours } from '../components/Contours';
import { Yield } from '../components/Yield';

interface CalDay { date: string; state: DayState; verified: boolean }
interface Cal { today: string; days: CalDay[] }

/** The freshest automatic reading, stated plainly. Never implies liveness the data does not have. */
function readingLine(sources: Overview['sources'], now: number) {
  const auto = sources.filter((s) => s.capability === 'AUTOMATIC' && s.username && s.updatedAt && s.status !== 'ERROR');
  if (auto.length === 0) return 'No platform is connected. Connect one in Preferences to read your figures automatically.';
  const newest = auto.reduce((a, b) => (new Date(a.updatedAt!).getTime() > new Date(b.updatedAt!).getTime() ? a : b));
  return `${auto.length} of 3 platforms read automatically. Latest reading ${ago(newest.updatedAt!, now)}.`;
}

const hourIn = (tz: string) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));

function lastSeven(today: string, days: CalDay[]) {
  const by = new Map(days.map((d) => [d.date, d]));
  const out: { date: string; state: DayState | 'NONE'; verified: boolean }[] = [];
  const [y, m, d] = today.split('-').map(Number);
  for (let i = 6; i >= 0; i--) {
    const k = new Date(Date.UTC(y, m - 1, d - i)).toISOString().slice(0, 10);
    const r = by.get(k);
    out.push({ date: k, state: r?.state ?? 'NONE', verified: r?.verified ?? false });
  }
  return out;
}

export function Today() {
  const { data: o, error, loading, reload } = useFetch<Overview>('/overview');
  const { data: cal } = useFetch<Cal>('/calendar');
  const now = useNow(15_000);
  const fetchedAt = useMemo(() => Date.now(), [o]); // eslint-disable-line react-hooks/exhaustive-deps
  if (loading) return <Loading />;
  if (error || !o) return <ErrorBanner error={error ?? new Error('NO_DATA')} retry={reload} />;

  const t = o.trajectory;
  const required = o.today.items.filter((i) => i.required);
  const done = required.filter((i) => i.completed).length;
  const contestSoon = o.upcomingContests.find((c) => c.committed && c.startAt > Date.now());
  const ctx = {
    date: o.date, hour: hourIn(o.user.timezone), done, total: required.length, streak: o.consistency.consecutiveComplete,
    isRest: o.today.isRest, allVerified: required.every((i) => i.verification === 'VERIFIED'),
    contestSoonMs: contestSoon ? contestSoon.startAt - Date.now() : null,
  };
  const g = gradient(o.score.overall, o.milestones.next, o.target);
  const autoSet = new Set(o.sources.filter((s) => s.capability === 'AUTOMATIC' && s.username).map((s) => s.platform as string));
  const week = cal ? lastSeven(cal.today, cal.days) : [];
  const dayDone = dayMood(ctx) === 'done' || dayMood(ctx) === 'manual';
  if (o.knownSources.length === 0) return <Welcome o={o} />;

  return (
    <>
      <ScoreAnnouncer value={o.score.overall} />

      <section className="hero block block-sky" aria-label="Your score">
        <Contours />
        <div className="frame">
          <p className="kicker enter">{greetingWord(ctx.hour)}{o.user.displayName && o.user.displayName !== 'Owner' ? `, ${o.user.displayName}` : ''}</p>
          <p className="lead hero__line enter" style={{ animationDelay: '0.08s' }}>{dayLine(ctx)}</p>
          <div className="hero__grid">
            <h1 className="hero__score enter" style={{ animationDelay: '0.16s' }}><ScoreFigure value={o.score.overall} /></h1>
            <div className="hero__meta enter" style={{ animationDelay: '0.28s' }}>
              <p className="statement hero__to">{g.near}</p>
              <p className="body">{g.far}</p>
            </div>
          </div>
          <div className="hero__bar enter" style={{ animationDelay: '0.4s' }}>
            <GoalBar current={o.score.overall} target={o.target} milestones={o.milestones.list} />
          </div>
          <p className="pulse enter" style={{ animationDelay: '0.55s' }}><span className="pulse__dot" aria-hidden="true" />{readingLine(o.sources, now)}</p>
        </div>
      </section>

      <section className="block block-ink next-wrap" aria-label="Next action">
        <div className="frame"><NextBlock next={o.next} items={o.today.items} delta={o.today.targetScoreDelta} now={now} fetchedAt={fetchedAt} /></div>
      </section>

      <Counsel />

      <Section kicker={dayDone ? 'Today · complete' : 'Today’s objective'} id="today-list">
        <div className="tday-head">
          <h2 className="statement">{o.today.isRest ? 'A scheduled rest day.' : dayDone ? 'Every required item is complete.' : `${required.length - done} required ${required.length - done === 1 ? 'item remains' : 'items remain'}.`}</h2>
          {dayDone && o.today.targetScoreDelta > 0 && (
            <p className="body">Today’s work was worth <span className="strong">{signed(o.today.targetScoreDelta)}</span> points, all of them certain. Rating changes cannot be promised, so they are excluded from this figure.</p>
          )}
        </div>
        {!dayDone && !o.today.isRest && <Yield brief={o.brief} tz={o.user.timezone} now={now} streak={o.consistency.consecutiveComplete} />}
        {o.today.items.length === 0
          ? <Empty title="No work scheduled">No work is required and no contest falls today. Add problems to the pool or synchronise a platform.</Empty>
          : <ol className="qlist">{o.today.items.map((it, i) => <TodayItem key={it.id} item={it} index={i} onChange={reload} auto={autoSet.has(it.platform ?? '')} current={!it.completed && i === o.today.items.findIndex((x) => !x.completed)} />)}</ol>}
        <p style={{ marginTop: 'var(--space-8)' }}><Link to="/practice" className="link-arrow">Browse the problem pool</Link></p>
      </Section>

      <Section kicker="The past seven days" tone="deep">
        <div className="week">
          <div>
            <p className="statement">{streakHead(ctx.streak)}</p>
            <p className="body" style={{ marginTop: 'var(--space-4)' }}>{streakLine(ctx.streak)}{' '}
              {o.consistency.executionRate === null
                ? 'Execution rate and contest attendance are shown once a week of history exists.'
                : `${o.consistency.executionRate} per cent of planned sessions were completed. The weekly objective stands at ${o.consistency.weeklyCompletion ?? 0} per cent.`}
            </p>
          </div>
          <ol className="wk" aria-label="Last seven days">
            {week.map((d) => (
              <li key={d.date} className={`wk__d wk__d--${d.state.toLowerCase()}`}>
                <span className="wk__box" aria-hidden="true">{d.state === 'COMPLETE' ? '✓' : d.state === 'MISSED' ? '×' : ''}</span>
                <span className="meta">{new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short' }).format(new Date(`${d.date}T00:00:00Z`))}</span>
                <span className="sr-only">{d.state.toLowerCase()}</span>
              </li>
            ))}
          </ol>
        </div>
      </Section>

      <Section kicker="Position against the target">
        <div className="grid-2">
          <div>
            <p className="statement">{STATUS_WORD[t.status] ?? t.status}.</p>
            <p className="body" style={{ marginTop: 'var(--space-4)' }}>{statusLine(t.status, t.historyDays)}</p>
          </div>
          <div className="btn-row" style={{ alignSelf: 'end' }}>
            <Link to="/path" className="btn">Open the trajectory</Link>
            <Link to="/log" className="btn btn--ghost">{o.awards.length > 0 ? `${o.awards.length} ${o.awards.length === 1 ? 'milestone' : 'milestones'} reached` : 'Open the record'}</Link>
          </div>
        </div>
      </Section>

      <Section kicker="Recent events" tone="deep">
        {o.changes.length === 0
          ? <Empty title="No events yet">Verified events appear here as your platforms synchronise.</Empty>
          : (
            <ul className="ledger">
              {o.changes.slice(0, 4).map((c, i) => (
                <li key={i} className="ledger__row"><span className="ledger__k">{ago(c.at, now)}</span><span className="ledger__v">{c.text}</span><span /></li>
              ))}
            </ul>
          )}
        <p className="kicker" style={{ margin: 'var(--space-9) 0 var(--space-4)' }}>Currency of the data</p>
        <ul className="fresh">
          {o.sources.map((s) => <li key={s.platform}><span className="strong">{s.label}</span> <SourceChip status={s.status} updatedAt={s.updatedAt} now={now} /></li>)}
        </ul>
        <p className="small" style={{ marginTop: 'var(--space-4)' }}>{fmt(o.remaining)} points remain to the target. Every figure is taken from recorded data; none is estimated.</p>
      </Section>
    </>
  );
}

/** A new person: no figures yet, so no score is shown and nothing is implied. */
function Welcome({ o }: { o: Overview }) {
  const pending = o.sources.filter((s) => s.username);
  const next = o.upcomingContests[0];
  return (
    <>
      <section className="hero block block-sky" aria-label="Welcome">
        <Contours />
        <div className="frame">
          <p className="kicker enter">Welcome{o.user.displayName && o.user.displayName !== 'New member' ? `, ${o.user.displayName}` : ''}</p>
          <h1 className="display fig-2xl enter" style={{ animationDelay: '0.08s' }}>Establish your current position.</h1>
          <p className="lead enter" style={{ animationDelay: '0.16s', maxWidth: '40ch', margin: 'var(--space-6) auto 0' }}>
            Your position is calculated from your own coding profiles. Connect them first; nothing is estimated in their absence.
          </p>
          <div className="btn-row enter" style={{ animationDelay: '0.28s', justifyContent: 'center', marginTop: 'var(--space-8)' }}>
            <Link to="/settings#profiles" className="btn btn--big">Connect your coding profiles</Link>
          </div>
          {pending.length > 0 && (
            <p className="body enter" style={{ animationDelay: '0.36s', marginTop: 'var(--space-6)' }}>
              {pending.map((s) => s.label).join(', ')} {pending.length === 1 ? 'is' : 'are'} recorded and awaiting verification or figures.
            </p>
          )}
        </div>
      </section>
      <Section kicker="Meanwhile">
        <div className="grid-2">
          <p className="statement">{next ? `The next rated contest is ${next.title}.` : 'Public contests are listed in Fixtures.'}</p>
          <div style={{ alignSelf: 'end' }}>
            <p className="body">Contests from Codeforces, LeetCode and CodeChef are listed for everyone, whether or not a profile is connected.</p>
            <p style={{ marginTop: 'var(--space-5)' }}><Link to="/contests" className="link-arrow">Open the fixtures</Link></p>
          </div>
        </div>
      </Section>
    </>
  );
}

/** Advisory interpretation above the deterministic plan. It cannot change any figure; it is hidden when off. */
function Counsel() {
  const { data } = useFetch<Strategist>('/strategist');
  if (!data || data.status === 'OFF' || (!data.advice && !data.message)) return null;
  const a = data.advice;
  return (
    <Section kicker="Strategist · advisory" tone="deep" label="Strategist">
      {!a ? <p className="body">{data.message}</p> : (
        <div className="grid-2">
          <div>
            <p className="statement">{a.next.action}</p>
            <p className="body" style={{ marginTop: 'var(--space-4)' }}>{a.next.why}</p>
          </div>
          <div className="stack" style={{ alignSelf: 'end' }}>
            {a.today.length > 0 && <ul className="counsel">{a.today.map((t, i) => <li key={i}>{t}</li>)}</ul>}
            {[a.contestPriority, a.practicePriority, a.recovery].filter(Boolean).map((t, i) => <p key={i} className="body">{t}</p>)}
            <p className="small">Advice only. It is drawn from your verified figures and cannot change them.</p>
          </div>
        </div>
      )}
    </Section>
  );
}
