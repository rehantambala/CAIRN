import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { type DayState, type Item, type Platform } from '../api';
import { longDate, signed } from '../format';
import { useFetch } from '../hooks';
import { streakLine } from '../copy';
import { AWARD_META } from '../awardMeta';
import { ErrorBanner, Loading, PageHead, Section, Empty } from '../components/ui';

interface CalDay { date: string; state: DayState; requiredTotal: number; requiredDone: number; verified: boolean; scoreDelta: number | null }
interface Cal { month: string; today: string; first: string; last: string; firstWeekday: number; days: CalDay[] }
interface Detail {
  date: string; exists: boolean; state?: DayState; verified?: boolean; target?: number; trajectory?: string;
  scoreDelta?: number | null; required?: Item[]; completed?: Item[]; missed?: Item[];
  problems?: { platform: string; id: string; title: string; url: string | null; source: string; at: string }[];
  contests?: { title: string; platform: string; ratingDelta: number | null }[];
}
interface AwardsPayload {
  awards: { key: string; achievedAt: string | null }[];
  metrics: { verifiedDays: number; ratedContests: number; problems: Record<string, number>; ratings: Record<string, number>; overall: number };
}
interface Analytics { contests: { title: string; platform: Platform; at: string; delta: number | null }[]; consistency: { consecutiveComplete: number } }

const GLYPH: Record<DayState, string> = { COMPLETE: '✓', ACTIVE: 'Live', PARTIAL: 'Part', MISSED: '×', REST: '–' };
const WORD: Record<DayState, string> = { COMPLETE: 'Complete', ACTIVE: 'Today', PARTIAL: 'Partial', MISSED: 'Missed', REST: 'Rest' };
const WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PLAT: Record<string, string> = { leetcode: 'LeetCode', codechef: 'CodeChef', codeforces: 'Codeforces' };

function shiftMonth(m: string, n: number) {
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1 + n, 1)).toISOString().slice(0, 7);
}
const monthTitle = (m: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(`${m}-01T00:00:00Z`));

