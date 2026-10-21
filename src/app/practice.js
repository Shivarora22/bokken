import os from 'node:os';
import path from 'node:path';
import { getMeta, setMeta } from '../db.js';
import { getDaily, getProblem, lookupProblem } from '../leetcode/problems.js';
import { startAttempt } from '../tracking.js';
import { prepareProblem } from '../workspace.js';

/** Today's problem, fetched once per day. LeetCode's daily problem changes at midnight UTC. */
export async function todaysProblem(ctx, { now = new Date() } = {}) {
  const cached = JSON.parse(getMeta(ctx.db, 'daily') ?? 'null');
  if (cached?.date === now.toISOString().slice(0, 10)) return cached;
  const daily = await getDaily(ctx.client);
  setMeta(ctx.db, 'daily', JSON.stringify(daily));
  return daily;
}

/**
 * Everything `/open` and `/today` need: the problem, its folder and solution file, and the
 * attempt the clock runs on.
 *
 * @param {{ daily?: boolean, ref?: string }} target
 */
export async function loadPractice(ctx, config, target, { now = new Date() } = {}) {
  let slug;
  if (target.daily) {
    slug = (await todaysProblem(ctx, { now })).slug;
  } else {
    const found = await lookupProblem(ctx.db, ctx.client, target.ref, { now });
    if (!found) throw new Error(`No LeetCode problem matches "${target.ref}". Try a number, like /open 1.`);
    slug = found.slug;
  }

  const problem = await getProblem(ctx.db, ctx.client, slug, { now });
  const { dir, file, created, modifiedAt } = prepareProblem(expandHome(config.workspace), problem, config.language);
  const attempt = startAttempt(ctx.db, {
    slug,
    lang: config.language,
    now,
    fileModifiedAt: created ? undefined : modifiedAt,
    idleMs: config.stats.idleMinutes * 60_000,
  });
  return { problem, dir, file, created, attempt };
}

export function expandHome(dir) {
  if (dir === '~') return os.homedir();
  if (dir.startsWith('~/') || dir.startsWith('~\\')) return path.join(os.homedir(), dir.slice(2));
  return path.resolve(dir);
}

export function tildePath(dir) {
  const home = os.homedir();
  return dir === home || dir.startsWith(home + path.sep) ? `~${dir.slice(home.length)}` : dir;
}
