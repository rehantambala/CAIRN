import type { Db } from '../db/pool.js';
import { pickNext, type ItemProgress, type NextAction, type ObjectiveItem } from '../domain/objective.js';
import { computeTrajectory } from '../domain/trajectory.js';
import { dayKey } from '../domain/time.js';
import { ensureObjective, loadContestCandidates, loadSnapshots, type ObjectiveRow } from './derived.js';
import { getUser, loadScore } from './state.js';

/** Builds today's objective view and the single NEXT action from real state. */
export async function computeToday(db: Db, userId: string, now: number): Promise<{ objective: ObjectiveRow; next: NextAction }> {
  const user = await getUser(db, userId);
  const objective = await ensureObjective(db, userId, now);
  const contests = await loadContestCandidates(db, userId, now);
  const progress: ItemProgress[] = objective.items.map((i) => ({
    item: {
      type: i.type as ObjectiveItem['type'], platform: i.platform, contestId: i.contestId, title: i.title, reason: i.reason,
      required: i.required, quota: i.quota, minutes: i.minutes, points: i.points, suggestions: i.suggestions,
      practiceUrl: i.practiceUrl, guidance: i.guidance,
    },
    done: i.completedCount, completed: i.completed,
  }));
  const next = pickNext(progress, contests, now, user.timezone);
  return { objective, next };
}

export async function computeTrajectoryFor(db: Db, userId: string, now: number) {
  const user = await getUser(db, userId);
  const snapshots = await loadSnapshots(db, userId);
  const { score } = await loadScore(db, userId);
  const t = computeTrajectory({ snapshots, now, target: user.targetScore, targetDate: user.targetDate, tz: user.timezone });
  void dayKey;
  return { trajectory: t, score };
}
