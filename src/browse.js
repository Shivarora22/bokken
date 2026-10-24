import { fetchTopicPage, freshCatalog, leetcodeProgress, TOPIC_PAGE_SIZE, topicProgress } from './leetcode.js';
import { DIFFICULTIES, finishedAttempts, MIN_SOLVES, topicStats } from './stats.js';
import { CORE_TOPICS, findTopic, topicName } from './topics.js';

// Choosing problems: /browse, /random and /next. They work from the problem list and the
// pages of a topic bokken already has. A topic's next page (100 problems) is fetched only when
// those aren't enough, at most one page per command, and each page is kept for a week.

const DIFFICULTY_WORDS = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
const STATUS_WORDS = { solved: 'solved', unsolved: 'unsolved', new: 'unsolved', todo: 'unsolved', tried: 'tried' };

/**
 * Filters in any order: a difficulty, a status (solved, unsolved, tried) and a topic ("dp",
 * "binary search"). `error` says what didn't match.
 *
 * @returns {{ difficulty?: string, status?: string, topic?: { slug: string, name: string }, error?: string }}
 */
export function parseFilters(db, text) {
  const filters = {};
  const rest = [];
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    const lower = word.toLowerCase();
    if (DIFFICULTY_WORDS[lower]) filters.difficulty = DIFFICULTY_WORDS[lower];
    else if (STATUS_WORDS[lower]) filters.status = STATUS_WORDS[lower];
    else rest.push(word);
  }
  if (rest.length) {
    const topic = findTopic(db, rest.join(' '));
    if (!topic) return { ...filters, error: `No topic matches "${rest.join(' ')}". Try one like dp, graph or binary search.` };
    filters.topic = topic;
  }
  return filters;
}

// Solved: in bokken, or on LeetCode when the problem list says so. Tried: started but not solved.
const STATUS = `CASE
  WHEN EXISTS (SELECT 1 FROM attempts a WHERE a.slug = c.slug AND a.outcome = 'solved') OR (? AND c.status = 'ac') THEN 'solved'
  WHEN EXISTS (SELECT 1 FROM attempts a WHERE a.slug = c.slug) OR (? AND c.status = 'notac') THEN 'tried'
END`;

/**
 * The problems that match, by number, from what bokken has: no requests. Premium problems are
 * left out until bokken supports a Premium login. `progress` uses your LeetCode marks.
 *
 * @returns {{ frontendId: number, slug: string, title: string, difficulty: string, acRate: number | null, status: 'solved' | 'tried' | null }[]}
 */
export function listProblems(db, { difficulty, status, topic } = {}, { progress = false } = {}) {
  const where = ['c.paid_only = 0'];
  const params = [];
  if (difficulty) {
    where.push('c.difficulty = ?');
    params.push(difficulty);
  }
  if (topic) {
    where.push('c.slug IN (SELECT slug FROM problem_topics WHERE topic_slug = ?)');
    params.push(topic.slug);
  }
  const mark = progress ? 1 : 0;
  const rows = db
    .prepare(`SELECT c.frontend_id, c.slug, c.title, c.difficulty, c.ac_rate, ${STATUS} AS status FROM catalog c WHERE ${where.join(' AND ')} ORDER BY c.frontend_id`)
    .all(mark, mark, ...params);
  return rows
    .map((row) => ({ frontendId: row.frontend_id, slug: row.slug, title: row.title, difficulty: row.difficulty, acRate: row.ac_rate, status: row.status }))
    .filter((p) => !status || (status === 'unsolved' ? p.status !== 'solved' : p.status === status));
}

/**
 * `/browse`: the problems that match. With a topic, its first page is fetched if bokken
 * doesn't have it this week. `topic` says how many problems the topic has (`total`), how many
 * of them bokken has fetched, and whether there are more to fetch (`nextPage`).
 */
export async function browseProblems(db, client, filters, { now = new Date() } = {}) {
  await freshCatalog(db, client, { now });
  let topic = null;
  if (filters.topic) {
    if (topicProgress(db, filters.topic.slug, { now }).nextPage === 0) await fetchTopicPage(db, client, filters.topic.slug, 0, { now });
    const { total, nextPage } = topicProgress(db, filters.topic.slug, { now });
    topic = { ...filters.topic, total, nextPage, fetched: nextPage === null ? total : Math.min(total, nextPage * TOPIC_PAGE_SIZE) };
  }
  return { problems: listProblems(db, filters, { progress: leetcodeProgress(db, client) }), topic };
}

/** "Load more" in `/browse <topic>`: the topic's next page. False when bokken has them all. */
export async function loadMore(db, client, topicSlug, { now = new Date() } = {}) {
  const { nextPage } = topicProgress(db, topicSlug, { now });
  if (nextPage === null) return false;
  await fetchTopicPage(db, client, topicSlug, nextPage, { now });
  return true;
}

/** `/random`: one of the problems that match, unsolved unless you asked for a status. Null when none do. */
export async function randomProblem(db, client, filters, { now = new Date(), random = Math.random } = {}) {
  const { problems } = await browseProblems(db, client, filters, { now });
  const pool = filters.status ? problems : problems.filter((p) => p.status !== 'solved');
  return pool.length ? pool[Math.floor(random() * pool.length)] : null;
}

/**
 * `/next`: a problem you haven't started, from your weakest topic (or the one you name), at a
 * difficulty you're ready for, the most-accepted first, and why. If the topic's pages bokken
 * has hold no such problem, the next page is fetched.
 *
 * @returns {Promise<{ topic: { slug: string, name: string }, problem: object | null, why: string }>}
 */
