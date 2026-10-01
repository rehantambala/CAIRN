import type { Db } from '../db/pool.js';
import { tx } from '../db/pool.js';

/**
 * Data classification (see SECURITY.md):
 *   GLOBAL      problems, contests, source_health      shared by everyone, kept when an account is deleted
 *   SYSTEM      schema_migrations, kv (job leases)     operational
 *   USER-OWNED  every table below with a user_id        reachable only through the signed-in user's id
 *   SENSITIVE   users.password_hash, sessions.token_hash, push_subscriptions.p256dh/auth  never exported or returned
 * Every user-owned table references users(id) with ON DELETE CASCADE, so deleting the user row removes them all.
 */
export const USER_OWNED_TABLES = [
  'auth_identities', 'sessions', 'platform_accounts', 'platform_stats', 'submissions', 'solved_problems',
  'contest_participations', 'contest_commitments', 'rating_history', 'score_snapshots', 'daily_objectives',
  'activity_events', 'notifications', 'push_subscriptions', 'awards', 'strategist_notes',
] as const;

const userKvKeys = (userId: string) => [`detected:${userId}`, `detect-run:${userId}`];

/** The signed-in person's own data. Column lists are explicit, so a new sensitive column is never exported by accident. */
export async function exportAccount(db: Db, userId: string) {
  const q = async (sql: string) => (await db.query(sql, [userId])).rows;
  const [user] = await q(`select id, email, display_name, timezone, target_score, target_date, daily_minutes, github_login,
      remind_enabled, remind_24h, remind_1h, remind_10m, created_at, updated_at, last_seen_at from users where id=$1`);
  return {
    format: 'cairn-export/1',
    exportedAt: new Date().toISOString(),
    profile: user ?? null,
    signInMethods: await q(`select provider, provider_login, provider_email, created_at from auth_identities where user_id=$1 order by created_at`),
    codingProfiles: await q(`select platform, username, connection_status, verified_at, last_synced_at, disconnected_at, created_at
      from platform_accounts where user_id=$1 order by platform`),
    statistics: await q(`select platform, base_problems, base_contests, base_as_of, rating, contribution, source_status, last_updated_at
      from platform_stats where user_id=$1 order by platform`),
    solvedProblems: await q(`select s.platform, s.external_problem_id, p.title, s.first_accepted_at, s.source
      from solved_problems s left join problems p on p.platform = s.platform and p.external_problem_id = s.external_problem_id
      where s.user_id=$1 order by s.first_accepted_at`),
    submissions: await q(`select platform, external_submission_id, external_problem_id, verdict, submitted_at, accepted_at
      from submissions where user_id=$1 order by submitted_at`),
    ratingHistory: await q(`select platform, rating, contest_external_id, recorded_at from rating_history where user_id=$1 order by recorded_at`),
    scoreHistory: await q(`select overall_score, leetcode_score, codechef_score, codeforces_score, smart_interviews_score, interviewbit_score,
      hackerrank_score, captured_at from score_snapshots where user_id=$1 order by captured_at`),
    contestParticipation: await q(`select c.platform, c.title, c.start_at, cp.participated, cp.rating_before, cp.rating_after, cp.rating_delta, cp.source
      from contest_participations cp join contests c on c.id = cp.contest_id where cp.user_id=$1 order by c.start_at`),
    contestCommitments: await q(`select c.platform, c.title, c.start_at, cm.prep_minutes, cm.committed_at
      from contest_commitments cm join contests c on c.id = cm.contest_id where cm.user_id=$1 order by c.start_at`),
    executionRecord: await q(`select o.date, o.status, o.is_rest, o.target_score_delta, o.score_at_start, o.score_at_close, o.completed_at,
      coalesce(json_agg(json_build_object('type', i.type, 'platform', i.platform, 'title', i.title, 'quota', i.quota,
        'completedCount', i.completed_count, 'completed', i.completed, 'verification', i.verification) order by i.position)
        filter (where i.id is not null), '[]') as items
      from daily_objectives o left join daily_objective_items i on i.objective_id = o.id
      where o.user_id=$1 group by o.id order by o.date`),
    awards: await q(`select award_type, achieved_at from awards where user_id=$1 order by achieved_at`),
    notifications: await q(`select type, status, scheduled_for, delivered_at from notifications where user_id=$1 order by scheduled_for`),
    activity: await q(`select event_type, platform, created_at from activity_events where user_id=$1 order by created_at`),
    strategistNotes: await q(`select date, body_json, created_at from strategist_notes where user_id=$1 order by date`),
    devicesForReminders: (await q(`select count(*)::int as n from push_subscriptions where user_id=$1`))[0]?.n ?? 0,
  };
}

/** Removes the account and all of its data in one transaction. Global data is untouched. */
export async function deleteAccount(_db: Db, userId: string): Promise<void> {
  await tx(async (c) => {
    await c.query('delete from kv where key = any($1::text[])', [userKvKeys(userId)]);
    await c.query('delete from users where id=$1', [userId]);   // cascades to every USER_OWNED_TABLES row
  });
}
