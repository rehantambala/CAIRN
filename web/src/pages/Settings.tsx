import { useState, type FormEvent } from 'react';
import { post, put, type Platform, type Source } from '../api';
import { ago } from '../format';
import { useFetch, useNow } from '../hooks';
import { ErrorBanner, Loading, PageHead, Section, SourceChip, useAnnouncer } from '../components/ui';

interface Payload {
  user: { displayName: string; timezone: string; targetScore: number; targetDate: string | null; dailyMinutes: number; email: string };
  sources: Source[];
  push: { configured: boolean; publicKey: string | null };
  dev: boolean;
}

function b64ToU8(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function Settings() {
  const { data, error, loading, reload } = useFetch<Payload>('/settings');
  const { say, region } = useAnnouncer();
  const now = useNow(30_000);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBanner error={error ?? new Error('NO_DATA')} retry={reload} />;

  return (
    <>
      <PageHead title="Settings" sub="Your target, your sources and your reminders. No platform password is ever stored." />
      {region}
      <Section kicker="Target" label="Goal"><Profile data={data} onSaved={() => { say('Saved.'); reload(); }} /></Section>
      <Section kicker="Sources" tone="deep" label="Sources">
        <div className="stack-lg">
          {data.sources.map((s) => <SourceForm key={s.platform} s={s} now={now} onDone={() => { say(`${s.label} updated.`); reload(); }} />)}
        </div>
      </Section>
      <Section kicker="Reminders" label="Reminders"><Notifications push={data.push} /></Section>
      {data.dev && <Section kicker="Development" tone="ink" label="Development tools"><Dev onDone={reload} /></Section>}
    </>
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

function SourceForm({ s, now, onDone }: { s: Source; now: number; onDone: () => void }) {
  const rated = ['leetcode', 'codechef', 'codeforces'].includes(s.platform);
  const [username, setUsername] = useState(s.username ?? '');
  const [f, setF] = useState({ problemsSolved: '', rating: '', contests: '', contribution: '', solved: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key); setErr(null); setMsg(null);
    try { await fn(); setMsg(ok); onDone(); } catch (e: any) { setErr(e.code === 'INVALID_INPUT' ? 'Please check the values entered.' : e.message); } finally { setBusy(null); }
  }
  const num = (v: string) => (v.trim() === '' ? undefined : Number(v));

  async function doImport(e: FormEvent) {
    e.preventDefault();
    const ids = f.solved.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
    await run('import', () => post('/import', {
      platform: s.platform, problemsSolved: num(f.problemsSolved), rating: num(f.rating), contests: num(f.contests), contribution: num(f.contribution),
      solved: ids.length ? ids.map((id) => ({ id })) : undefined, note: 'Entered by owner',
    }), 'Imported.');
  }

  return (
    <div className="src">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3 className="display fig-xl">{s.label}</h3>
        <SourceChip status={s.status} updatedAt={s.updatedAt} now={now} />
      </div>
      <p className="lead">{s.capabilityNote}</p>

      {s.capability === 'AUTOMATIC' && (
        <div className="btn-row" style={{ alignItems: 'end' }}>
          <div className="field" style={{ minWidth: 220 }}><label htmlFor={`u-${s.platform}`}>Handle</label><input id={`u-${s.platform}`} className="input" value={username} onChange={(e) => setUsername(e.target.value)} /></div>
          <button className="btn btn--ghost" disabled={busy !== null} aria-busy={busy === 'save'} onClick={() => run('save', () => put(`/accounts/${s.platform}`, { username }), 'Handle saved.')}>Save handle</button>
          <button className="btn" disabled={busy !== null || !username} aria-busy={busy === 'sync'} onClick={() => run('sync', async () => { const r = await post<{ ok: boolean; message: string }>(`/sync/${s.platform}`); if (!r.ok) throw new Error(r.message); }, 'Synchronised.')}>{busy === 'sync' ? 'Synchronising' : 'Synchronise now'}</button>
          <button className="btn btn--ghost" disabled={busy !== null} onClick={() => run('derive', () => post('/codeforces/derive-from-history'), 'Counts are now derived from the synchronised history.')}>Count from synchronised history</button>
        </div>
      )}

      <form onSubmit={doImport} className="form-grid">
        {rated ? (
          <>
            <div className="field"><label htmlFor={`p-${s.platform}`}>Problems solved</label><input id={`p-${s.platform}`} className="input" type="number" min={0} value={f.problemsSolved} onChange={(e) => setF({ ...f, problemsSolved: e.target.value })} /></div>
            <div className="field"><label htmlFor={`r-${s.platform}`}>Rating</label><input id={`r-${s.platform}`} className="input" type="number" min={0} value={f.rating} onChange={(e) => setF({ ...f, rating: e.target.value })} /></div>
            <div className="field"><label htmlFor={`c-${s.platform}`}>Contests attended</label><input id={`c-${s.platform}`} className="input" type="number" min={0} value={f.contests} onChange={(e) => setF({ ...f, contests: e.target.value })} /></div>
            {s.platform !== 'codeforces' && <div className="field" style={{ gridColumn: '1 / -1' }}><label htmlFor={`s-${s.platform}`}>Solved problem ids (optional)</label><textarea id={`s-${s.platform}`} className="textarea" value={f.solved} onChange={(e) => setF({ ...f, solved: e.target.value })} aria-describedby={`sh-${s.platform}`} /><span id={`sh-${s.platform}`} className="hint">Slugs or codes, separated by spaces or commas. They are retained so that a problem is never suggested again or counted twice.</span></div>}
          </>
        ) : (
          <div className="field"><label htmlFor={`k-${s.platform}`}>Score contribution</label><input id={`k-${s.platform}`} className="input" type="number" min={0} value={f.contribution} onChange={(e) => setF({ ...f, contribution: e.target.value })} /></div>
        )}
        <div className="btn-row" style={{ alignSelf: 'end' }}><button className="btn btn--ghost" disabled={busy !== null} aria-busy={busy === 'import'}>{rated ? 'Import figures' : 'Save'}</button></div>
      </form>
      {msg && <p className="meta" role="status">{msg}</p>}
      {err && <p className="error-text" role="alert">{err}</p>}
    </div>
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
      <p className="lead">Reminders are sent 24 hours before a contest and, once you have committed, 1 hour and about 10 minutes before it, with a short note when the window closes.</p>
      <p className="meta">Push service: {push.configured ? 'ready' : 'not yet configured'}</p>
      {!supported && <p className="muted">This browser does not support push notifications. On iOS, add VECTOR to the home screen first.</p>}
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
