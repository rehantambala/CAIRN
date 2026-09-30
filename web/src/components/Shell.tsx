import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, Link } from 'react-router-dom';
import { post } from '../api';

const NAV = [
  ['/', 'HOME'], ['/today', 'TODAY'], ['/contests', 'CONTESTS'], ['/problems', 'PROBLEMS'], ['/trajectory', 'TRAJECTORY'],
  ['/calendar', 'CALENDAR'], ['/score', 'SCORE'], ['/awards', 'AWARDS'], ['/analytics', 'ANALYTICS'], ['/settings', 'SETTINGS'],
] as const;

export function Shell({ onLogout }: { onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const closeRef = useRef<HTMLButtonElement>(null);
  const openRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { setOpen(false); window.scrollTo(0, 0); }, [loc.pathname]);
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); openRef.current?.focus(); } };
    document.addEventListener('keydown', esc);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', esc); document.body.style.overflow = ''; };
  }, [open]);

  // Lazy rollover: closes past days and creates today's objective; the scheduled job does the same.
  useEffect(() => { void post('/refresh').catch(() => {}); }, []);

  const isCurrent = (to: string) => (to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(to));

  return (
    <div className="app">
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="nav">
        <div className="frame nav__row">
          <Link to="/" className="wordmark" aria-label="VECTOR home">VECTOR</Link>
          <nav aria-label="Primary" className="nav__links">
            {NAV.map(([to, label]) => (
              <NavLink key={to} to={to} end={to === '/'} className="nav__link">{label}</NavLink>
            ))}
          </nav>
          <button ref={openRef} className="nav__menu-btn" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}>MENU</button>
        </div>
      </header>

      {open && (
        <div className="menu" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="menu__top">
            <span className="wordmark" style={{ color: 'var(--color-text-light)' }}>VECTOR</span>
            <button ref={closeRef} className="menu__close" onClick={() => { setOpen(false); openRef.current?.focus(); }}>CLOSE</button>
          </div>
          <nav aria-label="Menu" className="menu__list">
            {NAV.map(([to, label], i) => (
              <NavLink key={to} to={to} end={to === '/'} className="menu__link" onClick={() => setOpen(false)}>
                <small>{String(i + 1).padStart(2, '0')}</small>{label}
              </NavLink>
            ))}
          </nav>
        </div>
      )}

      <main id="main" className="main" tabIndex={-1}><Outlet /></main>

      <nav className="dock" aria-label="Quick">
        {([['/', 'HOME'], ['/today', 'TODAY'], ['/contests', 'CONTESTS'], ['/calendar', 'CALENDAR']] as const).map(([to, label]) => (
          <NavLink key={to} to={to} end={to === '/'} aria-current={isCurrent(to) ? 'page' : undefined}>{label}</NavLink>
        ))}
      </nav>

      <footer className="footer">
        <div className="frame footer__row">
          <span>VECTOR · 25,000+</span>
          <button className="btn btn--ghost btn--sm" onClick={onLogout}>Sign out</button>
        </div>
      </footer>
    </div>
  );
}
