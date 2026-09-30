import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { del, post, type ContestRow } from '../api';
import { countdown, tzDay, tzTime } from '../format';
import { useFetch, useNow } from '../hooks';
import { ErrorBanner, Loading, PageHead, Empty, useAnnouncer } from '../components/ui';

interface Payload { timezone: string; now: string; contests: ContestRow[] }

export function Contests() {
  const { data, error, loading, reload } = useFetch<Payload>('/contests');
  const [params] = useSearchParams();
  const now = useNow(15_000);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBanner error={error ?? new Error('NO_DATA')} retry={reload} />;
  const tz = data.timezone;
  const fetchedAt = new Date(data.now).getTime();
  const nowAdj = now; void fetchedAt;
  const upcoming = data.contests.filter((c) => new Date(c.endAt).getTime() > nowAdj).sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt));
  const past = data.contests.filter((c) => new Date(c.endAt).getTime() <= nowAdj).sort((a, b) => +new Date(b.startAt) - +new Date(a.startAt));
  const focus = params.get('focus');
  const lead = upcoming.find((c) => c.id === focus) ?? upcoming.find((c) => c.rated) ?? upcoming[0];
  const rest = upcoming.filter((c) => c.id !== lead?.id);

  return (
    <>
      <PageHead title="Contests" sub={`Times in ${tz}. Reminders follow your commitment.`} />
      {upcoming.length === 0 && (
        <section className="section"><div className="frame">
          <Empty title="No upcoming contests">
            Codeforces contests are discovered from the official API. Other platforms need an aggregator key (CLIST_USERNAME, CLIST_API_KEY) or a contests.json file. Run the contests job after configuring.
          </Empty>
        </div></section>
      )}
      {lead && (
        <section className="section block block-ink" aria-label="Next contest">
          <div className="frame"><Lead c={lead} tz={tz} now={nowAdj} onChange={reload} /></div>
        </section>
      )}
      {rest.length > 0 && (
        <section className="section" aria-label="Upcoming timeline">
          <div className="frame">
            <p className="eyebrow"><span className="eyebrow__no">UP</span><span className="eyebrow__q">Upcoming</span></p>
            <ol className="tl">{rest.map((c) => <Row key={c.id} c={c} tz={tz} now={nowAdj} onChange={reload} />)}</ol>
          </div>
        </section>
      )}
      {past.length > 0 && (
        <section className="section block block-deep" aria-label="Recent contests">
          <div className="frame">
            <p className="eyebrow"><span className="eyebrow__no">PAST</span><span className="eyebrow__q">Recent</span></p>
            <ol className="tl">{past.map((c) => <Row key={c.id} c={c} tz={tz} now={nowAdj} onChange={reload} />)}</ol>
          </div>
        </section>
      )}
    </>
  );
}

function stateLabel(c: ContestRow) { return c.state.replace('_', ' '); }

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
        {c.registrationUrl && !over && <a className="btn" href={c.registrationUrl} target="_blank" rel="noreferrer noopener">Register<span className="sr-only"> (opens in a new tab)</span></a>}
        {c.contestUrl && !over && <a className="btn btn--ghost" href={c.contestUrl} target="_blank" rel="noreferrer noopener">Open contest<span className="sr-only"> (opens in a new tab)</span></a>}
        {!over && !c.committed && <button className="btn btn--ghost" disabled={busy} aria-busy={busy} onClick={() => run(() => post(`/contests/${c.id}/commit`, { prepMinutes: 30 }), 'Your rated attempt is scheduled.')}>Commit</button>}
        {!over && c.committed && <button className="btn btn--ghost" disabled={busy} onClick={() => run(() => del(`/contests/${c.id}/commit`), 'Commitment removed.')}>Committed · remove</button>}
        {!over && <Link className="btn btn--ghost" to="/problems">Prepare</Link>}
        {started && c.manualOk && !c.attended && <button className="btn btn--ghost" disabled={busy} onClick={() => run(() => post(`/contests/${c.id}/attended`), 'Participation recorded as MANUAL.')}>Mark attended</button>}
      </div>
      {msg && <p className="label" style={{ marginTop: 'var(--space-3)' }}>{msg}</p>}
      {err && <p className="error-text" role="alert" style={{ marginTop: 'var(--space-3)' }}>{err}</p>}
    </div>
  );
}

function Lead({ c, tz, now, onChange }: { c: ContestRow; tz: string; now: number; onChange: () => void }) {
  const start = new Date(c.startAt).getTime();
  const left = start - now;
  return (
    <div className="lead">
      <p className="label">{c.state === 'LIVE' ? 'LIVE NOW' : 'Next contest'} · {stateLabel(c)}</p>
      <h2 className="display-xl lead__title">{c.label} {c.title}</h2>
      <p className="lead__when">{tzDay(c.startAt, tz)} · {tzTime(c.startAt, tz)}–{tzTime(c.endAt, tz)}</p>
      {left > 0 && <p className="display-xl fig-2xl mark lead__count" aria-label={`Starts in ${countdown(left)}`}>{countdown(left)}</p>}
      {c.committed && <p className="serif-lead">Your rated attempt is scheduled. Preparation begins {c.prepMinutes} minutes before the start.</p>}
      <div style={{ marginTop: 'var(--space-6)' }}><Actions c={c} now={now} onChange={onChange} /></div>
    </div>
  );
}

function Row({ c, tz, now, onChange }: { c: ContestRow; tz: string; now: number; onChange: () => void }) {
  const left = new Date(c.startAt).getTime() - now;
  return (
    <li className="tl__row">
      <div className="tl__when">
        <span className="display-xl fig-lg">{tzTime(c.startAt, tz)}</span>
        <span className="label">{tzDay(c.startAt, tz)}</span>
      </div>
      <div className="tl__what">
        <h3 className="h-sub">{c.label} {c.title}</h3>
        <p className="muted">
          {c.rated ? 'Rated' : 'Unrated'} · <span className="state-tag">{stateLabel(c)}</span>
          {left > 0 && <> · in {countdown(left)}</>}
          {c.ratingDelta !== null && <> · rating {c.ratingDelta >= 0 ? '+' : '−'}{Math.abs(c.ratingDelta)}</>}
        </p>
      </div>
      <Actions c={c} now={now} onChange={onChange} />
    </li>
  );
}
