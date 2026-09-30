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
    'No approved automatic route exists for personal submissions. Import your own figures; problems are added by import or by your own confirmation.'),
  codechef: unavailable('codechef', 'IMPORT',
    'No official interface exists for personal submissions. Import your own figures; problems are added by import or by your own confirmation.'),
  smartinterviews: unavailable('smartinterviews', 'MANUAL', 'No credentials are stored and no sign-in is automated. Enter your own score contribution.'),
  interviewbit: unavailable('interviewbit', 'MANUAL', 'No public interface exists. Enter your own score contribution.'),
  hackerrank: unavailable('hackerrank', 'MANUAL', 'No interface exists for personal statistics. Enter your own score contribution.'),
};
