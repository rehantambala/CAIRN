import { useEffect, useState, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { del, get, post, put, type Platform, type Source } from '../api';
import { BRAND } from '../brand';
import { ago } from '../format';
import { useFetch, useNow } from '../hooks';
import { ConnectionChip, ErrorBanner, Loading, PageHead, Section, useAnnouncer } from '../components/ui';

interface Identity { provider: 'google' | 'github'; email: string | null; login: string | null; linkedAt: string }
interface Payload {
  user: { displayName: string; timezone: string; targetScore: number; targetDate: string | null; dailyMinutes: number; email: string | null; githubLogin: string | null };
  reminders: { enabled: boolean; h24: boolean; h1: boolean; m10: boolean };
  identities: Identity[];
  hasPassword: boolean;
  detected: Partial<Record<Platform, string>>;
  sources: Source[];
  push: { configured: boolean; publicKey: string | null };
  dev: boolean;
}

function b64ToU8(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}


const AUTH_NOTE: Record<string, string> = {
  linked: 'The sign-in method is now linked to this account.',
  conflict: 'That account is already linked to a different CAIRN account, so it was not linked here.',
  failed: 'Linking could not be completed. Please try again.',
  unavailable: 'That sign-in method is not configured on this server.',
  cancelled: 'Linking was cancelled.',
};

export function Settings() {
  const { data, error, loading, reload } = useFetch<Payload>('/settings');
  const { say, region } = useAnnouncer();
  const now = useNow(30_000);
  const loc = useLocation();
  const authNote = AUTH_NOTE[new URLSearchParams(loc.search).get('auth') ?? ''] ?? null;
  useEffect(() => {
    if (!loading && loc.hash) document.getElementById(loc.hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [loading, loc.hash]);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBanner error={error ?? new Error('NO_DATA')} retry={reload} />;
  const done = (msg: string) => { say(msg); reload(); };

  return (
    <>
      <PageHead title="Preferences" sub="Your coding profiles, sign-in, reminders and target. No platform password is ever requested or stored." />
      {region}
      {authNote && <Section><p className="lead" role="status">{authNote}</p></Section>}
      <Section kicker="Coding profiles" label="Coding profiles" id="profiles">
        <Profiles data={data} now={now} onDone={done} />
      </Section>
      <Section kicker="Contest reminders" tone="deep" label="Contest reminders" id="reminders">
        <Reminders initial={data.reminders} onDone={done} />
        <div style={{ marginTop: 'var(--space-9)' }}><Notifications push={data.push} /></div>
      </Section>
      <Section kicker="Sign-in" label="Sign-in methods"><SignIn data={data} onDone={done} /></Section>
      <Section kicker="Target" tone="deep" label="Target"><Profile data={data} onSaved={() => done('Saved.')} /></Section>
      {data.dev && <Section kicker="Development" tone="ink" label="Development tools"><Dev onDone={reload} /></Section>}
    </>
  );
}

const ORDER: Platform[] = ['leetcode', 'codechef', 'codeforces', 'hackerrank', 'interviewbit', 'smartinterviews'];

function Profiles({ data, now, onDone }: { data: Payload; now: number; onDone: (m: string) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<string | null>(null);
  async function paste(e: FormEvent) {
    e.preventDefault(); setBusy(true); setOut(null);
    try {
      const r = await post<{ results: { platform: string; ok: boolean; state: string; handle: string | null; message: string }[]; message: string | null }>('/profiles/discover', { text });
      if (r.message) { setOut(r.message); return; }
      setOut(r.results.map((x) => `${data.sources.find((s) => s.platform === x.platform)?.label}: ${x.message}`).join(' '));
      if (r.results.some((x) => x.ok)) { setText(''); onDone('Profiles updated.'); }
    } catch (x: any) { setOut(x.message); } finally { setBusy(false); }
  }
  const sources = ORDER.map((p) => data.sources.find((s) => s.platform === p)!).filter(Boolean);
  return (
    <div className="stack-lg">
      <p className="lead">Each profile is verified with its platform before it is connected. Platforms that permit no automatic reading keep your handle and the figures you enter.</p>
      <form onSubmit={paste} className="paste">
        <div className="field">
          <label htmlFor="disc">Profile addresses</label>
          <textarea id="disc" className="textarea" value={text} onChange={(e) => setText(e.target.value)} aria-describedby="disch" placeholder="https://leetcode.com/u/…   https://codeforces.com/profile/…" />
          <span id="disch" className="hint">Paste LeetCode, CodeChef or Codeforces addresses in any order. Each handle is verified, then connected.</span>
        </div>
        <div className="btn-row"><button className="btn" disabled={busy || !text.trim()} aria-busy={busy}>{busy ? 'Verifying' : 'Verify and connect'}</button></div>
        {out && <p className="meta" role="status">{out}</p>}
      </form>
      {sources.map((s) => <ProfileRow key={s.platform} s={s} detected={data.detected[s.platform] ?? null} now={now} onDone={onDone} />)}
    </div>
  );
}

const STATE_LINE: Record<Source['connection'], (s: Source, now: number) => string> = {
  NOT_CONNECTED: () => 'Not connected.',
  PENDING_VERIFICATION: (s) => `Pending verification. ${s.lastError ? `The platform could not be reached (${s.lastError}). ` : ''}It will be checked again automatically.`,
  LIVE: (s, now) => `Verified ${ago(s.verifiedAt, now)}.`,
  SYNCED: (s, now) => `Last synchronised ${ago(s.updatedAt, now)}.`,
  STALE: (s, now) => `Last synchronised ${ago(s.updatedAt, now)}. The source has not confirmed these figures recently; they are retained, not refreshed.`,
  ERROR: (s, now) => `The source could not be read${s.lastError ? `: ${s.lastError}` : ''}. The last verified figures (${ago(s.updatedAt, now)}) are retained.`,
  MANUAL: (s, now) => (s.hasFigures ? `Figures entered by you, ${ago(s.updatedAt, now)}.` : 'Handle recorded. Enter your figures to include this platform in the score.'),
  UNAVAILABLE: () => 'Handle recorded. Automatic reading is unavailable for this platform; enter your figures.',
};

function ProfileRow({ s, detected, now, onDone }: { s: Source; detected: string | null; now: number; onDone: (m: string) => void }) {
  const [handle, setHandle] = useState(detected ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showFigures, setShowFigures] = useState(false);
  const connected = !!s.username;
  const automatic = s.capability === 'AUTOMATIC';

  async function run(key: string, fn: () => Promise<string>) {
    setBusy(key); setErr(null); setMsg(null);
    try { const m = await fn(); setMsg(m); onDone(`${s.label}: ${m}`); } catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  }
  const connect = (h: string) => run('connect', async () => {
    const r = await post<{ ok: boolean; message: string }>(`/profiles/${s.platform}`, { handle: h });
    return r.message;
  });

  return (
    <article className="src" aria-labelledby={`h-${s.platform}`}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h3 id={`h-${s.platform}`} className="display fig-xl">{s.label}</h3>
        <ConnectionChip c={s.connection} />
      </div>
      {connected && <p className="statement src__handle">@{s.username}</p>}
      <p className="body">{STATE_LINE[s.connection](s, now)}</p>

      {!connected && detected && (
        <p className="body">Detected on your GitHub profile: <span className="strong">@{detected}</span>. It is connected only if you confirm it.</p>
      )}
      {!connected && (
        <form className="btn-row" style={{ alignItems: 'end' }} onSubmit={(e) => { e.preventDefault(); void connect(handle); }}>
          <div className="field" style={{ minWidth: 220 }}>
            <label htmlFor={`u-${s.platform}`}>Handle</label>
            <input id={`u-${s.platform}`} className="input" value={handle} autoComplete="off" spellCheck={false} onChange={(e) => setHandle(e.target.value)} />
          </div>
          <button className="btn" disabled={busy !== null || !handle.trim()} aria-busy={busy === 'connect'}>{busy === 'connect' ? (automatic ? 'Verifying' : 'Saving') : 'Connect profile'}</button>
        </form>
      )}
      {connected && (
        <div className="btn-row">
          {automatic && s.connection !== 'PENDING_VERIFICATION' && (
            <button className="btn" disabled={busy !== null} aria-busy={busy === 'sync'} onClick={() => run('sync', async () => {
              const r = await post<{ ok: boolean; message: string }>(`/sync/${s.platform}`);
              if (!r.ok) throw new Error(r.message);
              return 'Synchronised. The score has been recalculated from the platform’s figures.';
            })}>{busy === 'sync' ? 'Synchronising' : 'Synchronise now'}</button>
          )}
          {s.connection === 'PENDING_VERIFICATION' && <button className="btn" disabled={busy !== null} aria-busy={busy === 'connect'} onClick={() => connect(s.username!)}>Verify again</button>}
          <button className="btn btn--ghost" disabled={busy !== null} onClick={() => run('disc', async () => { await del(`/profiles/${s.platform}`); return 'Disconnected. Synchronisation has stopped; your history is kept.'; })}>Disconnect</button>
        </div>
      )}
      <p className="small">{s.capabilityNote}</p>
      {!automatic && (
        <div>
          <button className="link-arrow as-button" aria-expanded={showFigures} onClick={() => setShowFigures(!showFigures)}>{showFigures ? 'Close' : s.hasFigures ? 'Update figures' : 'Enter figures'}</button>
          {showFigures && <Figures s={s} onDone={(m) => { setShowFigures(false); setMsg(null); onDone(m); }} />}
        </div>
      )}
      {msg && <p className="meta" role="status">{msg}</p>}
      {err && <p className="error-text" role="alert">{err}</p>}
    </article>
  );
}

function Figures({ s, onDone }: { s: Source; onDone: (m: string) => void }) {
  const rated = ['leetcode', 'codechef', 'codeforces'].includes(s.platform);
  const [f, setF] = useState({ problemsSolved: '', rating: '', contests: '', contribution: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const num = (v: string) => (v.trim() === '' ? undefined : Number(v));
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      await post('/import', { platform: s.platform, problemsSolved: num(f.problemsSolved), rating: num(f.rating), contests: num(f.contests), contribution: num(f.contribution), note: 'Entered by you' });
      onDone(`${s.label} figures saved.`);
    } catch (x: any) { setErr(x.code === 'INVALID_INPUT' ? 'Please check the values entered.' : x.message); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="form-grid" style={{ marginTop: 'var(--space-5)' }}>
      {rated ? (
        <>
          <div className="field"><label htmlFor={`p-${s.platform}`}>Problems solved</label><input id={`p-${s.platform}`} className="input" type="number" min={0} value={f.problemsSolved} onChange={(e) => setF({ ...f, problemsSolved: e.target.value })} /></div>
          <div className="field"><label htmlFor={`r-${s.platform}`}>Rating</label><input id={`r-${s.platform}`} className="input" type="number" min={0} value={f.rating} onChange={(e) => setF({ ...f, rating: e.target.value })} /></div>
          <div className="field"><label htmlFor={`c-${s.platform}`}>Contests attended</label><input id={`c-${s.platform}`} className="input" type="number" min={0} value={f.contests} onChange={(e) => setF({ ...f, contests: e.target.value })} /></div>
        </>
      ) : (
        <div className="field"><label htmlFor={`k-${s.platform}`}>Score contribution</label><input id={`k-${s.platform}`} className="input" type="number" min={0} value={f.contribution} onChange={(e) => setF({ ...f, contribution: e.target.value })} /></div>
      )}
      <div className="btn-row" style={{ alignSelf: 'end' }}><button className="btn btn--ghost" disabled={busy} aria-busy={busy}>Save figures</button></div>
      {err && <p className="error-text" role="alert">{err}</p>}
    </form>
  );
}

function Reminders({ initial, onDone }: { initial: Payload['reminders']; onDone: (m: string) => void }) {
  const [r, setR] = useState(initial);
  const [busy, setBusy] = useState(false);
  async function save(next: Payload['reminders']) {
    setR(next); setBusy(true);
    try { await put('/settings', { reminders: next }); onDone('Reminder preferences saved.'); } finally { setBusy(false); }
  }
  const row = (key: keyof Payload['reminders'], label: string, hint: string) => (
    <label className="toggle" key={key}>
      <span><span className="strong">{label}</span><span className="small toggle__hint">{hint}</span></span>
      <input type="checkbox" role="switch" checked={r[key]} disabled={busy || (key !== 'enabled' && !r.enabled)} onChange={(e) => void save({ ...r, [key]: e.target.checked })} />
    </label>
  );
  return (
    <div className="stack">
      <p className="lead">Reminders are scheduled by the server, so they arrive whether or not CAIRN is open. Times follow your timezone.</p>
      <div className="toggles">
        {row('enabled', 'Contest reminders', 'All reminders, on or off.')}
        {row('h24', '24 hours before', 'Rated contests on your platforms, and any contest you commit to.')}
        {row('h1', '1 hour before', 'Contests you commit to.')}
        {row('m10', '10 minutes before', 'Contests you commit to.')}
      </div>
    </div>
  );
}

function SignIn({ data, onDone }: { data: Payload; onDone: (m: string) => void }) {
  const [prov, setProv] = useState<{ github: boolean; google: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { void get<{ github: boolean; google: boolean }>('/auth/providers').then(setProv).catch(() => setProv(null)); }, []);
  const tz = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const row = (p: 'google' | 'github', label: string) => {
    const id = data.identities.find((i) => i.provider === p);
    return (
      <li key={p} className="ledger__row">
        <span className="ledger__k">{label}</span>
        <span className="ledger__v">{id ? `Linked${id.email || id.login ? ` as ${id.login ? `@${id.login}` : id.email}` : ''}.` : 'Not linked.'}</span>
        <span>
          {id
            ? <button className="link-arrow as-button" onClick={async () => { setErr(null); try { await del(`/auth/identities/${p}`); onDone(`${label} unlinked.`); } catch (e: any) { setErr(e.message); } }}>Unlink</button>
            : prov?.[p] ? <a className="link-arrow" href={`/api/auth/${p}/start?link=1&tz=${tz}`}>Link {label}</a> : <span className="muted">Not configured</span>}
        </span>
      </li>
    );
  };
  return (
    <div className="stack">
      <p className="lead">Your CAIRN account is separate from the services you sign in with. Linking a second one lets you sign in with either; neither grants access to any coding platform.</p>
      <ul className="ledger">{row('google', 'Google')}{row('github', 'GitHub')}</ul>
      {data.hasPassword && <p className="small">This account also has an email and password.</p>}
      {err && <p className="error-text" role="alert">{err}</p>}
    </div>
  );
}

function Profile({ data, onSaved }: { data: Payload; onSaved: () => void }) {
  const [f, setF] = useState({ displayName: data.user.displayName, timezone: data.user.timezone, targetScore: data.user.targetScore, targetDate: data.user.targetDate ?? '', dailyMinutes: data.user.dailyMinutes });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await put('/settings', { displayName: f.displayName, timezone: f.timezone, targetScore: Number(f.targetScore), targetDate: f.targetDate || null, dailyMinutes: Number(f.dailyMinutes) }); onSaved(); }
    catch (x: any) { setErr(x.code === 'INVALID_INPUT' ? 'Please check the values. The timezone must be an IANA name, such as Asia/Kolkata.' : x.message); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="form-grid">
      <div className="field"><label htmlFor="dn">Display name</label><input id="dn" className="input" value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} /></div>
      <div className="field"><label htmlFor="tz">Timezone</label><input id="tz" className="input" value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} aria-describedby="tzh" /><span id="tzh" className="hint">Each day closes at midnight in this timezone.</span></div>
      <div className="field"><label htmlFor="ts">Target score (minimum)</label><input id="ts" className="input" type="number" min={1000} value={f.targetScore} onChange={(e) => setF({ ...f, targetScore: Number(e.target.value) })} /></div>
      <div className="field"><label htmlFor="td">Target date (optional)</label><input id="td" className="input" type="date" value={f.targetDate} onChange={(e) => setF({ ...f, targetDate: e.target.value })} aria-describedby="tdh" /><span id="tdh" className="hint">Used only to measure pace. It is never presented as a promise.</span></div>
      <div className="field"><label htmlFor="dm">Daily time budget (minutes)</label><input id="dm" className="input" type="number" min={30} max={480} value={f.dailyMinutes} onChange={(e) => setF({ ...f, dailyMinutes: Number(e.target.value) })} /></div>
      <div className="btn-row" style={{ alignSelf: 'end' }}><button className="btn" disabled={busy} aria-busy={busy}>{busy ? 'Saving' : 'Save'}</button></div>
      {err && <p className="error-text" role="alert">{err}</p>}
    </form>
  );
}

function Notifications({ push }: { push: Payload['push'] }) {
  const [state, setState] = useState<string | null>(null);
  const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window;
  async function enable() {
    setState(null);
    try {
      if (!push.publicKey) throw new Error('Push notifications are not yet configured on the server (VAPID keys).');
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') throw new Error('Permission was not granted.');
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(push.publicKey) });
      await post('/push/subscribe', sub.toJSON());
      setState('Reminders are enabled on this device.');
    } catch (e: any) { setState(e.message); }
  }
  return (
    <div className="stack">
      <p className="body">Reminders reach a device once that device is enabled here. Each phone or browser is enabled separately.</p>
      <p className="meta">Push service on this server: {push.configured ? 'ready' : 'not configured'}</p>
      {!supported && <p className="muted">This browser does not support push notifications. On iOS, add {BRAND} to the home screen first.</p>}
      <div className="btn-row"><button className="btn" onClick={enable} disabled={!supported || !push.configured}>Enable on this device</button></div>
      {state && <p className="meta" role="status">{state}</p>}
    </div>
  );
}

