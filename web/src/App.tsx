import { useEffect, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { get, post } from './api';
import { Shell } from './components/Shell';
import { Loading } from './components/ui';
import { Analytics } from './pages/Analytics';
import { Awards } from './pages/Awards';
import { Calendar } from './pages/Calendar';
import { Contests } from './pages/Contests';
import { Home } from './pages/Home';
import { Login } from './pages/Login';
import { Problems } from './pages/Problems';
import { ScorePage } from './pages/Score';
import { Settings } from './pages/Settings';
import { Today } from './pages/Today';
import { Trajectory } from './pages/Trajectory';

export function App() {
  const [auth, setAuth] = useState<'loading' | 'in' | 'out' | 'offline'>('loading');
  const check = () => {
    setAuth('loading');
    get<{ authenticated: boolean }>('/auth/me')
      .then((r) => setAuth(r.authenticated ? 'in' : 'out'))
      .catch((e) => setAuth(e instanceof TypeError ? 'offline' : 'out')); // TypeError = network failure
  };
  useEffect(check, []);

  if (auth === 'loading') return <Loading />;
  if (auth === 'offline') {
    return (
      <main id="main" className="login block block-pink">
        <div className="frame stack">
          <p className="label">VECTOR</p>
          <h1 className="display-xl fig-2xl">OFFLINE</h1>
          <p className="serif-lead">No connection. Scores and schedules are never shown from a cache, so nothing stale can look current.</p>
          <div className="btn-row"><button className="btn" onClick={check}>Retry</button></div>
        </div>
      </main>
    );
  }
  if (auth === 'out') return <Login onDone={() => setAuth('in')} />;

  return (
    <Routes>
      <Route element={<Shell onLogout={() => { void post('/auth/logout').finally(() => setAuth('out')); }} />}>
        <Route index element={<Home />} />
        <Route path="today" element={<Today />} />
        <Route path="contests" element={<Contests />} />
        <Route path="problems" element={<Problems />} />
        <Route path="trajectory" element={<Trajectory />} />
        <Route path="calendar" element={<Calendar />} />
        <Route path="calendar/:date" element={<Calendar />} />
        <Route path="score" element={<ScorePage />} />
        <Route path="awards" element={<Awards />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

function NotFound() {
  return <div className="frame" style={{ padding: 'var(--space-11) var(--gutter)' }}><h1 className="h-page">No such page</h1></div>;
}
