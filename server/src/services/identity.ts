import { config } from '../config.js';
import type { Db } from '../db/pool.js';

/**
 * The CAIRN identity is users.id. Google and GitHub are only ways of proving who is signing in;
 * each verified provider identity points at exactly one CAIRN user.
 */
export type Provider = 'google' | 'github';

export interface ProviderProfile {
  provider: Provider;
  providerUserId: string;       // Google "sub" / GitHub numeric id: stable, never an email or a login
  email: string | null;
  emailVerified: boolean;
  login: string | null;
  name: string | null;
  avatarUrl: string | null;
}

export type Outcome = 'SIGNED_IN' | 'CREATED' | 'LINKED' | 'CONFLICT';

/** Provider-supplied names are untrusted text: control characters are removed and the length is bounded. */
const cleanName = (v: string | null) => (v ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, 60);

export const validTimezone = (tz: unknown): tz is string => {
  if (typeof tz !== 'string' || tz.length > 64) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; }
};

/**
 * Resolves a verified provider identity to a CAIRN user.
 *  1. A known identity signs its user in (or, while someone else is signed in, is refused as a conflict).
 *  2. While signed in, an unknown identity is linked to the signed-in user.
 *  3. Bootstrap: the existing owner's first GitHub sign-in (OWNER_GITHUB, a numeric GitHub id) or a Google address
 *     verified by Google that equals OWNER_EMAIL is attached to that account rather than duplicating it.
 *  4. Otherwise a new user is created.
 * Display names are never used to match accounts.
 */
export async function resolveIdentity(db: Db, p: ProviderProfile, currentUserId: string | null, tz: string | null): Promise<{ userId: string | null; outcome: Outcome }> {
  const known = (await db.query('select user_id from auth_identities where provider=$1 and provider_user_id=$2', [p.provider, p.providerUserId])).rows[0];
  if (known) {
    if (currentUserId && known.user_id !== currentUserId) return { userId: currentUserId, outcome: 'CONFLICT' };
    await db.query(
      `update auth_identities set provider_email=$3, provider_login=$4, updated_at=now() where provider=$1 and provider_user_id=$2`,
      [p.provider, p.providerUserId, p.email, p.login],
    );
    await touchProfile(db, known.user_id, p);
    return { userId: known.user_id, outcome: 'SIGNED_IN' };
  }

  let target: string | null = currentUserId;
  let outcome: Outcome = 'LINKED';
  if (!target && config.ownerEmail) {
    // Bootstrap of the one pre-existing account only. Nobody else's account is ever matched by an email or a name.
    //   GitHub: the configured numeric user id (immutable), never a login name, which can change hands.
    //   Google: an address Google itself has verified that equals OWNER_EMAIL exactly.
    const ownerGithubId = /^[1-9][0-9]{0,19}$/.test(config.ownerGithub) ? config.ownerGithub : null;
    const isOwner = (p.provider === 'github' && ownerGithubId !== null && p.providerUserId === ownerGithubId)
      || (p.provider === 'google' && p.emailVerified && !!p.email && p.email.toLowerCase() === config.ownerEmail);
    if (isOwner) {
      target = (await db.query('select id from users where lower(email)=$1 and password_hash is not null', [config.ownerEmail])).rows[0]?.id ?? null;
      if (target) outcome = 'SIGNED_IN';
    }
  }
  if (target) {
    // A user holds at most one identity per provider; a second, different one is refused rather than replacing it.
    const has = (await db.query('select 1 from auth_identities where user_id=$1 and provider=$2', [target, p.provider])).rowCount;
    if (has) return { userId: currentUserId, outcome: 'CONFLICT' };
  } else {
    const email = p.provider === 'google' && p.emailVerified ? p.email : null;   // only a verified address is stored on the user
    target = (await db.query(
      `insert into users(email, display_name, avatar_url, timezone) values ($1,$2,$3,$4) returning id`,
      [email, cleanName(p.name) || cleanName(p.login) || 'New member', p.avatarUrl, validTimezone(tz) ? tz : 'UTC'],
    )).rows[0].id as string;
    outcome = 'CREATED';
  }
  await db.query(
    `insert into auth_identities(user_id, provider, provider_user_id, provider_email, provider_login) values ($1,$2,$3,$4,$5)`,
    [target, p.provider, p.providerUserId, p.email, p.login],
  );
  await touchProfile(db, target, p);
  return { userId: target, outcome };
}

async function touchProfile(db: Db, userId: string, p: ProviderProfile) {
  await db.query(
    `update users set avatar_url = coalesce(avatar_url, $2), github_login = case when $3::text is not null then $3 else github_login end,
       last_seen_at = now(), updated_at = now() where id=$1`,
    [userId, p.avatarUrl, p.provider === 'github' ? p.login : null],
  );
}

/** Removing a sign-in method is allowed only while another way to sign in remains. */
export async function unlinkIdentity(db: Db, userId: string, provider: Provider): Promise<'REMOVED' | 'LAST_METHOD' | 'NOT_LINKED'> {
  const ids = (await db.query('select provider from auth_identities where user_id=$1', [userId])).rows.map((r) => r.provider as string);
  if (!ids.includes(provider)) return 'NOT_LINKED';
  const hasPassword = !!(await db.query('select password_hash from users where id=$1', [userId])).rows[0]?.password_hash;
  if (ids.length === 1 && !hasPassword) return 'LAST_METHOD';
  await db.query('delete from auth_identities where user_id=$1 and provider=$2', [userId, provider]);
  return 'REMOVED';
}

export async function identitiesOf(db: Db, userId: string) {
  return (await db.query('select provider, provider_email, provider_login, created_at from auth_identities where user_id=$1 order by created_at', [userId]))
    .rows.map((r) => ({ provider: r.provider as Provider, email: r.provider_email as string | null, login: r.provider_login as string | null, linkedAt: r.created_at as Date }));
}
