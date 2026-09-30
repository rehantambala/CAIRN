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
  getSubmissions?(handle: string): Promise<NormalizedSubmission[]>;
  getContests?(): Promise<NormalizedContest[]>;
  getContestParticipation?(handle: string): Promise<{ contestExternalId: string }[]>;
  getRatingHistory?(handle: string): Promise<RatingPoint[]>;
  /** state to label data fetched by this adapter at the moment of fetching */
  sourceState: SourceState;
}
