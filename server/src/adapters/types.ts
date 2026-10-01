import type { Platform, SourceState } from '../domain/types.js';

export interface NormalizedSubmission {
  externalSubmissionId: string;
  externalProblemId: string;
  title: string;
  url: string;
  difficulty: string | null;
  verdict: string;
  submittedAt: Date;
  accepted: boolean;
  contestExternalId: string | null;
  /** true if submitted while the contest was running (counts as participation) */
  inContest: boolean;
}

export interface NormalizedContest {
  platform: Platform;
  externalContestId: string;
  title: string;
  startAt: Date;
  endAt: Date;
  registrationUrl: string | null;
  contestUrl: string | null;
  rated: boolean;
  phase: 'UPCOMING' | 'LIVE' | 'FINISHED';
}

export interface RatingPoint {
  contestExternalId: string;
  contestName: string;
  oldRating: number;
  newRating: number;
  at: Date;
}

export interface Profile { handle: string; rating: number | null; maxRating: number | null }

/**
 * Authoritative lifetime totals as published on the platform's own profile.
 * When an adapter provides them they replace the derived baseline on every synchronisation.
 */
export interface Totals { problems: number; contests: number; rating: number | null }

/** The platform answered and says the handle does not exist (as opposed to the source being unreachable). */
export class ProfileNotFound extends Error {
  constructor(public platform: Platform, handle: string) { super(handle ? `No public profile exists with the handle "${handle}".` : 'No public profile exists with that handle.'); }
}

export class AdapterUnavailable extends Error {
  constructor(public platform: Platform, message: string) { super(message); }
}

/**
 * Not every platform supports every method. Methods a platform cannot support
 * legitimately are left undefined; the UI then offers import/manual instead.
 */
export interface PlatformAdapter {
  platform: Platform;
  /** what the adapter can do automatically, shown in Settings */
  capability: 'AUTOMATIC' | 'IMPORT' | 'MANUAL';
  capabilityNote: string;
  getProfile?(handle: string): Promise<Profile>;
  getStats?(handle: string): Promise<{ rating: number | null }>;
  getTotals?(handle: string): Promise<Totals>;
  getSubmissions?(handle: string): Promise<NormalizedSubmission[]>;
  getContests?(): Promise<NormalizedContest[]>;
  getContestParticipation?(handle: string): Promise<{ contestExternalId: string }[]>;
  getRatingHistory?(handle: string): Promise<RatingPoint[]>;
  /** state to label data fetched by this adapter at the moment of fetching */
  sourceState: SourceState;
}

/** What a source can actually provide, derived from the methods it implements; nothing is forced. */
export function capabilitiesOf(a: PlatformAdapter) {
  return {
    profile: !!a.getProfile, submissions: !!a.getSubmissions, rating: !!(a.getRatingHistory || a.getTotals || a.getProfile),
    contests: !!a.getContests, contestParticipation: !!(a.getRatingHistory || a.getContestParticipation || a.getTotals),
  };
}
