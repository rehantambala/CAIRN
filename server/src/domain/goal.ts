import { PLATFORM_RULES, ratingEffect, type ScoreInputs } from './score.js';
import { PLATFORM_LABEL, type RatedPlatform } from './types.js';

/**
 * What to do once the target has been reached. Pure and deterministic; no I/O and no model.
 *
 * The design rests on four findings, listed with their sources in docs/DECISIONS.md:
 *  - goal-setting theory: specific, difficult goals sustain effort, and effort tends to slacken once a goal is
 *    met unless another replaces it (Locke and Latham, 2002);
 *  - the goal-gradient effect: effort rises as a goal nears and resets after it is met (Kivetz et al., 2006);
 *  - self-determination theory: a person who chooses the next goal, and who is working towards competence rather
 *    than a bare total, sustains motivation better (Ryan and Deci, 2000);
 *  - implementation intentions: a plan of the form "when X, I will Y" converts intention into action
 *    (Gollwitzer and Sheeran, 2006).
 *
 * Nothing here changes a figure. The person adopts an option explicitly; the app never moves a target by itself.
 */

export type GoalOptionId = 'consolidate' | 'stretch' | 'mastery';

export interface GoalOption {
  id: GoalOptionId;
  title: string;
  /** What the target becomes. */
  detail: string;
  /** Why this option, in terms of the person's own figures. */
  reason: string;
  targetScore: number;
  /** Days from today to the suggested date. */
  days: number;
}

export interface GoalReview {
  reached: boolean;
  current: number;
  target: number;
  overshoot: number;
  options: GoalOption[];
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
/** Round up to the next 500, so that a target reads as a deliberate figure and never as a calculation artefact. */
export const roundUp500 = (n: number) => Math.ceil(n / 500) * 500;
const fmt = (n: number) => n.toLocaleString('en-GB');

/** Days needed to cover `gain` points at the recent rate, bounded so the date is neither trivial nor remote. */
function daysFor(gain: number, velocity: number | null, lo: number, hi: number, fallback: number): number {
  if (velocity === null || velocity <= 0) return fallback;
  return clamp(Math.ceil(gain / velocity), lo, hi);
}

/**
 * The rated platform whose next rating milestone is nearest, among those the person has connected.
 * Milestone: the point at which the rating term begins to score, or, once past it, a further 100 points.
 */
function nearestRatingGoal(inputs: ScoreInputs, known: RatedPlatform[]) {
  let best: { platform: RatedPlatform; from: number; to: number; effect: number; belowBase: boolean } | null = null;
  for (const platform of known) {
    const base = PLATFORM_RULES[platform].ratingBase;
    const from = inputs[platform].rating;
    const belowBase = from <= base;                      // the rating term is still zero
    const to = from < base + 100 ? base + 100 : from + 100;
    const effect = ratingEffect(platform, from, to);
    if (!best || to - from < best.to - best.from) best = { platform, from, to, effect, belowBase };
  }
  return best;
}

export function goalReview(
  inputs: ScoreInputs, current: number, target: number, known: RatedPlatform[], velocity: number | null,
): GoalReview {
  const reached = current >= target;
  const base: GoalReview = { reached, current, target, overshoot: Math.max(0, current - target), options: [] };
  if (!reached) return base;

  const consolidate = Math.max(roundUp500(current * 1.1), current + 500);
  const stretch = Math.max(roundUp500(current * 1.25), consolidate + 500);
  const options: GoalOption[] = [
    {
      id: 'consolidate',
      title: 'Consolidate',
      detail: `A target of ${fmt(consolidate)}, ${fmt(consolidate - current)} points above your score.`,
      reason: 'A near goal restores the rise in effort that accompanies the final stretch, and a figure that is attainable on your recent pace keeps the evidence of progress frequent.',
      targetScore: consolidate,
      days: daysFor(consolidate - current, velocity, 30, 120, 60),
    },
    {
      id: 'stretch',
      title: 'Stretch',
      detail: `A target of ${fmt(stretch)}, ${fmt(stretch - current)} points above your score.`,
      reason: 'Difficult, specific goals produce higher performance than easy ones, provided you judge them attainable. This suits a period in which your rate of gain has been steady.',
      targetScore: stretch,
      days: daysFor(stretch - current, velocity, 60, 270, 150),
    },
  ];

  const rating = nearestRatingGoal(inputs, known);
  if (rating) {
    const label = PLATFORM_LABEL[rating.platform];
    const mastery = Math.max(roundUp500(current + rating.effect), consolidate);
    options.push({
      id: 'mastery',
      title: `Raise your ${label} rating`,
      detail: `A rating of ${rating.to} on ${label}, from ${rating.from}, which adds ${fmt(Math.floor(rating.effect))} points; target ${fmt(mastery)}.`,
      reason: rating.belowBase
        ? 'The rating term scores nothing until the platform baseline is passed. A goal tied to skill, rather than to a total, is the form most associated with lasting motivation.'
        : 'The rating term is squared, so it is the largest single lever. A goal tied to skill, rather than to a total, is the form most associated with lasting motivation.',
      targetScore: mastery,
      days: 120,
    });
  }
  return { ...base, options };
}
