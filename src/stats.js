import { parseProblemRef } from './leetcode.js';
import { activeMsBetween, DEFAULT_IDLE_MS, practiceDays, practiceSummary, startOfWeek } from './tracking.js';
import { topicName } from './topics.js';

// Analytics: every number /stats, /next and the home screen show, computed from your own
// attempts in bokken's database. Nothing here talks to LeetCode.

export const DIFFICULTIES = ['Easy', 'Medium', 'Hard'];
/** A topic needs this many solves before it's ranked. */
export const MIN_SOLVES = 3;

/**
 * Your finished bokken attempts (solved or given up), oldest first, with each problem's
 * difficulty and topics. Unfinished ones are still going, so they don't count yet.
 */
export function finishedAttempts(db) {
  const rows = db
    .prepare(
      `SELECT a.*, coalesce(c.difficulty, json_extract(p.data, '$.difficulty'), 'Unknown') AS difficulty
       FROM attempts a
       LEFT JOIN catalog c ON c.slug = a.slug
       LEFT JOIN problems p ON p.slug = a.slug
       WHERE a.source = 'bokken' AND a.outcome IN ('solved', 'abandoned')
       ORDER BY a.started_at`,
    )
    .all();
  const topics = new Map();
  for (const row of db.prepare('SELECT slug, topic_slug FROM problem_topics WHERE slug IN (SELECT slug FROM attempts)').all()) {
    if (!topics.has(row.slug)) topics.set(row.slug, []);
    topics.get(row.slug).push(row.topic_slug);
  }
  return rows.map((row) => ({ ...row, topics: topics.get(row.slug) ?? [] }));
}

/**
 * How much help an attempt needed, from 0 to 1. Viewing the solution or giving up counts
 * most (1), then AI hints (0.5), then LeetCode's own hints (0.25).
 */
export function helpWeight(attempt) {
  if (attempt.outcome === 'abandoned' || attempt.viewed_solution) return 1;
  if (attempt.ai_level > 0) return 0.5;
  if (attempt.hints_seen > 0) return 0.25;
  return 0;
}

/** Your median solve time (seconds) at each difficulty, across every topic. */
export function usualTimes(attempts) {
  const usual = {};
  for (const difficulty of DIFFICULTIES) {
    usual[difficulty] = median(attempts.filter((a) => a.outcome === 'solved' && a.difficulty === difficulty).map((a) => a.active_sec));
  }
  return usual;
}

/**
 * The numbers for a group of attempts (a topic, a difficulty). Submission numbers are null
 * when none of them were submitted (solved with /done, without logging in).
 */
export function summarize(attempts, usual) {
  const solved = attempts.filter((a) => a.outcome === 'solved');
  const submitted = solved.filter((a) => a.submissions > 0);
  const submissions = sum(attempts.map((a) => a.submissions));
  const ratios = solved.filter((a) => usual[a.difficulty] > 0).map((a) => a.active_sec / usual[a.difficulty]);
  const summary = {
    attempts: attempts.length,
    solves: solved.length,
    problems: new Set(solved.map((a) => a.slug)).size,
    gaveUp: attempts.filter((a) => a.outcome === 'abandoned').length,
    medianSec: median(solved.map((a) => a.active_sec)),
    firstTryRate: submitted.length ? submitted.filter((a) => a.wrong_submissions === 0).length / submitted.length : null,
    submissionsToAccepted: submitted.length ? sum(submitted.map((a) => a.submissions)) / submitted.length : null,
    helped: attempts.filter((a) => helpWeight(a) > 0).length,
    helpRate: attempts.length ? sum(attempts.map(helpWeight)) / attempts.length : 0,
    wrongRate: submissions ? sum(attempts.map((a) => a.wrong_submissions)) / submissions : null,
    timeRatio: median(ratios),
  };
  return { ...summary, score: weaknessScore(summary) };
}

