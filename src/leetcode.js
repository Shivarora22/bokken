import { randomBytes } from 'node:crypto';
import { getMeta, setMeta, transaction } from './db.js';

// Everything that talks to LeetCode: the HTTP client, every query, and problem lookups with their cache.

// --- Client ----------------------------------------------------------------

const BASE_URL = 'https://leetcode.com';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

/**
 * `code` is one of: network, timeout, blocked, auth, not_found, changed, http.
 */
export class LeetCodeError extends Error {
  constructor(code, message, { status, cause } = {}) {
    super(message, { cause });
    this.name = 'LeetCodeError';
    this.code = code;
    this.status = status;
  }
}

/**
 * `session` is the LEETCODE_SESSION cookie; `setSession` changes it after /login or /logout.
 *
 * @param {{ fetch?: typeof fetch, session?: string, timeoutMs?: number }} [options]
 */
export function createClient({ fetch = globalThis.fetch, session = null, timeoutMs = 15_000 } = {}) {
  // Run and submit need a CSRF token. LeetCode's check (Django's) only compares the token in
  // the cookie with the one in the header, so bokken makes one up instead of asking for it.
  const csrftoken = randomToken();

  async function request(path, init = {}) {
    const headers = { 'user-agent': USER_AGENT, referer: `${BASE_URL}/`, origin: BASE_URL, accept: 'application/json', ...init.headers };
    if (session) {
      headers.cookie = `LEETCODE_SESSION=${session}; csrftoken=${csrftoken}`;
      headers['x-csrftoken'] = csrftoken;
    }

    let response;
    try {
      response = await fetch(BASE_URL + path, { ...init, headers, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      if (error.name === 'TimeoutError') {
        throw new LeetCodeError('timeout', `LeetCode didn't answer within ${timeoutMs / 1000} seconds.`, { cause: error });
      }
      throw new LeetCodeError('network', "Couldn't reach LeetCode. Check your internet connection.", { cause: error });
    }

    const { status } = response;
    if (status === 429 || response.headers.get('cf-mitigated')) {
      throw new LeetCodeError('blocked', 'LeetCode is limiting requests right now. Try again in a few minutes.', { status });
    }
    // A rejected CSRF token comes back as Django's 403 page; LeetCode has sent it with status 499.
    if (status === 403 || status === 499) {
      const page = await response.text().catch(() => '');
      if (/CSRF/.test(page)) throw changed("LeetCode didn't accept bokken's CSRF token", { status });
      if (status === 499) throw new LeetCodeError('http', `LeetCode answered ${status} for ${path}.`, { status });
    }
    if (status === 401 || (status === 403 && session)) {
      throw new LeetCodeError('auth', 'Your LeetCode login has expired. Log in again with /login.', { status });
    }
    if (status === 403) {
      throw new LeetCodeError('blocked', "LeetCode's bot protection blocked the request. Try again in a few minutes.", { status });
    }
    if (status === 404) throw new LeetCodeError('not_found', `LeetCode has nothing at ${path}.`, { status });

    let body;
    try {
      body = await response.json();
    } catch (error) {
      throw changed(`${path} didn't return JSON`, { status, cause: error });
    }
    // GraphQL validation errors (a field LeetCode removed) come back as 400 with a JSON body.
    if (!response.ok && !body?.errors) throw new LeetCodeError('http', `LeetCode answered ${status} for ${path}.`, { status });
    return body;
  }

  return {
    async graphql(operationName, query, variables = {}) {
      const body = await request('/graphql', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operationName, query, variables }),
      });
      if (body.errors?.length) throw changed(`the ${operationName} query failed: ${body.errors[0].message}`);
      if (!body.data) throw changed(`the ${operationName} query returned no data`);
      return body.data;
    },

    getJson: (path) => request(path),

    /** A POST of JSON, as a browser sends Run and Submit: from the problem's page. */
    postJson: (path, body, { referer } = {}) =>
      request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(referer ? { referer } : {}) },
        body: JSON.stringify(body),
      }),

    /** `null` logs out. */
    setSession(next) {
      session = next ?? null;
    },

    hasSession: () => Boolean(session),
  };
}

// 32 letters and digits: the shape Django expects of a CSRF token.
function randomToken() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(randomBytes(32), (byte) => chars[byte % chars.length]).join('');
}

