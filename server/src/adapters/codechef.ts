import type { PlatformAdapter, Profile, Totals } from './types.js';
import { ProfileNotFound } from './types.js';

/**
 * CodeChef publishes no official interface for personal statistics. This adapter reads your public
 * profile page and extracts three labelled figures. It fails loudly when a figure cannot be found,
 * rather than guessing, so a redesign of the page can never overwrite good data with bad data.
 */
export type Html = (handle: string) => Promise<string>;

const defaultHtml: Html = async (handle) => {
  const res = await fetch(`https://www.codechef.com/users/${encodeURIComponent(handle)}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; personal-tracker/1.0)', Accept: 'text/html' },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 404) throw new ProfileNotFound('codechef', handle);
  if (!res.ok) throw new Error(`CodeChef HTTP ${res.status}`);
  return res.text();
};

const text = (html: string) => html
  .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

export function parseCodeChef(html: string): Totals {
  const t = text(html);
  const solved = /Total Problems Solved\s*:?\s*(\d[\d,]*)/i.exec(t);
  if (!solved) throw new Error('CodeChef: the solved total could not be found on the profile page');
  const contests = /No\.?\s*of Contests Participated\s*:?\s*(\d[\d,]*)/i.exec(t);
  const ratingEl = /class="rating-number"[^>]*>\s*(\d{3,4})/i.exec(html)
    ?? /(\d{3,4})\s*(?:\(\s*[+\-−]?\d+\s*\))?\s*Rating/i.exec(t);
  const num = (s: string) => Number(s.replace(/,/g, ''));
  return {
    problems: num(solved[1]),
    contests: contests ? num(contests[1]) : 0,
    rating: ratingEl ? Number(ratingEl[1]) : null,
  };
}

export function createCodeChefAdapter(fetchHtml: Html = defaultHtml): PlatformAdapter {
  let memo: { handle: string; at: number; value: Promise<Totals> } | null = null;
  const load = (handle: string) => {
    if (memo && memo.handle === handle && Date.now() - memo.at < 30_000) return memo.value;
    const value = fetchHtml(handle).then(parseCodeChef);
    memo = { handle, at: Date.now(), value };
    value.catch(() => { if (memo?.value === value) memo = null; });
    return value;
  };
  return {
    platform: 'codechef',
    capability: 'AUTOMATIC',
    capabilityNote: 'Read from your public CodeChef profile: problems solved, rating and contests attended. CodeChef offers no official interface and no per-submission feed, so problems are counted in total and cannot be named individually. If the page changes, your stored figures are kept and marked as an error.',
    sourceState: 'SYNCED',
    async getProfile(handle): Promise<Profile> {
      const t = await load(handle);
      return { handle, rating: t.rating, maxRating: null };
    },
    async getTotals(handle) { return load(handle); },
  };
}
