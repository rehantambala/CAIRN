import { createCodeforcesAdapter } from './codeforces.js';
import type { PlatformAdapter } from './types.js';
import type { Platform } from '../domain/types.js';

const unavailable = (platform: Platform, capability: 'IMPORT' | 'MANUAL', note: string): PlatformAdapter => ({
  platform, capability, capabilityNote: note, sourceState: capability === 'IMPORT' ? 'IMPORTED' : 'MANUAL',
});

export const cfAdapter = createCodeforcesAdapter();

export const ADAPTERS: Record<Platform, PlatformAdapter> = {
  codeforces: cfAdapter,
  leetcode: unavailable('leetcode', 'IMPORT',
    'No approved automatic route for personal submissions. Import your own stats; detected problems are added by import or manual confirmation.'),
  codechef: unavailable('codechef', 'IMPORT',
    'No official API for personal submissions. Import your own stats; detected problems are added by import or manual confirmation.'),
  smartinterviews: unavailable('smartinterviews', 'MANUAL', 'No credentials are stored and no login is automated. Enter your own score contribution.'),
  interviewbit: unavailable('interviewbit', 'MANUAL', 'No public API. Enter your own score contribution.'),
  hackerrank: unavailable('hackerrank', 'MANUAL', 'No personal-stats API. Enter your own score contribution.'),
};