/**
 * How weak a topic is, from 0 to 1, or null below MIN_SOLVES. A mix of your time against
 * your usual time at the same difficulty (twice as slow or more scores 1), your wrong
 * submissions and the help you needed. Without submissions, time and help share the weight.
 */
export function weaknessScore({ solves, timeRatio, wrongRate, helpRate }) {
  if (solves < MIN_SOLVES) return null;
  const parts = [
    [0.4, Math.min(1, (timeRatio ?? 1) / 2)],
    [0.3, wrongRate],
    [0.3, helpRate],
  ].filter(([, value]) => value !== null);
  return sum(parts.map(([weight, value]) => weight * value)) / sum(parts.map(([weight]) => weight));
}

/**
 * One row per topic you've finished an attempt in: ranked ones (enough solves) weakest
 * first, then the rest, most solved first.
 */
export function topicStats(db, attempts = finishedAttempts(db)) {
  const usual = usualTimes(attempts);
  const slugs = [...new Set(attempts.flatMap((a) => a.topics))];
  const rows = slugs.map((slug) => ({ slug, name: topicName(db, slug), ...summarize(attempts.filter((a) => a.topics.includes(slug)), usual) }));
  return rows.sort((a, b) => {
    if ((a.score === null) !== (b.score === null)) return a.score === null ? 1 : -1;
    if (a.score !== null && a.score !== b.score) return b.score - a.score;
    return b.solves - a.solves || a.name.localeCompare(b.name);
  });
}

/** Easy, Medium and Hard, each with the same numbers as a topic. */
export function difficultyStats(db, attempts = finishedAttempts(db)) {
  const usual = usualTimes(attempts);
  return DIFFICULTIES.map((difficulty) => ({ difficulty, ...summarize(attempts.filter((a) => a.difficulty === difficulty), usual) }));
}

/**
 * The overview: problems solved, attempts, time, streak, this week against last.
 * `leetcode` is what LeetCode's problem list says you've solved, when bokken has it.
 */
export function overview(db, { now = new Date(), idleMs = DEFAULT_IDLE_MS, progress = false } = {}) {
  const solvedBy = (rows) => {
    const counts = Object.fromEntries(DIFFICULTIES.map((d) => [d, 0]));
    for (const { difficulty, n } of rows) if (difficulty in counts) counts[difficulty] = n;
    return { ...counts, total: sum(Object.values(counts)) };
  };
  const solved = db
    .prepare(
      `SELECT difficulty, count(*) AS n FROM (
         SELECT DISTINCT a.slug, coalesce(c.difficulty, json_extract(p.data, '$.difficulty')) AS difficulty
         FROM attempts a LEFT JOIN catalog c ON c.slug = a.slug LEFT JOIN problems p ON p.slug = a.slug
         WHERE a.source = 'bokken' AND a.outcome = 'solved'
       ) GROUP BY difficulty`,
    )
    .all();
  const outcomes = Object.fromEntries(
    db.prepare("SELECT outcome, count(*) AS n FROM attempts WHERE source = 'bokken' GROUP BY outcome").all().map((row) => [row.outcome, row.n]),
  );
  const monday = startOfWeek(now);
  const lastMonday = new Date(monday);
  lastMonday.setDate(lastMonday.getDate() - 7);
  const { weekMs, streakDays } = practiceSummary(db, { now, idleMs });
  return {
    solved: solvedBy(solved),
    attempts: { solved: outcomes.solved ?? 0, gaveUp: outcomes.abandoned ?? 0, active: outcomes.active ?? 0 },
    activeSec: db.prepare("SELECT coalesce(sum(active_sec), 0) AS s FROM attempts WHERE source = 'bokken'").get().s,
    activeDays: practiceDays(db).size,
    streakDays,
    weekSec: seconds(weekMs),
    lastWeekSec: seconds(activeMsBetween(db, lastMonday, monday, { idleMs })),
    leetcode: progress ? solvedBy(db.prepare("SELECT difficulty, count(*) AS n FROM catalog WHERE status = 'ac' GROUP BY difficulty").all()) : null,
  };
}