function Dev({ onDone }: { onDone: () => void }) {
  const [out, setOut] = useState<string>('');
  const [plat, setPlat] = useState<Platform>('leetcode');
  async function accept() {
    const r = await post<any>('/dev/accept', { platform: plat });
    setOut(`Accepted: new=${r.isNew} score=${r.overall} delta=${r.scoreDelta} dayComplete=${r.justCompleted} nextChanged=${r.nextChanged}`);
    onDone();
  }
  async function jobs(name: string) {
    setOut(`Job ${name} needs the cron secret; use the CLI: npm run jobs`);
  }
  return (
    <div className="stack">
      <p className="lead">Simulates an accepted submission through the real pipeline. It exists only outside production.</p>
      <div className="btn-row" style={{ alignItems: 'end' }}>
        <div className="field"><label htmlFor="dp">Platform</label><select id="dp" className="select" value={plat} onChange={(e) => setPlat(e.target.value as Platform)}><option value="leetcode">LeetCode</option><option value="codechef">CodeChef</option><option value="codeforces">Codeforces</option></select></div>
        <button className="btn" onClick={accept}>Simulate accepted problem</button>
        <button className="btn btn--ghost" onClick={() => jobs('all')}>Jobs</button>
      </div>
      {out && <p className="meta" role="status">{out}</p>}
      <p className="muted">Synced {ago(new Date().toISOString())}</p>
    </div>
  );
}
