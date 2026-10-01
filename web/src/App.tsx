import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { get, post } from './api';
import { BRAND } from './brand';
import { Shell } from './components/Shell';
import { Loading } from './components/ui';
import { Contests } from './pages/Contests';
import { Log } from './pages/Log';
import { Privacy, Terms } from './pages/Legal';
import { Login } from './pages/Login';
import { Path } from './pages/Path';
import { Problems } from './pages/Problems';
import { Settings } from './pages/Settings';
import { Today } from './pages/Today';

function ToLogDay() { const { date } = useParams(); return <Navigate to={`/log/${date}`} replace />; }

export function App() {
  const [auth, setAuth] = useState<'loading' | 'in' | 'out' | 'offline'>('loading');
  const check = () => {
    setAuth('loading');
    get<{ authenticated: boolean }>('/auth/me')
      .then((r) => setAuth(r.authenticated ? 'in' : 'out'))
      .catch((e) => setAuth(e instanceof TypeError ? 'offline' : 'out')); // TypeError = network failure
  };
  useEffect(check, []);
  const { pathname } = useLocation();

  // Public pages: readable by anyone, signed in or not (Google links to them from its consent screen).
  if (pathname === '/privacy') return <Privacy />;
  if (pathname === '/terms') return <Terms />;
  if (auth === 'loading') return <Loading />;
  if (auth === 'offline') {
    return (
      <main id="main" className="login block block-sky">
        <div className="frame stack">
          <p className="kicker">{BRAND}</p>
          <h1 className="display fig-2xl">Offline</h1>
          <p className="lead">No connection. Scores are never shown from a cache, so nothing stale can look current.</p>
          <div className="btn-row"><button className="btn btn--big" onClick={check}>Try again</button></div>
        </div>
      </main>
    );
  }
  if (auth === 'out') return <Login onDone={() => setAuth('in')} />;

  return (
    <Routes>
      <Route element={<Shell onLogout={() => { void post('/auth/logout').finally(() => setAuth('out')); }} />}>
        <Route index element={<Today />} />
        <Route path="path" element={<Path />} />
        <Route path="contests" element={<Contests />} />
        <Route path="log" element={<Log />} />
        <Route path="log/:date" element={<Log />} />
        <Route path="practice" element={<Problems />} />
        <Route path="settings" element={<Settings />} />
        {/* Old links (saved notifications, bookmarks) keep working. */}
        <Route path="today" element={<Navigate to="/" replace />} />
        <Route path="calendar" element={<Navigate to="/log" replace />} />
        <Route path="calendar/:date" element={<ToLogDay />} />
        <Route path="awards" element={<Navigate to="/log" replace />} />
        <Route path="trajectory" element={<Navigate to="/path" replace />} />
        <Route path="score" element={<Navigate to="/path" replace />} />
        <Route path="analytics" element={<Navigate to="/path" replace />} />
        <Route path="problems" element={<Navigate to="/practice" replace />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

function NotFound() {
  return <div className="frame" style={{ padding: 'var(--space-11) var(--gutter)' }}><h1 className="display fig-2xl">Not here</h1><p className="lead" style={{ marginTop: 'var(--space-5)' }}>That page does not exist. Go back to today.</p></div>;
}
