import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { config, trustedOrigins } from '../config.js';

// ---------------------------------------------------------------------------------------------------------------
// Structured logging. One JSON object per line. Query strings are never logged (OAuth callbacks carry the
// authorisation code and state there), nor are cookies, authorisation headers or bodies.
// ---------------------------------------------------------------------------------------------------------------
const SECRET_KEYS = /pass(word)?|secret|token|cookie|authorization|api[_-]?key|code_verifier|^code$|^state$|p256dh|^auth$/i;

/** Removes anything that looks like a credential from a log record, recursively. */
export function redact(v: unknown, depth = 0): unknown {
  if (depth > 4 || v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => redact(x, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) out[k] = SECRET_KEYS.test(k) ? '[redacted]' : redact(x, depth + 1);
  return out;
}

export function log(level: 'info' | 'warn' | 'error', msg: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...(redact(fields) as object) });
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line);
}

/** The full path of a request without its query string, regardless of which router is handling it. */
/** The path as it is logged. A calendar link carries a secret in its path, so that segment is never recorded. */
export const routeOf = (req: Request) => (req.originalUrl || req.url).split('?')[0].replace(/^\/api\/feed\/[^/]+$/, '/api/feed/[token]');

export const requestLog: RequestHandler = (req, res, next) => {
  const id = randomUUID();
  const started = process.hrtime.bigint();
  res.locals.requestId = id;
  res.setHeader('X-Request-Id', id);
  const route = routeOf(req);
  res.on('finish', () => {
    if (!route.startsWith('/api/')) return;                  // static assets are not logged
    if (route === '/api/health' && res.statusCode === 200) return;
    log(res.statusCode >= 500 ? 'error' : 'info', 'request', {
      requestId: id, method: req.method, route, status: res.statusCode,
      ms: Number((process.hrtime.bigint() - started) / 1_000_000n), userId: res.locals.userId ?? null,
    });
  });
  next();
};

// ---------------------------------------------------------------------------------------------------------------
// Express 4 does not catch rejected promises from handlers; this does, and hands them to the error handler.
// ---------------------------------------------------------------------------------------------------------------
export const safe = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { fn(req, res, next).catch(next); };

/** Generic, safe responses. Details (stack, SQL, paths) go to the server log only, keyed by request id. */
export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  if (res.headersSent) return;
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'PAYLOAD_TOO_LARGE' });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'INVALID_JSON' });
  log('error', 'unhandled', { requestId: res.locals.requestId, route: routeOf(req), error: String(err?.message ?? err), stack: config.isProd ? undefined : err?.stack });
  res.status(500).json({ error: 'INTERNAL', requestId: res.locals.requestId });
}

// ---------------------------------------------------------------------------------------------------------------
// Security headers. The CSP matches what the built frontend actually loads: its own scripts, styles, fonts,
// icons and API, nothing third-party. React applies style props through the CSSOM, which CSP does not govern.
// ---------------------------------------------------------------------------------------------------------------
export function securityHeaderValues(prod: boolean): Record<string, string> {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(prod ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
  return {
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    ...(prod ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {}),
  };
}

export const securityHeaders: RequestHandler = (req, res, next) => {
  for (const [k, v] of Object.entries(securityHeaderValues(config.isProd))) res.setHeader(k, v);
  // Private data is never stored by browsers or intermediaries.
  if (routeOf(req).startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
};

/**
 * In production every request must arrive over HTTPS. The host's edge terminates TLS and reports the original scheme
 * in X-Forwarded-Proto; only a request it explicitly reports as plain HTTP is redirected (GET) or refused (writes),
 * so an internal health check without the header can never be sent into a redirect loop.
 */
export const httpsOnly: RequestHandler = (req, res, next) => {
  const proto = (req.get('x-forwarded-proto') ?? '').split(',')[0].trim().toLowerCase();
  if (!config.isProd || proto !== 'http' || routeOf(req) === '/api/health') return next();
  if (req.method === 'GET' || req.method === 'HEAD') return res.redirect(308, `https://${req.get('host')}${req.originalUrl}`);
  res.status(403).json({ error: 'HTTPS_REQUIRED' });
};

// ---------------------------------------------------------------------------------------------------------------
// CORS: only the trusted origins, with credentials. Never "*".
// ---------------------------------------------------------------------------------------------------------------
export const corsOptions = {
  origin(origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) {
    cb(null, !!origin && trustedOrigins().includes(origin));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'X-CAIRN-Request'],
  maxAge: 600,
};

// ---------------------------------------------------------------------------------------------------------------
// CSRF. The session cookie is SameSite=Lax, which already withholds it from cross-site POSTs; this is the
// independent second layer. A state-changing request must
//   1. carry the X-CAIRN-Request header, which a cross-site form cannot set and a cross-site script can set only
//      after a CORS preflight that untrusted origins fail, and
//   2. not be marked cross-site by the browser, and come from a trusted origin when it names one.
// The cron endpoint authenticates with a bearer secret instead and is exempt; OAuth callbacks are GETs and are
// protected by their signed, single-browser state.
// ---------------------------------------------------------------------------------------------------------------
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const csrfGuard: RequestHandler = (req, res, next) => {
  if (SAFE_METHODS.has(req.method) || routeOf(req).startsWith('/api/jobs/')) return next();
  const deny = (why: string) => {
    log('warn', 'csrf rejected', { requestId: res.locals.requestId, route: routeOf(req), why });
    res.status(403).json({ error: 'CSRF_REJECTED' });
  };
  if (req.get('x-cairn-request') !== '1') return deny('missing header');
  if (req.get('sec-fetch-site') === 'cross-site') return deny('cross-site fetch');
  const origin = req.get('origin');
  if (origin) {
    const own = `${req.protocol}://${req.get('host')}`;
    if (origin !== own && !trustedOrigins().includes(origin)) return deny('untrusted origin');
  }
  next();
};

// ---------------------------------------------------------------------------------------------------------------
// Rate limits. By IP before sign-in, by account after it, so one person cannot exhaust shared resources and
// people behind one address are not punished for each other.
// ---------------------------------------------------------------------------------------------------------------
export function limiter(o: { windowMs: number; limit: number; by: 'ip' | 'user'; name?: string }) {
  return rateLimit({
    windowMs: o.windowMs, limit: o.limit, standardHeaders: 'draft-7', legacyHeaders: false,
    keyGenerator: (req, res) => `${o.name ?? ''}:${o.by === 'user' && res.locals.userId ? `u:${res.locals.userId}` : `ip:${req.ip}`}`,
    handler: (req, res) => {
      log('warn', 'rate limited', { requestId: res.locals.requestId, route: routeOf(req), userId: res.locals.userId ?? null, name: o.name });
      res.status(429).json({ error: 'RATE_LIMITED', message: 'Too many requests. Please wait a little and try again.' });
    },
  });
}
