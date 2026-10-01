import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { del, post, type ContestRow, type SourceHealth } from '../api';
import { ago, countdown, tzDay, tzTime } from '../format';
import { useFetch, useNow } from '../hooks';
import { ErrorBanner, Loading, PageHead, Empty, Section, useAnnouncer } from '../components/ui';

interface Payload { timezone: string; now: string; contests: ContestRow[]; sources: SourceHealth[] }

const STATE_WORD: Record<ContestRow['state'], string> = { UPCOMING: 'Upcoming', STARTING_SOON: 'Starting soon', LIVE: 'In progress', FINISHED: 'Finished', MISSED: 'Not attended', ATTENDED: 'Attended' };

export function Contests() {
  const { data, error, loading, reload } = useFetch<Payload>('/contests');
  const [params] = useSearchParams();
  const now = useNow(15_000);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBanner error={error ?? new Error('NO_DATA')} retry={reload} />;
  const tz = data.timezone;
  const upcoming = data.contests.filter((c) => new Date(c.endAt).getTime() > now).sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt));
  const past = data.contests.filter((c) => new Date(c.endAt).getTime() <= now).sort((a, b) => +new Date(b.startAt) - +new Date(a.startAt));
  const focus = params.get('focus');
  const lead = upcoming.find((c) => c.id === focus) ?? upcoming.find((c) => c.rated) ?? upcoming[0];
  const rest = upcoming.filter((c) => c.id !== lead?.id);

  return (
    <>
      <PageHead title="Fixtures" sub={`Rated contests are the only route to rating movement. Times are shown in ${tz}.`} />
      {upcoming.length === 0 && (
        <Section>
          <Empty title="No upcoming contests">
            No upcoming contest is currently listed by the sources below. The listings are read again every two hours.
          </Empty>
        </Section>
      )}
      {lead && <section className="block block-ink section" aria-label="Next contest"><div className="frame"><Lead c={lead} tz={tz} now={now} onChange={reload} /></div></section>}
      {rest.length > 0 && (
        <Section kicker="Subsequently">
          <ol className="tl">{rest.map((c) => <Row key={c.id} c={c} tz={tz} now={now} onChange={reload} />)}</ol>
        </Section>
      )}
      {data.sources.length > 0 && <Sources list={data.sources} now={now} />}
      {past.length > 0 && (
        <Section kicker="Concluded" tone="deep">
          <ol className="tl">{past.map((c) => <Row key={c.id} c={c} tz={tz} now={now} onChange={reload} />)}</ol>
        </Section>
      )}
    </>
  );
}