export async function nextProblem(db, client, { topic, now = new Date() } = {}) {
  await freshCatalog(db, client, { now });
  const progress = leetcodeProgress(db, client);
  const attempts = finishedAttempts(db);
  // The topic stays the same after fetching a page, even if the page's marks would now pick another.
  const choice = topic ? { topic, why: '' } : chooseTopic(db, attempts, { progress, now });
  let suggestion = suggestIn(db, choice, attempts, { progress });
  if (!suggestion.problem && topicProgress(db, choice.topic.slug, { now }).nextPage !== null) {
    await loadMore(db, client, choice.topic.slug, { now });
    suggestion = suggestIn(db, choice, attempts, { progress });
  }
  return suggestion;
}

/** What `/next` would suggest from what bokken already has, with no requests: for the home screen. */
export function suggestNext(db, { progress = false, now = new Date() } = {}) {
  const attempts = finishedAttempts(db);
  return suggestIn(db, chooseTopic(db, attempts, { progress, now }), attempts, { progress });
}

function suggestIn(db, choice, attempts, { progress }) {
  const level = readyFor(db, choice.topic, attempts, { progress });
  const unstarted = (difficulty) =>
    listProblems(db, { topic: choice.topic, difficulty }, { progress })
      .filter((p) => p.status === null)
      .sort((a, b) => (b.acRate ?? 0) - (a.acRate ?? 0));

  let problem = unstarted(level.difficulty)[0] ?? null;
  let why = level.why;
  for (const difficulty of DIFFICULTIES) {
    if (problem) break;
    problem = unstarted(difficulty)[0] ?? null;
    if (problem) why = `No ${level.difficulty} one left, so ${difficulty}.`;
  }
  return { topic: choice.topic, problem, why: [choice.why, problem ? why : ''].filter(Boolean).join(' ') };
}

/**
 * Your weakest topic when it's clearly weak (two or more ranked, and it scores 0.5 or more).
 * Otherwise the next core topic with fewer than MIN_SOLVES solves, in the usual order. Once
 * you've done them all: your weakest topic, or without two ranked (solves on LeetCode don't
 * rank a topic), the core topic you've solved the fewest problems in. Topics LeetCode has no
 * problems for are skipped.
 */
function chooseTopic(db, attempts, { progress, now }) {
  const ranked = topicStats(db, attempts).filter((row) => row.score !== null);
  const weakest = ranked.length >= 2 ? ranked[0] : null;
  const asWeakest = (row) => ({ topic: { slug: row.slug, name: row.name }, why: `${row.name} is your weakest topic: ${reasons(row)}.` });
  if (weakest && weakest.score >= 0.5) return asWeakest(weakest);

  const core = CORE_TOPICS.filter((slug) => topicProgress(db, slug, { now }).total !== 0).map((slug) => ({
    slug,
    name: topicName(db, slug),
    solved: solvedIn(db, slug, { progress }).total,
  }));
  const next = core.find((topic) => topic.solved < MIN_SOLVES);
  if (next) {
    const why = next.solved ? `You've solved ${next.solved} ${next.name} problem${next.solved === 1 ? '' : 's'} so far.` : `You haven't solved any ${next.name} problems yet.`;
    return { topic: { slug: next.slug, name: next.name }, why };
  }
  if (weakest) return asWeakest(weakest);
  const least = core.reduce((best, topic) => (topic.solved < best.solved ? topic : best), core[0] ?? { slug: CORE_TOPICS[0], name: topicName(db, CORE_TOPICS[0]), solved: 0 });
  return { topic: { slug: least.slug, name: least.name }, why: `${least.name} is the core topic you've solved the fewest problems in (${least.solved}).` };
}

function reasons(row) {
  const parts = [];
  if (row.timeRatio >= 1.2) parts.push(`about ${row.timeRatio.toFixed(1)}× your usual time`);
  if (row.helped) parts.push(`you needed help on ${row.helped} of ${row.attempts}`);
  if (row.wrongRate >= 0.3) parts.push(`${Math.round(row.wrongRate * 100)}% of your submissions were wrong`);
  return parts.length ? parts.join(', ') : 'it scores lowest, though not by much';
}

/**
 * The difficulty you're ready for in a topic: Easy until you've solved 2 Easy ones, then
 * Medium, and Hard once you've solved 5 Medium ones with little help.
 */
function readyFor(db, topic, attempts, { progress }) {
  const solved = solvedIn(db, topic.slug, { progress });
  if (solved.Easy < 2) return { difficulty: 'Easy', why: solved.Easy ? `Easy, since you've solved 1 Easy one here.` : 'Starting with Easy.' };
  const medium = attempts.filter((a) => a.difficulty === 'Medium' && a.topics.includes(topic.slug));
  const help = medium.length ? medium.filter((a) => a.outcome === 'abandoned' || a.viewed_solution || a.ai_level > 0).length / medium.length : 1;
  if (solved.Medium >= 5 && help < 0.25) return { difficulty: 'Hard', why: `Hard: you've solved ${solved.Medium} Medium ones here, mostly on your own.` };
  return { difficulty: 'Medium', why: `Medium: you've solved ${solved.Easy} Easy ones here.` };
}

/** Problems you've solved in a topic, by difficulty: in bokken, or on LeetCode when bokken knows it. */
function solvedIn(db, topicSlug, { progress }) {
  const counts = { Easy: 0, Medium: 0, Hard: 0, total: 0 };
  for (const p of listProblems(db, { topic: { slug: topicSlug }, status: 'solved' }, { progress })) {
    if (p.difficulty in counts) counts[p.difficulty]++;
    counts.total++;
  }
  return counts;
}
