import { useEffect, useState, type FormEvent } from 'react';
import { get, post } from '../api';
import { BRAND } from '../brand';
import { Contours } from '../components/Contours';
import { Mark } from '../components/Mark';

const AUTH_NOTE: Record<string, string> = {
  failed: 'Sign-in could not be completed, and nothing was saved. Please try again.',
  unavailable: 'That sign-in method is not available on this server.',
  conflict: 'That Google or GitHub account already belongs to a different CAIRN account.',
  cancelled: 'Sign-in was cancelled. Nothing was saved.',
};

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

export function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState<'google' | 'github' | null>(null);
  const [prov, setProv] = useState<{ github: boolean; google: boolean } | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [authNote] = useState(() => AUTH_NOTE[new URLSearchParams(window.location.search).get('auth') ?? ''] ?? null);
  useEffect(() => { void get<{ github: boolean; google: boolean }>('/auth/providers').then(setProv).catch(() => setProv({ github: false, google: false })); }, []);
  // The note is shown once; a reload does not repeat it.
  useEffect(() => { if (window.location.search.includes('auth=')) window.history.replaceState(null, '', window.location.pathname); }, []);
  // Returning with the browser's back button must not leave the buttons disabled.
  useEffect(() => { const reset = () => setLeaving(null); window.addEventListener('pageshow', reset); return () => window.removeEventListener('pageshow', reset); }, []);

  const tz = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const anyProvider = !!(prov?.google || prov?.github);
  const passwordOpen = showPassword || (prov !== null && !anyProvider);

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await post('/auth/login', { email, password }); onDone(); }
    catch (x: any) { setErr(x.code === 'INVALID_CREDENTIALS' ? 'The details entered do not match our records.' : x.status === 429 ? 'Too many attempts. Please wait a few minutes.' : 'Sign-in failed. Please try again.'); }
    finally { setBusy(false); }
  }

  const providerButton = (p: 'google' | 'github', label: string, Icon: () => JSX.Element, cls: string) => (
    <a className={`btn btn--big btn--provider ${cls}`} href={`/api/auth/${p}/start?tz=${tz}`}
      aria-disabled={leaving !== null} aria-busy={leaving === p}
      onClick={(e) => { if (leaving) { e.preventDefault(); return; } setLeaving(p); }}>
      <Icon />
      <span>{leaving === p ? `Opening ${label}` : `Continue with ${label}`}</span>
    </a>
  );

  return (
    <main id="main" className="login block block-sky">
      <Contours />
      <div className="frame login__grid">
        <div className="enter">
          <Mark size={84} mode="settle" className="login__mark" />
          <p className="kicker" style={{ marginTop: 'var(--space-4)' }}>{BRAND}</p>
          <h1 className="display fig-hero login__fig">25,000<span className="mark">+</span></h1>
          <p className="lead">Your coding performance, organised around evidence.</p>
        </div>
        <div className="login__form enter" style={{ animationDelay: '0.15s' }}>
          {authNote && <p className="login__note" role="alert">{authNote}</p>}
          {anyProvider && (
            <div className="login__providers">
              {prov?.google && providerButton('google', 'Google', GoogleMark, 'btn--light')}
              {prov?.github && providerButton('github', 'GitHub', GitHubMark, '')}
              <p className="login__assure">
                Google shares your name and email address; GitHub shares your public profile. {BRAND} never posts, never reads your repositories and keeps no access token.
                Your coding profiles are connected afterwards, in Preferences.
              </p>
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