/** For responses that don't look the way they used to: LeetCode's API is unofficial. */
export function changed(detail, options) {
  return new LeetCodeError('changed', `LeetCode changed something, so bokken needs an update (${detail}).`, options);
}

// --- Queries ---------------------------------------------------------------

// Every LeetCode request lives here. The API is unofficial and has changed before
// (problemsetQuestionList is gone), so when it changes again, this is the file to fix.

export const PROBLEM_LIST_PATH = '/api/problems/all/';

export const DAILY = `
  query daily {
    activeDailyCodingChallengeQuestion {
      date
      question { questionFrontendId titleSlug title difficulty }
    }
  }`;

export const QUESTION = `
  query question($titleSlug: String!) {
    question(titleSlug: $titleSlug) {
      questionId
      questionFrontendId
      title
      titleSlug
      difficulty
      isPaidOnly
      content
      hints
      exampleTestcases
      metaData
      topicTags { name slug }
      codeSnippets { lang langSlug code }
    }
  }`;

export const SEARCH = `
  query search($keywords: String!) {
    questionList(categorySlug: "", limit: 10, skip: 0, filters: { searchKeywords: $keywords }) {
      data { questionId questionFrontendId titleSlug title difficulty isPaidOnly acRate }
    }
  }`;

export const USER_STATUS = `
  query userStatus {
    userStatus { isSignedIn username }
  }`;

// --- Login -----------------------------------------------------------------

/**
 * The LEETCODE_SESSION value in whatever was pasted: the value itself, a cookie line, a row
 * copied from the browser's cookie table, or a "Copy as cURL" / "Copy as PowerShell"
 * command. Null when there's none.
 */
