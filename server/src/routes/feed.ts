import { Router } from 'express';
import { pool } from '../db/pool.js';
import { feedCalendar, userForToken } from '../services/calendarFeed.js';
import { limiter, log, routeOf } from './security.js';

/**
 * The private calendar link. It is authenticated by the secret token in its address alone, because calendar
 * applications cannot send cookies. The token is random, 256 bits, stored only as a hash, replaceable and
 * revocable, and the link only ever reads: it cannot change any figure.
 */
export const feedRouter = Router();
feedRouter.use(limiter({ windowMs: 60_000, limit: 60, by: 'ip', name: 'feed' }));

feedRouter.get('/:file', async (req, res) => {
  try {
    const m = /^([A-Za-z0-9_-]{43})\.ics$/.exec(req.params.file);
    const userId = m ? await userForToken(pool, m[1]) : null;
    if (!userId) return res.status(404).json({ error: 'NOT_FOUND' });
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="cairn.ics"');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.send(await feedCalendar(pool, userId, Date.now()));
  } catch (e: any) {
    log('error', 'feed failed', { requestId: res.locals.requestId, route: routeOf(req), error: String(e?.message ?? e) });
    res.status(500).json({ error: 'INTERNAL', requestId: res.locals.requestId });
  }
});
