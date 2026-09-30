import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { del, post, type ContestRow } from '../api';
import { countdown, tzDay, tzTime } from '../format';
import { useFetch, useNow } from '../hooks';
import { ErrorBanner, Loading, PageHead, Empty, Section, useAnnouncer } from '../components/ui';

interface Payload { timezone: string; now: string; contests: ContestRow[] }

const STATE_WORD: Record<ContestRow['state'], string> = { UPCOMING: 'Upcoming', STARTING_SOON: 'Starting soon', LIVE: 'Live now', FINISHED: 'Finished', MISSED: 'Missed', ATTENDED: 'Attended' };

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
      <PageHead title="Contests" sub={`Every rated contest is a chance to move a rating. Times are in ${tz}.`} />
      {upcoming.length === 0 && (
        <Section>
          <Empty title="Nothing upcoming yet">
            Codeforces contests are found automatically. For other platforms, add a clist.by key (CLIST_USERNAME, CLIST_API_KEY) and the list fills itself.
          </Empty>
        </Section>
      )}
      {lead && <section className="block block-ink section" aria-label="Next contest"><div className="frame"><Lead c={lead} tz={tz} now={now} onChange={reload} /></div></section>}
      {rest.length > 0 && (
        <Section kicker="After that">
          <ol className="tl">{rest.map((c) => <Row key={c.id} c={c} tz={tz} now={now} onChange={reload} />)}</ol>
        </Section>
      )}
      {past.length > 0 && (
        <Section kicker="Behind you" tone="deep">
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
        {!over && !c.committed && <button className="btn" disabled={busy} aria-busy={busy} onClick={() => run(() => post(`/contests/${c.id}/commit`, { prepMinutes: 30 }), 'You are in. Reminders are set.')}>I am doing this one</button>}
        {!over && c.committed && <button className="btn btn--ghost" disabled={busy} onClick={() => run(() => del(`/contests/${c.id}/commit`), 'Commitment removed.')}>✓ You are in · undo</button>}
        {c.registrationUrl && !over && <a className="btn btn--ghost" href={c.registrationUrl} target="_blank" rel="noreferrer noopener">Register<span className="sr-only"> (opens in a new tab)</span></a>}
        {c.contestUrl && !over && <a className="btn btn--ghost" href={c.contestUrl} target="_blank" rel="noreferrer noopener">Open contest<span className="sr-only"> (opens in a new tab)</span></a>}
        {!over && <Link className="link-arrow" to="/">Warm up first</Link>}
        {started && c.manualOk && !c.attended && <button className="btn btn--ghost" disabled={busy} onClick={() => run(() => post(`/contests/${c.id}/attended`), 'Recorded as attended (unverified).')}>I took part</button>}
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
      <p className="kicker">{c.state === 'LIVE' ? 'Live now' : 'Next contest'}{c.rated ? ' · rated' : ''}</p>
      <h2 className="statement statement--wide" style={{ marginTop: 'var(--space-5)' }}>{c.label}: {c.title}</h2>
      <p className="body" style={{ marginTop: 'var(--space-3)' }}>{tzDay(c.startAt, tz)} · {tzTime(c.startAt, tz)}–{tzTime(c.endAt, tz)}</p>
      {left > 0 && <p className="display fig-hero mark lead-c__count" aria-label={`Starts in ${countdown(left)}`}>{countdown(left)}</p>}
      <p className="lead" style={{ marginTop: 'var(--space-5)' }}>
        {c.committed
          ? `You are in. Preparation starts ${c.prepMinutes} minutes before, and reminders will find you.`
          : 'Deciding now is half the work. Commit, and VECTOR reminds you 24 hours, 1 hour and 10 minutes before.'}
      </p>
      <div style={{ marginTop: 'var(--space-8)' }}><Actions c={c} now={now} onChange={onChange} /></div>
    </div>
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
          {left > 0 && <> · in {countdown(left)}</>}
          {c.ratingDelta !== null && <> · rating {c.ratingDelta >= 0 ? '+' : '−'}{Math.abs(c.ratingDelta)}</>}
        </p>
      </div>
      <Actions c={c} now={now} onChange={onChange} />
    </li>
  );
}