function Actions({ c, now, onChange }: { c: ContestRow; now: number; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { say, region } = useAnnouncer();
  const started = new Date(c.startAt).getTime() <= now;
  const over = new Date(c.endAt).getTime() <= now;

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true); setErr(null);
    try { await fn(); setMsg(ok); say(ok); onChange(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div>
      {region}
      <div className="btn-row">
        {!over && !c.committed && <button className="btn" disabled={busy} aria-busy={busy} onClick={() => run(() => post(`/contests/${c.id}/commit`, { prepMinutes: 30 }), 'Commitment recorded. Reminders are scheduled.')}>Commit to this contest</button>}
        {!over && c.committed && <button className="btn btn--ghost" disabled={busy} onClick={() => run(() => del(`/contests/${c.id}/commit`), 'Commitment withdrawn.')}>Committed · withdraw</button>}
        {c.registrationUrl && !over && <a className="btn btn--ghost" href={c.registrationUrl} target="_blank" rel="noreferrer noopener">Register<span className="sr-only"> (opens in a new tab)</span></a>}
        {c.contestUrl && !over && <a className="btn btn--ghost" href={c.contestUrl} target="_blank" rel="noreferrer noopener">Open contest<span className="sr-only"> (opens in a new tab)</span></a>}
        {!over && <Link className="link-arrow" to="/">Prepare with practice</Link>}
        {started && c.manualOk && !c.attended && <button className="btn btn--ghost" disabled={busy} onClick={() => run(() => post(`/contests/${c.id}/attended`), 'Attendance recorded, unverified.')}>Record attendance</button>}
      </div>
      {msg && <p className="meta" style={{ marginTop: 'var(--space-3)' }}>{msg}</p>}
      {err && <p className="error-text" role="alert" style={{ marginTop: 'var(--space-3)' }}>{err}</p>}
    </div>
  );
}

function Lead({ c, tz, now, onChange }: { c: ContestRow; tz: string; now: number; onChange: () => void }) {
  const left = new Date(c.startAt).getTime() - now;
  return (
    <div className="lead-c">
      <p className="kicker">{c.state === 'LIVE' ? 'In progress' : 'Next contest'}{c.rated ? ' · rated' : ''}</p>
      <h2 className="statement statement--wide" style={{ marginTop: 'var(--space-5)' }}>{c.label}: {c.title}</h2>
      <p className="body" style={{ marginTop: 'var(--space-3)' }}>{tzDay(c.startAt, tz)} · {tzTime(c.startAt, tz)}–{tzTime(c.endAt, tz)}</p>
      {left > 0 && <p className="lead" style={{ marginTop: 'var(--space-6)' }}>Begins in</p>}
      {left > 0 && <p className="display fig-hero mark lead-c__count" aria-label={`Begins in ${countdown(left)}`}>{countdown(left)}</p>}
      {c.plan && <Plan c={c} tz={tz} now={now} />}
      <p className="lead" style={{ marginTop: 'var(--space-5)' }}>
        {c.committed
          ? `You are committed. Preparation begins ${c.prepMinutes} minutes beforehand. ${reminderLine(c) ?? ''}`
          : `Committing schedules preparation and reminders at 1 hour and 10 minutes before the start, in addition to the 24-hour notice. ${c.rated ? 'A rated attempt is the only route to rating movement.' : 'This contest is unrated.'}`}
      </p>
      <div style={{ marginTop: 'var(--space-8)' }}><Actions c={c} now={now} onChange={onChange} /></div>
    </div>
  );
}

function Plan({ c, tz, now }: { c: ContestRow; tz: string; now: number }) {
  const p = c.plan!;
  const warmLeft = p.warmupBeginsAt - now;
  return (
    <div className="plan">
      <p className="plan__line">
        Attempt <span className="strong">{p.attempt} problems</span>. Each rated {c.label} contest adds <span className="strong">{p.perContest} points</span> on attendance alone; a further 25 rating points would add about {p.ratingPlus25}, which is a projection and not a certainty.
      </p>
      {p.warmup.problems.length > 0 && (
        <>
          <p className="plan__line">
            {warmLeft > 0
              ? <>Preparation begins at <span className="strong">{tzTime(p.warmupBeginsAt, tz)}</span> on {tzDay(p.warmupBeginsAt, tz)}: {p.warmup.count} problems rated {p.warmup.from}–{p.warmup.to}, about {p.warmup.minutes} minutes.</>
              : <>Complete these {p.warmup.count} problems before the start, about {p.warmup.minutes} minutes.</>}
          </p>
          <ul className="plan__list">
            {p.warmup.problems.map((s) => (
              <li key={s.externalId}><a className="link-arrow" href={s.url} target="_blank" rel="noreferrer noopener">{s.title}<span className="sr-only"> (opens in a new tab)</span></a>{s.difficulty ? <span className="small"> · {s.difficulty}</span> : null}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

const REMINDER_WORD = { CONTEST_24H: '24 hours', CONTEST_1H: '1 hour', CONTEST_10M: '10 minutes' } as const;

/** This user's own reminders for a contest, in plain words. */
function reminderLine(c: ContestRow): string | null {
  if (new Date(c.startAt).getTime() <= Date.now()) return null;
  const pending = c.reminders.filter((r) => r.status === 'PENDING').map((r) => REMINDER_WORD[r.type]);
  if (pending.length === 0) return c.committed ? 'No reminder remains before the start.' : null;
  const words = pending.length === 1 ? pending[0] : `${pending.slice(0, -1).join(', ')} and ${pending[pending.length - 1]}`;
  return `Reminder ${words} before the start.`;
}

const SOURCE_LABEL: Record<string, string> = { codeforces: 'Codeforces', leetcode: 'LeetCode', codechef: 'CodeChef', hackerrank: 'HackerRank', smartinterviews: 'Smart Interviews', interviewbit: 'InterviewBit' };
const HEALTH_WORD: Record<SourceHealth['status'], string> = { SYNCED: 'Synced', STALE: 'Stale', ERROR: 'Error', UNAVAILABLE: 'Unavailable' };

function Sources({ list, now }: { list: SourceHealth[]; now: number }) {
  return (
    <Section kicker="Sources" tone="deep" label="Contest sources">
      <ul className="ledger">
        {list.map((s) => (
          <li key={s.platform} className="ledger__row">
            <span className="ledger__k">{SOURCE_LABEL[s.platform] ?? s.platform}</span>
            <span className="ledger__v">
              <span className="strong">{HEALTH_WORD[s.status]}.</span>{' '}
              {s.status === 'UNAVAILABLE' ? s.message
                : s.status === 'SYNCED' ? `Last verified ${ago(s.lastOkAt, now)}.`
                : `Temporarily unavailable. Contests last verified ${s.lastOkAt ? ago(s.lastOkAt, now) : 'never'} are retained.`}
            </span>
            <span />
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Row({ c, tz, now, onChange }: { c: ContestRow; tz: string; now: number; onChange: () => void }) {
  const left = new Date(c.startAt).getTime() - now;
  return (
    <li className="tl__row">
      <div className="tl__when">
        <span className="display fig-xl">{tzTime(c.startAt, tz)}</span>
        <span className="meta">{tzDay(c.startAt, tz)}</span>
      </div>
      <div className="tl__what">
        <h3 className="h-sub">{c.label}: {c.title}</h3>
        <p className="small" style={{ marginTop: 'var(--space-2)' }}>
          {c.rated ? 'Rated' : 'Unrated'} · {STATE_WORD[c.state]}
          {left > 0 && <> · begins in {countdown(left)}</>}
          {c.ratingDelta !== null && <> · rating change {c.ratingDelta >= 0 ? '+' : '−'}{Math.abs(c.ratingDelta)}</>}
        </p>
        {reminderLine(c) && <p className="small">{reminderLine(c)}</p>}
      </div>
      <Actions c={c} now={now} onChange={onChange} />
    </li>
  );
}