/**
 * The last `weeks` weeks, oldest first: active time, and your median solve time at each
 * difficulty for the problems solved that week (null when there were none). Times in seconds.
 */
export function trend(db, { now = new Date(), idleMs = DEFAULT_IDLE_MS, weeks = 8 } = {}) {
  const solved = finishedAttempts(db).filter((a) => a.outcome === 'solved' && a.ended_at);
  const thisWeek = startOfWeek(now).getTime();
  return Array.from({ length: weeks }, (_, i) => {
    // Day by day rather than 7 × 24 hours, so a daylight saving change doesn't shift the weeks.
    const start = new Date(thisWeek);
    start.setDate(start.getDate() - 7 * (weeks - 1 - i));
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    const inWeek = solved.filter((a) => new Date(a.ended_at) >= start && new Date(a.ended_at) < end);
    const medianSec = Object.fromEntries(DIFFICULTIES.map((d) => [d, median(inWeek.filter((a) => a.difficulty === d).map((a) => a.active_sec))]));
    return { start, activeSec: seconds(activeMsBetween(db, start, end, { idleMs })), solved: inWeek.length, medianSec };
  });
}

export const VIEWS = ['overview', 'topics', 'difficulty', 'trend'];

/**
 * One `/stats` view as data, for the screen and for `bokken stats --json`. Anything that
 * isn't a view's name is a problem (a number, slug, title or link): its attempts.
 * Every time is in seconds.
 */
export function statsView(db, view = 'overview', { now = new Date(), idleMs = DEFAULT_IDLE_MS, progress = false } = {}) {
  if (view === 'overview') return { view, ...overview(db, { now, idleMs, progress }) };
  if (view === 'topics') return { view, topics: topicStats(db) };
  if (view === 'difficulty') return { view, difficulties: difficultyStats(db) };
  if (view === 'trend') return { view, weeks: trend(db, { now, idleMs }) };
  const slug = attemptedSlug(db, view);
  const history = slug && problemHistory(db, slug);
  return history ? { view: 'problem', ...history } : { view: 'problem', error: `No attempts at "${view}" yet. Try /stats with topics, difficulty or trend.` };
}

/** The slug of a problem from a number, slug, title or link, from what bokken has: no requests. */
function attemptedSlug(db, text) {
  const ref = parseProblemRef(text);
  if (ref.frontendId) return db.prepare('SELECT slug FROM catalog WHERE frontend_id = ?').get(ref.frontendId)?.slug ?? null;
  if (db.prepare('SELECT 1 FROM attempts WHERE slug = ?').get(ref.slug)) return ref.slug;
  return ref.title ? (db.prepare('SELECT slug FROM catalog WHERE title = ? COLLATE NOCASE').get(ref.title)?.slug ?? null) : null;
}

/** Every attempt at one problem, oldest first, unfinished ones included. Null when there are none. */
export function problemHistory(db, slug) {
  const rows = db.prepare("SELECT * FROM attempts WHERE slug = ? AND source = 'bokken' ORDER BY started_at").all(slug);
  if (!rows.length) return null;
  const problem = db.prepare('SELECT frontend_id, title, difficulty FROM catalog WHERE slug = ?').get(slug);
  return {
    slug,
    frontendId: problem?.frontend_id ?? null,
    title: problem?.title ?? slug,
    difficulty: problem?.difficulty ?? null,
    attempts: rows.map((a) => ({
      startedAt: a.started_at,
      endedAt: a.ended_at,
      outcome: a.outcome,
      activeSec: a.active_sec,
      runs: a.runs,
      submissions: a.submissions,
      wrongSubmissions: a.wrong_submissions,
      hintsSeen: a.hints_seen,
      aiLevel: a.ai_level,
      viewedSolution: Boolean(a.viewed_solution),
    })),
  };
}

export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function seconds(ms) {
  return Math.round(ms / 1000);
}