export function parseSession(text) {
  const trimmed = String(text).trim();
  const named = trimmed.match(/LEETCODE_SESSION["'\s=:,]+([\w.-]+)/);
  if (named) return named[1];
  const bare = trimmed.replace(/^["']|["']$/g, '');
  return /^[\w.-]+$/.test(bare) ? bare : null;
}

/** The username the client's session is signed in as, or null when it isn't signed in. */
export async function signedInUser(client) {
  const { userStatus } = await client.graphql('userStatus', USER_STATUS);
  if (!userStatus) throw changed('userStatus came back empty');
  return userStatus.isSignedIn ? userStatus.username : null;
}

// --- Run and submit --------------------------------------------------------

// Both need a login. They're sent the way the problem's page sends them, and their results
// come from the same `check` endpoint (recorded in test/fixtures/run-* and submit-*).

/** LeetCode's "Run": your code on the problem's examples. Returns the id `waitForResult` takes. */
export async function startRun(client, { problem, lang, code }) {
  const body = await client.postJson(
    `/problems/${problem.slug}/interpret_solution/`,
    { lang, question_id: String(problem.questionId), typed_code: code, data_input: problem.exampleTestcases },
    { referer: problem.url },
  );
  if (!body?.interpret_id) throw changed('Run came back without an interpret_id');
  return body.interpret_id;
}

/** LeetCode's "Submit": your code judged on every test. Returns the id `waitForResult` takes. */
export async function startSubmit(client, { problem, lang, code }) {
  const body = await client.postJson(
    `/problems/${problem.slug}/submit/`,
    { lang, question_id: String(problem.questionId), typed_code: code },
    { referer: problem.url },
  );
  if (!body?.submission_id) throw changed('Submit came back without a submission_id');
  return String(body.submission_id);
}

/**
 * Asks for a Run's or a Submit's result until it's ready (PENDING, STARTED, then SUCCESS).
 * `signal` stops waiting; LeetCode still finishes the job.
 */
export async function waitForResult(client, id, { signal, intervalMs = 1000, timeoutMs = 60_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await sleep(intervalMs, signal);
    const result = await client.getJson(`/submissions/detail/${id}/check/`);
    if (result?.state === 'SUCCESS') return result;
    if (result?.state !== 'PENDING' && result?.state !== 'STARTED') throw changed(`a result came back as "${result?.state}"`);
    if (Date.now() > deadline) throw new LeetCodeError('timeout', `LeetCode didn't finish within ${timeoutMs / 1000} seconds. Try again in a moment.`);
  }
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

// --- Problems --------------------------------------------------------------

const DIFFICULTIES = { 1: 'Easy', 2: 'Medium', 3: 'Hard' };
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// A cached problem older than this is fetched again, and pruneProblems deletes it.
const PROBLEM_MAX_AGE_DAYS = 30;

/**
 * @typedef {{ frontendId: number, questionId: number, slug: string, title: string,
 *   difficulty: string, paidOnly: boolean, acRate: number | null }} ProblemSummary
 */

/** Replaces the catalog with LeetCode's full problem list. Attempts live in other tables, so they're untouched. */
export async function syncCatalog(db, client, { now = new Date() } = {}) {
  const body = await client.getJson(PROBLEM_LIST_PATH);
  const pairs = body?.stat_status_pairs;
  if (!Array.isArray(pairs)) throw changed('the problem list has no stat_status_pairs');

  const insert = db.prepare(
    'INSERT OR REPLACE INTO catalog (frontend_id, question_id, slug, title, difficulty, paid_only, ac_rate) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  return transaction(db, () => {
    db.exec('DELETE FROM catalog');
    let count = 0;
    for (const { stat, difficulty, paid_only } of pairs) {
      if (!stat?.question__title_slug || !Number.isInteger(stat.frontend_question_id)) {
        throw changed('a problem in the list has no slug or number');
      }
      if (stat.question__hide) continue;
      const acRate = stat.total_submitted ? (100 * stat.total_acs) / stat.total_submitted : null;
      insert.run(
        stat.frontend_question_id,
        stat.question_id,
        stat.question__title_slug,
        stat.question__title,
        DIFFICULTIES[difficulty?.level] ?? 'Unknown',
        paid_only ? 1 : 0,
        acRate,
      );
      count++;
    }
    setMeta(db, 'catalog_fetched_at', now.toISOString());
    return count;
  });
}

/** "1", "two-sum", "Two Sum" or a leetcode.com/problems/… link. */
export function parseProblemRef(text) {
  const trimmed = String(text).trim();
  const link = trimmed.match(/leetcode\.com\/problems\/([a-z0-9-]+)/i);
  if (link) return { slug: link[1].toLowerCase() };
  if (/^\d+$/.test(trimmed)) return { frontendId: Number(trimmed) };
  return { slug: trimmed.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-'), title: trimmed };
}

/**
 * Finds a problem by number, slug, title or link. Refreshes the problem list when it's a
 * week old, or when the problem is missing (it may be new). Falls back to LeetCode's search
 * when the list can't be downloaded at all.
 *
 * @returns {Promise<ProblemSummary | null>}
 */
export async function lookupProblem(db, client, text, { now = new Date() } = {}) {
  const ref = parseProblemRef(text);
  const fetchedAt = getMeta(db, 'catalog_fetched_at');
  const age = fetchedAt ? now - new Date(fetchedAt) : Infinity;

  let synced = false;
  if (age > 7 * DAY) {
    try {
      await syncCatalog(db, client, { now });
      synced = true;
    } catch (error) {
      if (!fetchedAt) return searchProblem(client, ref);
    }
  }

  let row = findInCatalog(db, ref);
  if (!row && !synced && age > HOUR) {
    await syncCatalog(db, client, { now });
    row = findInCatalog(db, ref);
  }
  return row ? fromCatalogRow(row) : null;
}

function findInCatalog(db, { frontendId, slug, title }) {
  if (frontendId) return db.prepare('SELECT * FROM catalog WHERE frontend_id = ?').get(frontendId);
  return (
    db.prepare('SELECT * FROM catalog WHERE slug = ?').get(slug) ??
    (title && db.prepare('SELECT * FROM catalog WHERE title = ? COLLATE NOCASE').get(title))
  );
}

function fromCatalogRow(row) {
  return {
    frontendId: row.frontend_id,
    questionId: row.question_id,
    slug: row.slug,
    title: row.title,
    difficulty: row.difficulty,
    paidOnly: Boolean(row.paid_only),
    acRate: row.ac_rate,
  };
}

async function searchProblem(client, { frontendId, slug, title }) {
  const data = await client.graphql('search', SEARCH, { keywords: title ?? slug ?? String(frontendId) });
  const questions = data.questionList?.data;
  if (!Array.isArray(questions)) throw changed('search results have no data');
  const match = questions.find((q) =>
    frontendId ? Number(q.questionFrontendId) === frontendId : q.titleSlug === slug || q.title.toLowerCase() === title?.toLowerCase(),
  );
  if (!match) return null;
  return {
    frontendId: Number(match.questionFrontendId),
    questionId: Number(match.questionId),
    slug: match.titleSlug,
    title: match.title,
    difficulty: match.difficulty,
    paidOnly: Boolean(match.isPaidOnly),
    acRate: match.acRate ?? null,
  };
}

/**
 * A problem's full details, from the cache when it's under `maxAgeDays` old. When LeetCode
 * can't be reached, an older cached copy is better than nothing.
 */
export async function getProblem(db, client, slug, { now = new Date(), maxAgeDays = PROBLEM_MAX_AGE_DAYS } = {}) {
  const cached = db.prepare('SELECT data, fetched_at FROM problems WHERE slug = ?').get(slug);
  const cachedProblem = cached && JSON.parse(cached.data);
  // A paid problem fetched without Premium has no content; fetch it again in case the user has Premium now.
  const usable = cachedProblem && !(cachedProblem.paidOnly && !cachedProblem.content);
  if (usable && now - new Date(cached.fetched_at) < maxAgeDays * DAY) return cachedProblem;

  let question;
  try {
    ({ question } = await client.graphql('question', QUESTION, { titleSlug: slug }));
  } catch (error) {
    if (cachedProblem) return cachedProblem;
    throw error;
  }
  if (!question) throw new LeetCodeError('not_found', `LeetCode has no problem called "${slug}".`);

  const problem = normalizeQuestion(question);
  transaction(db, () => {
    db.prepare(
      'INSERT INTO problems (slug, data, fetched_at) VALUES (?, ?, ?) ON CONFLICT (slug) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at',
    ).run(problem.slug, JSON.stringify(problem), now.toISOString());
    db.prepare('DELETE FROM problem_topics WHERE slug = ?').run(problem.slug);
    const insertTopic = db.prepare('INSERT INTO problem_topics (slug, topic_slug, topic_name) VALUES (?, ?, ?)');
    for (const topic of problem.topics) insertTopic.run(problem.slug, topic.slug, topic.name);
  });
  return problem;
}

/**
 * Deletes cached problems older than `maxAgeDays`: they'd be fetched again anyway, so the
 * cache only holds what you opened lately. Topics stay, since the stats need them.
 */
export function pruneProblems(db, { now = new Date(), maxAgeDays = PROBLEM_MAX_AGE_DAYS } = {}) {
  const cutoff = new Date(now.getTime() - maxAgeDays * DAY).toISOString();
  return Number(db.prepare('DELETE FROM problems WHERE fetched_at < ?').run(cutoff).changes);
}

function normalizeQuestion(q) {
  if (!q.titleSlug || !q.questionFrontendId) throw changed('a problem came back without its slug or number');
  let metaData = null;
  try {
    metaData = q.metaData ? JSON.parse(q.metaData) : null;
  } catch {
    // Some problems (design problems, SQL) have unusual metaData; the rest still works.
  }
  return {
    questionId: Number(q.questionId),
    frontendId: Number(q.questionFrontendId),
    slug: q.titleSlug,
    title: q.title,
    difficulty: q.difficulty,
    paidOnly: Boolean(q.isPaidOnly),
    content: q.content ?? null,
    hints: q.hints ?? [],
    topics: (q.topicTags ?? []).map(({ name, slug }) => ({ name, slug })),
    snippets: (q.codeSnippets ?? []).map(({ lang, langSlug, code }) => ({ lang, langSlug, code })),
    exampleTestcases: q.exampleTestcases ?? '',
    metaData,
    url: `https://leetcode.com/problems/${q.titleSlug}/`,
  };
}

export async function getDaily(client) {
  const { activeDailyCodingChallengeQuestion: daily } = await client.graphql('daily', DAILY);
  const q = daily?.question;
  if (!q?.titleSlug) throw changed('the daily problem came back empty');
  return { date: daily.date, frontendId: Number(q.questionFrontendId), slug: q.titleSlug, title: q.title, difficulty: q.difficulty };
}
