import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { type DayState, type Item } from '../api';
import { longDate, signed } from '../format';
import { useFetch } from '../hooks';
import { ErrorBanner, Loading, PageHead, Empty } from '../components/ui';

interface CalDay { date: string; state: DayState; requiredTotal: number; requiredDone: number; verified: boolean; scoreDelta: number | null }
interface Cal { month: string; today: string; first: string; last: string; firstWeekday: number; days: CalDay[] }
interface Detail {
  date: string; exists: boolean; today?: string; state?: DayState; verified?: boolean; target?: number; trajectory?: string; rationale?: string[];
  scoreDelta?: number | null; required?: Item[]; completed?: Item[]; missed?: Item[]; optional?: Item[];
  problems?: { platform: string; id: string; title: string; url: string | null; source: string; at: string }[];
  contests?: { title: string; platform: string; ratingDelta: number | null }[];
}

const GLYPH: Record<DayState, string> = { COMPLETE: '●', ACTIVE: '◐', PARTIAL: '◒', MISSED: '×', REST: '–' };
const SHORT: Record<DayState, string> = { COMPLETE: 'DONE', ACTIVE: 'LIVE', PARTIAL: 'PART', MISSED: 'MISS', REST: 'REST' };
const WEEK = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function shiftMonth(m: string, n: number) {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
const monthTitle = (m: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(`${m}-01T00:00:00Z`));

export function Calendar() {
  const { date } = useParams();
  const nav = useNavigate();
  const [month, setMonth] = useState(() => (date ? date.slice(0, 7) : ''));
  const path = `/calendar${month ? `?month=${month}` : ''}`;
  const { data: cal, error, loading, reload } = useFetch<Cal>(path);

  useEffect(() => { if (cal && !month) setMonth(cal.month); }, [cal, month]);
  useEffect(() => { if (date && date.slice(0, 7) !== month && month) setMonth(date.slice(0, 7)); }, [date]); // eslint-disable-line

  if (error) return <ErrorBanner error={error} retry={reload} />;
  if (loading || !cal) return <Loading />;

  const byDate = new Map(cal.days.map((d) => [d.date, d]));
  const total = Number(cal.last.slice(8, 10));
  const cells: (string | null)[] = Array.from({ length: cal.firstWeekday }, () => null);
  for (let d = 1; d <= total; d++) cells.push(`${cal.month}-${String(d).padStart(2, '0')}`);
  const counts = cal.days.reduce<Record<string, number>>((a, d) => { a[d.state] = (a[d.state] ?? 0) + 1; return a; }, {});

  return (
    <>
      <PageHead title="Calendar" sub="A record of execution. A day is complete only when every required action is verified." />
      <section className="section" aria-label="Month">
        <div className="frame">
          <div className="cal__head">
            <h2 className="h-section">{monthTitle(cal.month)}</h2>
            <div className="btn-row">
              <button className="btn btn--ghost btn--sm" onClick={() => setMonth(shiftMonth(cal.month, -1))} aria-label="Previous month">Prev</button>
              <button className="btn btn--ghost btn--sm" onClick={() => setMonth(cal.today.slice(0, 7))}>This month</button>
              <button className="btn btn--ghost btn--sm" onClick={() => setMonth(shiftMonth(cal.month, 1))} aria-label="Next month">Next</button>
            </div>
          </div>

          <p className="cal__legend" aria-label="Legend">
            {(Object.keys(GLYPH) as DayState[]).map((s) => <span key={s} className="cal__key"><span aria-hidden="true" className={`cal__sw cal__sw--${s.toLowerCase()}`} />{SHORT[s]}{counts[s] ? ` · ${counts[s]}` : ''}</span>)}
          </p>

          <div className="cal__grid" role="grid" aria-label={monthTitle(cal.month)}>
            <div role="row" className="cal__row cal__row--head">
              {WEEK.map((w) => <div key={w} role="columnheader" className="cal__wd">{w}</div>)}
            </div>
            {Array.from({ length: Math.ceil(cells.length / 7) }, (_, r) => (
              <div role="row" className="cal__row" key={r}>
                {Array.from({ length: 7 }, (_, c) => {
                  const d = cells[r * 7 + c];
                  if (!d) return <div role="gridcell" className="cal__cell cal__cell--blank" key={c} />;
                  const rec = byDate.get(d);
                  const isToday = d === cal.today;
                  const future = d > cal.today;
                  const label = rec
                    ? `${longDate(d)}. ${rec.state.toLowerCase()}${rec.requiredTotal ? `. ${rec.requiredDone} of ${rec.requiredTotal} required actions` : ''}${rec.state === 'COMPLETE' && !rec.verified ? '. manual' : ''}`
                    : `${longDate(d)}. ${future ? 'not yet' : 'no record'}`;
                  return (
                    <div role="gridcell" key={c} className="cal__td">
                      <button
                        className={`cal__cell cal__cell--${rec ? rec.state.toLowerCase() : future ? 'future' : 'none'}${isToday ? ' is-today' : ''}${date === d ? ' is-selected' : ''}`}
                        onClick={() => nav(`/calendar/${d}`)}
                        aria-label={label}
                        aria-current={isToday ? 'date' : undefined}
                        aria-pressed={date === d}
                        disabled={future}
                      >
                        <span className="cal__n display-xl">{Number(d.slice(8, 10))}</span>
                        <span className="cal__s" aria-hidden="true">{rec ? SHORT[rec.state] : ''}</span>
                        {rec && rec.requiredTotal > 0 && <span className="cal__p" aria-hidden="true">{rec.requiredDone}/{rec.requiredTotal}</span>}
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          {cal.days.length === 0 && <div style={{ marginTop: 'var(--space-6)' }}><Empty title="No recorded days in this month">Days are recorded from the moment an objective is generated. Nothing is back-filled.</Empty></div>}
        </div>
      </section>
      {date && <DayPanel date={date} onClose={() => nav('/calendar')} />}
    </>
  );
}

function DayPanel({ date, onClose }: { date: string; onClose: () => void }) {
  const { data, error, loading, reload } = useFetch<Detail>(`/calendar/${date}`);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.scrollIntoView({ block: 'start' }); }, [date, data?.date]);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBanner error={error ?? new Error('NO_DATA')} retry={reload} />;

  return (
    <section ref={ref} tabIndex={-1} className="section block block-deep" aria-label={`Detail for ${longDate(date)}`}>
      <div className="frame">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 className="display-xl fig-2xl">{longDate(date)}</h2>
          <button className="btn btn--ghost btn--sm" onClick={onClose}>Close</button>
        </div>
        {!data.exists
          ? <div style={{ marginTop: 'var(--space-6)' }}><Empty title="No record">No objective was generated for this date. Nothing is back-filled.</Empty></div>
          : (
            <div className="stack-lg" style={{ marginTop: 'var(--space-6)' }}>
              <div className="grid-3">
                <div><p className="label">State</p><p className="display-xl fig-xl">{data.state}{data.state === 'COMPLETE' && !data.verified ? ' · MANUAL' : data.state === 'COMPLETE' ? ' · VERIFIED' : ''}</p></div>
                <div><p className="label">Daily target (deterministic)</p><p className="display-xl fig-xl">{signed(data.target ?? 0)}</p></div>
                <div><p className="label">Actual score delta</p><p className="display-xl fig-xl">{data.scoreDelta === null || data.scoreDelta === undefined ? 'OPEN' : signed(data.scoreDelta)}</p></div>
              </div>
              <div><p className="label">Trajectory</p><p className="display-xl fig-lg">{data.trajectory}</p></div>
              <div className="grid-2">
                <ItemList title="Required actions" items={data.required ?? []} />
                <ItemList title="Completed" items={data.completed ?? []} showVerification />
              </div>
              {(data.missed ?? []).length > 0 && <ItemList title="Missed" items={data.missed ?? []} />}
              <div className="grid-2">
                <div>
                  <p className="label">Contests</p>
                  {(data.contests ?? []).length === 0 ? <p className="serif-lead">None recorded.</p> : (
                    <ul className="ledger">{data.contests!.map((c, i) => <li key={i} className="ledger__row"><span className="ledger__k">{c.platform}</span><span className="ledger__v">{c.title}</span><span>{c.ratingDelta === null ? '' : signed(c.ratingDelta)}</span></li>)}</ul>
                  )}
                </div>
                <div>
                  <p className="label">Problems</p>
                  {(data.problems ?? []).length === 0 ? <p className="serif-lead">None accepted.</p> : (
                    <ul className="ledger">{data.problems!.map((p) => <li key={p.platform + p.id} className="ledger__row"><span className="ledger__k">{p.platform}</span><span className="ledger__v">{p.url ? <a href={p.url} target="_blank" rel="noreferrer noopener">{p.title}</a> : p.title}</span><span className="state-tag">{p.source === 'MANUAL' ? 'MANUAL' : 'VERIFIED'}</span></li>)}</ul>
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
      <p className="label">{title}</p>
      {items.length === 0 ? <p className="serif-lead">None.</p> : (
        <ul className="ledger">
          {items.map((i) => (
            <li key={i.id} className="ledger__row">
              <span className="ledger__k">{i.platform ?? 'Rest'}</span>
              <span className="ledger__v">{i.type === 'PROBLEM_QUOTA' ? `${i.quota} problem${i.quota === 1 ? '' : 's'} · ${i.completedCount} done` : i.title}</span>
              {showVerification ? <span className="state-tag">{i.verification}</span> : <span />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
