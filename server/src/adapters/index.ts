import { config } from '../config.js';
import { createCodeforcesAdapter } from './codeforces.js';
import { createCodeChefAdapter } from './codechef.js';
import { createLeetCodeAdapter } from './leetcode.js';
import type { PlatformAdapter } from './types.js';
import type { Platform } from '../domain/types.js';

/**
 * One adapter per platform, each implementing only what its source actually provides. Adding a platform means
 * adding an adapter here plus its label and score rule; authentication, contests and reminders do not change.
 */
const manual = (platform: Platform, note: string): PlatformAdapter => ({
  platform, capability: 'MANUAL', capabilityNote: note, sourceState: 'MANUAL',
});
/** A source that exists but is switched off: the handle is kept, figures are entered, nothing is read. */
const switchedOff = (a: PlatformAdapter, note: string): PlatformAdapter => ({
  platform: a.platform, capability: 'IMPORT', capabilityNote: note, sourceState: 'IMPORTED',
});

export const cfAdapter = createCodeforcesAdapter();

export const ADAPTERS: Record<Platform, PlatformAdapter> = {
  codeforces: cfAdapter,
  leetcode: config.sources.leetcode ? createLeetCodeAdapter()
    : switchedOff(createLeetCodeAdapter(), 'Automatic reading of LeetCode is switched off on this server. Enter the figures shown on your profile.'),
  codechef: config.sources.codechefProfile ? createCodeChefAdapter()
    : switchedOff(createCodeChefAdapter(), 'CodeChef publishes no profile interface and its terms prohibit automated reading of profile pages, so your figures are entered here. Contests are still read from CodeChef’s own listing.'),
  smartinterviews: manual('smartinterviews', 'Smart Interviews publishes no public interface and requires a sign-in, which CAIRN will never automate. Enter the score shown on your leaderboard.'),
  interviewbit: manual('interviewbit', 'InterviewBit publishes no interface for personal statistics. Enter the score shown on your profile.'),
  hackerrank: manual('hackerrank', 'HackerRank does not permit automated reading of profiles or contests. Enter your own figure.'),
};

export const AUTOMATIC_PLATFORMS: Platform[] = (Object.keys(ADAPTERS) as Platform[]).filter((p) => ADAPTERS[p].capability === 'AUTOMATIC');