export function Log() {
  const { date } = useParams();
  const nav = useNavigate();
  const [month, setMonth] = useState(() => (date ? date.slice(0, 7) : ''));
  const { data: cal, error, loading, reload } = useFetch<Cal>(`/calendar${month ? `?month=${month}` : ''}`);
  const aw = useFetch<AwardsPayload>('/awards');
  const an = useFetch<Analytics>('/analytics');

  useEffect(() => { if (cal && !month) setMonth(cal.month); }, [cal, month]);
  useEffect(() => { if (date && date.slice(0, 7) !== month && month) setMonth(date.slice(0, 7)); }, [date]); // eslint-disable-line

  if (error) return <ErrorBanner error={error} retry={reload} />;
  if (loading || !cal) return <Loading />;

  const byDate = new Map(cal.days.map((d) => [d.date, d]));
  const total = Number(cal.last.slice(8, 10));
  const cells: (string | null)[] = Array.from({ length: cal.firstWeekday }, () => null);
  for (let d = 1; d <= total; d++) cells.push(`${cal.month}-${String(d).padStart(2, '0')}`);
  const doneDays = cal.days.filter((d) => d.state === 'COMPLETE').length;
  const streak = an.data?.consistency.consecutiveComplete ?? 0;
  const earned = aw.data?.awards.filter((a) => a.achievedAt) ?? [];
  const open = aw.data?.awards.filter((a) => !a.achievedAt) ?? [];

  return (
    <>
      <PageHead title="Record" sub={`${streakLine(streak)} ${doneDays} ${doneDays === 1 ? 'day was' : 'days were'} completed in ${monthTitle(cal.month).split(' ')[0]}.`} />

      <Section kicker={monthTitle(cal.month)} label="Calendar">
        <div className="cal__head">
          <div className="btn-row">
            <button className="btn btn--ghost btn--sm" onClick={() => setMonth(shiftMonth(cal.month, -1))} aria-label="Previous month">← Earlier</button>
            <button className="btn btn--ghost btn--sm" onClick={() => setMonth(cal.today.slice(0, 7))}>This month</button>
            <button className="btn btn--ghost btn--sm" onClick={() => setMonth(shiftMonth(cal.month, 1))} aria-label="Next month">Later →</button>
          </div>
          <p className="small cal__legend">✓ complete · Live = today, in progress · Part = partly complete · × missed · – rest</p>
        </div>
        <div className="cal__grid" role="grid" aria-label={monthTitle(cal.month)}>
          <div role="row" className="cal__row cal__row--head">{WEEK.map((w) => <div key={w} role="columnheader" className="cal__wd">{w}</div>)}</div>
          {Array.from({ length: Math.ceil(cells.length / 7) }, (_, r) => (
            <div role="row" className="cal__row" key={r}>
              {Array.from({ length: 7 }, (_, c) => {
                const d = cells[r * 7 + c];
                if (!d) return <div role="gridcell" className="cal__cell cal__cell--blank" key={c} />;
                const rec = byDate.get(d);
                const isToday = d === cal.today;
                const future = d > cal.today;
                const label = rec
                  ? `${longDate(d)}. ${WORD[rec.state].toLowerCase()}${rec.requiredTotal ? `. ${rec.requiredDone} of ${rec.requiredTotal} required` : ''}${rec.state === 'COMPLETE' && !rec.verified ? '. recorded by you' : ''}`
                  : `${longDate(d)}. ${future ? 'upcoming' : 'no record'}`;
                return (
                  <div role="gridcell" key={c} className="cal__td">
                    <button
                      className={`cal__cell cal__cell--${rec ? rec.state.toLowerCase() : future ? 'future' : 'none'}${isToday ? ' is-today' : ''}${date === d ? ' is-selected' : ''}`}
                      onClick={() => nav(`/log/${d}`)} aria-label={label} aria-current={isToday ? 'date' : undefined} aria-pressed={date === d} disabled={future}
                    >
                      <span className="cal__n display">{Number(d.slice(8, 10))}</span>
                      <span className="cal__s" aria-hidden="true">{rec ? GLYPH[rec.state] : ''}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        {cal.days.length === 0 && <div style={{ marginTop: 'var(--space-6)' }}><Empty title="No days recorded here">Days are recorded from the moment an objective is created. Nothing is back-filled.</Empty></div>}
      </Section>

      {date && <DayPanel date={date} onClose={() => nav('/log')} />}

      <Section kicker={`Milestones reached · ${earned.length}`} tone="deep" label="Awards">
        {earned.length === 0
          ? <p className="statement">The first milestone is seven verified days.</p>
          : <ul className="awards">{earned.map((a) => <Award key={a.key} k={a.key} earned />)}</ul>}
        {open.length > 0 && (
          <>
            <p className="kicker" style={{ margin: 'var(--space-10) 0 var(--space-5)' }}>Outstanding · {open.length}</p>
            <ul className="awards">{open.map((a) => <Award key={a.key} k={a.key} earned={false} />)}</ul>
          </>
        )}
        {aw.data && (
          <ul className="ledger" style={{ marginTop: 'var(--space-9)' }}>
            <li className="ledger__row"><span className="ledger__k">Verified days</span><span className="ledger__v" /><span className="ledger__n">{aw.data.metrics.verifiedDays}</span></li>
            <li className="ledger__row"><span className="ledger__k">Rated contests</span><span className="ledger__v" /><span className="ledger__n">{aw.data.metrics.ratedContests}</span></li>
          </ul>
        )}
      </Section>

      {an.data && an.data.contests.length > 0 && (
        <Section kicker="Contest history">
          <ul className="ledger">
            {an.data.contests.map((c, i) => (
              <li key={i} className="ledger__row"><span className="ledger__k">{PLAT[c.platform]} · {c.at.slice(0, 10)}</span><span className="ledger__v">{c.title}</span><span className="ledger__n">{c.delta === null ? '—' : signed(c.delta)}</span></li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

function Award({ k, earned }: { k: string; earned: boolean }) {
  const m = AWARD_META[k];
  if (!m) return null;
  return (
    <li className={`award${earned ? ' is-earned' : ''}`}>
      <span className="display award__fig">{m.figure}</span>
      <span className="award__unit">{m.unit}</span>
      <span className="award__title">{m.title}</span>
      <span className="state">{earned ? '✓ Reached' : '○ Outstanding'}</span>
    </li>
  );
}

function DayPanel({ date, onClose }: { date: string; onClose: () => void }) {
  const { data, error, loading, reload } = useFetch<Detail>(`/calendar/${date}`);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.scrollIntoView({ block: 'start' }); }, [date, data?.date]);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBanner error={error ?? new Error('NO_DATA')} retry={reload} />;

  return (
    <section ref={ref} tabIndex={-1} className="section block block-ink" aria-label={`Detail for ${longDate(date)}`}>
      <div className="frame">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 className="display fig-2xl">{longDate(date)}</h2>
          <button className="btn btn--ghost btn--sm" onClick={onClose}>Close</button>
        </div>
        {!data.exists
          ? <p className="lead" style={{ marginTop: 'var(--space-6)' }}>No objective was created for this date. Nothing is back-filled.</p>
          : (
            <div className="stack-lg" style={{ marginTop: 'var(--space-8)' }}>
              <div className="grid-3">
                <div><p className="kicker">State</p><p className="statement" style={{ marginTop: 'var(--space-3)' }}>{data.state ? WORD[data.state] : ''}{data.state === 'COMPLETE' ? (data.verified ? ' · verified' : ' · recorded by you') : ''}</p></div>
                <div><p className="kicker">Points the day could add</p><p className="statement" style={{ marginTop: 'var(--space-3)' }}>{signed(data.target ?? 0)}</p></div>
                <div><p className="kicker">Change in score</p><p className="statement" style={{ marginTop: 'var(--space-3)' }}>{data.scoreDelta === null || data.scoreDelta === undefined ? 'Day not yet closed' : signed(data.scoreDelta)}</p></div>
              </div>
              <div className="grid-2">
                <ItemList title="Required" items={data.required ?? []} />
                <ItemList title="Completed" items={data.completed ?? []} showVerification />
              </div>
              {(data.missed ?? []).length > 0 && <ItemList title="Missed" items={data.missed ?? []} />}
              <div className="grid-2">
                <div>
                  <p className="kicker">Contests</p>
                  {(data.contests ?? []).length === 0 ? <p className="body" style={{ marginTop: 'var(--space-3)' }}>None.</p> : (
                    <ul className="ledger" style={{ marginTop: 'var(--space-3)' }}>{data.contests!.map((c, i) => <li key={i} className="ledger__row"><span className="ledger__k">{c.platform}</span><span className="ledger__v">{c.title}</span><span>{c.ratingDelta === null ? '' : signed(c.ratingDelta)}</span></li>)}</ul>
                  )}
                </div>
                <div>
                  <p className="kicker">Problems</p>
                  {(data.problems ?? []).length === 0 ? <p className="body" style={{ marginTop: 'var(--space-3)' }}>None accepted.</p> : (
                    <ul className="ledger" style={{ marginTop: 'var(--space-3)' }}>{data.problems!.map((p) => <li key={p.platform + p.id} className="ledger__row"><span className="ledger__k">{PLAT[p.platform] ?? p.platform}</span><span className="ledger__v">{p.url ? <a href={p.url} target="_blank" rel="noreferrer noopener">{p.title}</a> : p.title}</span><span className="state">{p.source === 'MANUAL' ? '○ Recorded by you' : '✓ Verified'}</span></li>)}</ul>
                  )}
                </div>
              </div>
            </div>
          )}
      </div>
    </section>
  );
}

function ItemList({ title, items, showVerification }: { title: string; items: Item[]; showVerification?: boolean }) {
  return (
    <div>
      <p className="kicker">{title}</p>
      {items.length === 0 ? <p className="body" style={{ marginTop: 'var(--space-3)' }}>None.</p> : (
        <ul className="ledger" style={{ marginTop: 'var(--space-3)' }}>
          {items.map((i) => (
            <li key={i.id} className="ledger__row">
              <span className="ledger__k">{i.platform ?? 'Rest'}</span>
              <span className="ledger__v">{i.type === 'PROBLEM_QUOTA' ? `${i.quota} problem${i.quota === 1 ? '' : 's'} · ${i.completedCount} done` : i.title}</span>
              {showVerification ? <span className="state">{i.verification === 'VERIFIED' ? '✓ Verified' : '○ Recorded by you'}</span> : <span />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
