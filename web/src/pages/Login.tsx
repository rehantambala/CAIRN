import { useEffect, useState, type FormEvent } from 'react';
import { get, post } from '../api';
import { BRAND, BRAND_LINE } from '../brand';
import { Contours } from '../components/Contours';
import { Mark } from '../components/Mark';

const AUTH_NOTE: Record<string, string> = {
  failed: 'Sign-in could not be completed. Please try again.',
  unavailable: 'That sign-in method is not configured on this server.',
  conflict: 'That account is already linked to a different CAIRN account.',
  cancelled: 'Sign-in was cancelled.',
};

export function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [prov, setProv] = useState<{ github: boolean; google: boolean } | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  useEffect(() => { void get<{ github: boolean; google: boolean }>('/auth/providers').then(setProv).catch(() => setProv({ github: false, google: false })); }, []);
  const authNote = AUTH_NOTE[new URLSearchParams(window.location.search).get('auth') ?? ''] ?? null;
  const tz = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const anyProvider = !!(prov?.google || prov?.github);
  const passwordOpen = showPassword || (prov !== null && !anyProvider);

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await post('/auth/login', { email, password }); onDone(); }
    catch (x: any) { setErr(x.code === 'INVALID_CREDENTIALS' ? 'The details entered do not match our records.' : x.status === 429 ? 'Too many attempts. Please wait a few minutes.' : 'Sign-in failed. Please try again.'); }
    finally { setBusy(false); }
  }

  return (
    <main id="main" className="login block block-sky">
      <Contours />
      <div className="frame login__grid">
        <div className="enter">
          <Mark size={84} mode="settle" className="login__mark" />
          <p className="kicker" style={{ marginTop: 'var(--space-4)' }}>{BRAND}</p>
          <h1 className="display fig-hero login__fig">25,000<span className="mark">+</span></h1>
          <p className="lead">{BRAND_LINE}</p>
        </div>
        <div className="login__form enter" style={{ animationDelay: '0.15s' }}>
          {authNote && <p className="error-text" role="alert">{authNote}</p>}
          {anyProvider && (
            <div className="login__providers">
              {prov?.google && <a className="btn btn--big" href={`/api/auth/google/start?tz=${tz}`}>Continue with Google</a>}
              {prov?.github && <a className="btn btn--big btn--ghost" href={`/api/auth/github/start?tz=${tz}`}>Continue with GitHub</a>}
              <p className="small">Signing in creates your own CAIRN account. Your coding profiles are connected afterwards, in Preferences.</p>
            </div>
          )}
          {anyProvider && !passwordOpen && (
            <button className="link-arrow as-button" onClick={() => setShowPassword(true)}>Sign in with email and password</button>
          )}
          {passwordOpen && (
            <form onSubmit={submit} className="stack" aria-label="Sign in with email and password">
              <div className="field"><label htmlFor="em">Email</label><input id="em" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
              <div className="field"><label htmlFor="pw">Password</label><input id="pw" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required aria-invalid={!!err} aria-describedby={err ? 'le' : undefined} /></div>
              {err && <p id="le" className="error-text" role="alert">{err}</p>}
              <div className="btn-row"><button className="btn btn--big" disabled={busy} aria-busy={busy}>{busy ? 'Signing in…' : 'Sign in'}</button></div>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
