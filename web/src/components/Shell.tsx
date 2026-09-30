import { useEffect } from 'react';
import { NavLink, Outlet, useLocation, Link } from 'react-router-dom';
import { post } from '../api';
import { BRAND } from '../brand';
import { Mark } from './Mark';

const NAV = [['/', 'Today'], ['/path', 'Path'], ['/contests', 'Contests'], ['/log', 'Log'], ['/settings', 'Settings']] as const;

export function Shell({ onLogout }: { onLogout: () => void }) {
  const loc = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);
  // Lazy rollover: closes past days and creates today's objective; the scheduled job does the same.
  useEffect(() => { void post('/refresh').catch(() => {}); }, []);

  return (
    <div className="app">
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="nav">
        <div className="frame nav__row">
          <Link to="/" className="wordmark" aria-label={`${BRAND}, home`}><Mark size={38} mode="settle" className="wordmark__mark" /><span>{BRAND}</span></Link>
          <nav aria-label="Primary" className="nav__links">
            {NAV.map(([to, label]) => <NavLink key={to} to={to} end={to === '/'} className="nav__link">{label}</NavLink>)}
          </nav>
        </div>
      </header>

      <main id="main" className="main" tabIndex={-1}><Outlet /></main>

      <nav className="dock" aria-label="Primary (mobile)">
        {NAV.map(([to, label]) => <NavLink key={to} to={to} end={to === '/'}>{label}</NavLink>)}
      </nav>

      <footer className="footer">
        <div className="frame footer__row">
          <span>{BRAND} · Every figure is read from your platforms or entered by you.</span>
          <button className="nav__out" onClick={onLogout}>Sign out</button>
        </div>
      </footer>
    </div>
  );
}
