import { createCodeforcesAdapter } from './codeforces.js';
import { createCodeChefAdapter } from './codechef.js';
import { createLeetCodeAdapter } from './leetcode.js';
import type { PlatformAdapter } from './types.js';
import type { Platform } from '../domain/types.js';

const manual = (platform: Platform, note: string): PlatformAdapter => ({
  platform, capability: 'MANUAL', capabilityNote: note, sourceState: 'MANUAL',
});

export const cfAdapter = createCodeforcesAdapter();

export const ADAPTERS: Record<Platform, PlatformAdapter> = {
  codeforces: cfAdapter,
  leetcode: createLeetCodeAdapter(),
  codechef: createCodeChefAdapter(),
  smartinterviews: manual('smartinterviews', 'Smart Interviews has no public interface and requires a sign-in, which this application will not automate. Enter the score shown on your leaderboard.'),
  interviewbit: manual('interviewbit', 'InterviewBit has no public interface for personal statistics. Enter the score shown on your profile.'),
  hackerrank: manual('hackerrank', 'HackerRank has no interface for the figure used in this score. Enter your own contribution.'),
};

export const AUTOMATIC_PLATFORMS: Platform[] = (Object.keys(ADAPTERS) as Platform[]).filter((p) => ADAPTERS[p].capability === 'AUTOMATIC');
