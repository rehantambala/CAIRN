import { useState, type FormEvent } from 'react';
import { post } from '../api';

export function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await post('/auth/login', { email, password }); onDone(); }
    catch (x: any) { setErr(x.code === 'INVALID_CREDENTIALS' ? 'Those details do not match.' : x.status === 429 ? 'Too many tries. Wait a few minutes.' : 'Sign-in failed. Try again.'); }
    finally { setBusy(false); }
  }
  return (
    <main id="main" className="login block block-pink">
      <div className="frame login__grid">
        <div className="enter">
          <p className="kicker">VECTOR</p>
          <h1 className="display fig-hero login__fig">25,000<span className="mark">+</span></h1>
          <p className="lead">One number. One next action. Every day.</p>
        </div>
        <form onSubmit={submit} className="login__form enter" style={{ animationDelay: '0.15s' }} aria-label="Sign in">
          <div className="field"><label htmlFor="em">Email</label><input id="em" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          <div className="field"><label htmlFor="pw">Password</label><input id="pw" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required aria-invalid={!!err} aria-describedby={err ? 'le' : undefined} /></div>
          {err && <p id="le" className="error-text" role="alert">{err}</p>}
          <div className="btn-row"><button className="btn btn--big" disabled={busy} aria-busy={busy}>{busy ? 'Signing in…' : 'Sign in'}</button></div>
        </form>
      </div>
    </main>
  );
}
