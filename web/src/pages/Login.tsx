import { useEffect, useState, type FormEvent } from 'react';
import { get, post } from '../api';
import { BRAND, BRAND_LINE } from '../brand';
import { Contours } from '../components/Contours';
import { Mark } from '../components/Mark';

export function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [prov, setProv] = useState<{ github: boolean; google: boolean } | null>(null);
  useEffect(() => { void get<{ github: boolean; google: boolean }>('/auth/providers').then(setProv).catch(() => setProv(null)); }, []);
  const q = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('auth') : null;
  const authNote = q === 'denied' ? 'That account is not authorised for this service.' : q === 'failed' ? 'Sign-in could not be completed. Please try again.' : q === 'unavailable' ? 'That sign-in method is not configured.' : null;
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
        <form onSubmit={submit} className="login__form enter" style={{ animationDelay: '0.15s' }} aria-label="Sign in">
          <div className="field"><label htmlFor="em">Email</label><input id="em" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          <div className="field"><label htmlFor="pw">Password</label><input id="pw" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required aria-invalid={!!err} aria-describedby={err ? 'le' : undefined} /></div>
 {authNote && !err && <p className="error-text" role="alert">{authNote}</p>}
          {err && <p id="le" className="error-text" role="alert">{err}</p>}
          <div className="btn-row"><button className="btn btn--big" disabled={busy} aria-busy={busy}>{busy ? 'Signing in…' : 'Sign in'}</button></div>
          {(prov?.github || prov?.google) && (
            <div className="login__alt">
              <span className="small">Or continue with</span>
              <div className="btn-row">
                {prov.github && <a className="btn btn--ghost" href="/api/auth/github/start">GitHub</a>}
                {prov.google && <a className="btn btn--ghost" href="/api/auth/google/start">Google</a>}
              </div>
            </div>
          )}
        </form>
      </div>
    </main>
  );
}
