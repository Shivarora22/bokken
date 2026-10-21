import { randomUUID } from 'node:crypto';
import { getMeta, transaction } from './db.js';

// Event types: open, close, save, key, command, hint, done, offline_save.
// offline_save is an edit made while bokken was closed, seen from the file's modified time.

export const DEFAULT_IDLE_MS = 10 * 60_000;

/**
 * Active time: the gaps between activity, each capped at `idleMs`. Gaps while bokken was
 * closed don't count, except that edits made meanwhile earn at most one capped gap.
 * With `now`, the time since the last activity counts too (capped), for a live timer.
 */
export function activeMs(events, { idleMs = DEFAULT_IDLE_MS, now } = {}) {
  let total = 0;
  for (let i = 1; i < events.length; i++) {
    const previous = events[i - 1];
    const gap = Math.max(0, Date.parse(events[i].at) - Date.parse(previous.at));
    if (previous.type === 'close') total += events[i].type === 'offline_save' ? Math.min(gap, idleMs) : 0;
    else if (previous.type !== 'offline_save') total += Math.min(gap, idleMs);
  }
  const last = events.at(-1);
  if (now && last && last.type !== 'close') total += Math.min(Math.max(0, now - Date.parse(last.at)), idleMs);
  return total;
}

/**
 * Continues the problem's active attempt, or starts a new one (first time, or re-practice
 * after solving it). `fileModifiedAt` is the solution file's modified time when it already
 * existed, so edits made while bokken was closed are counted.
 */
export function startAttempt(db, { slug, lang, now = new Date(), fileModifiedAt, idleMs = DEFAULT_IDLE_MS }) {
  return transaction(db, () => {
    let attempt = db
      .prepare("SELECT * FROM attempts WHERE slug = ? AND outcome = 'active' AND source = 'bokken' ORDER BY started_at DESC LIMIT 1")
      .get(slug);
    if (attempt) {
      const last = lastEvent(db, attempt.id);
      if (fileModifiedAt && last && fileModifiedAt > new Date(last.at) && fileModifiedAt < now) {
        insertEvent(db, attempt.id, 'offline_save', fileModifiedAt);
      }
      db.prepare('UPDATE attempts SET lang = ? WHERE id = ?').run(lang, attempt.id);
    } else {
      const id = randomUUID();
      db.prepare("INSERT INTO attempts (id, device_id, slug, lang, source, started_at, outcome) VALUES (?, ?, ?, ?, 'bokken', ?, 'active')").run(
        id,
        getMeta(db, 'device_id'),
        slug,
        lang,
        now.toISOString(),
      );
      attempt = { id };
    }
    insertEvent(db, attempt.id, 'open', now, { lang });
    updateTimes(db, attempt.id, now, idleMs);
    return db.prepare('SELECT * FROM attempts WHERE id = ?').get(attempt.id);
  });
}

export function recordEvent(db, attemptId, type, { at = new Date(), data, idleMs = DEFAULT_IDLE_MS } = {}) {
  transaction(db, () => {
    insertEvent(db, attemptId, type, at, data);
    updateTimes(db, attemptId, at, idleMs);
  });
}

export function recordHint(db, attemptId, hintsSeen, { at = new Date(), idleMs = DEFAULT_IDLE_MS } = {}) {
  transaction(db, () => {
    insertEvent(db, attemptId, 'hint', at, { n: hintsSeen });
    db.prepare('UPDATE attempts SET hints_seen = max(hints_seen, ?) WHERE id = ?').run(hintsSeen, attemptId);
    updateTimes(db, attemptId, at, idleMs);
  });
}

/**
 * An AI call: its prompt version, model and usage go in the event. A question counts toward
 * `asks`; an AI hint raises `ai_level`; a hint's text is kept so it comes back on reopen.
 */
export function recordAi(db, attemptId, { log, usage, question = false, hintText }, { at = new Date(), idleMs = DEFAULT_IDLE_MS } = {}) {
  transaction(db, () => {
    insertEvent(db, attemptId, 'ai', at, { ...log, usage, ...(hintText ? { text: hintText } : {}) });
    if (question) db.prepare('UPDATE attempts SET asks = asks + 1 WHERE id = ?').run(attemptId);
    if (log.kind === 'hint') db.prepare('UPDATE attempts SET ai_level = max(ai_level, ?) WHERE id = ?').run(log.level, attemptId);
    updateTimes(db, attemptId, at, idleMs);
  });
}

export function markViewedSolution(db, attemptId) {
  db.prepare('UPDATE attempts SET viewed_solution = 1 WHERE id = ?').run(attemptId);
}

/** The AI hints this attempt already got, oldest first. */
export function aiHints(db, attemptId) {
  return db
    .prepare("SELECT data FROM events WHERE attempt_id = ? AND type = 'ai' ORDER BY at, rowid")
    .all(attemptId)
    .map((row) => JSON.parse(row.data))
    .filter((data) => data.kind === 'hint' && data.text)
    .map((data) => ({ level: data.level, text: data.text }));
}

/** `/done`: marks the attempt solved and stops its clock. */
export function finishAttempt(db, attemptId, { at = new Date(), idleMs = DEFAULT_IDLE_MS } = {}) {
  transaction(db, () => {
    insertEvent(db, attemptId, 'done', at);
    updateTimes(db, attemptId, at, idleMs);
    db.prepare("UPDATE attempts SET outcome = 'solved', ended_at = ? WHERE id = ?").run(at.toISOString(), attemptId);
  });
}

/** For the live timer: active time so far, and whether you've been idle past the limit. */
export function attemptTimes(db, attemptId, { now = new Date(), idleMs = DEFAULT_IDLE_MS } = {}) {
  const events = attemptEvents(db, attemptId);
  const last = events.at(-1);
  const finished = last?.type === 'done';
  return {
    activeMs: activeMs(events, { idleMs, now: finished ? undefined : now }),
    idle: !finished && Boolean(last) && now - Date.parse(last.at) > idleMs,
  };
}

/** Home screen numbers: active time since Monday, and days in a row with practice. */
export function practiceSummary(db, { now = new Date(), idleMs = DEFAULT_IDLE_MS } = {}) {
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));

  let weekMs = 0;
  const ids = db.prepare('SELECT DISTINCT attempt_id AS id FROM events WHERE at >= ?').all(monday.toISOString());
  for (const { id } of ids) {
    weekMs += activeMs(attemptEvents(db, id).filter((event) => new Date(event.at) >= monday), { idleMs });
  }

  const days = new Set(db.prepare("SELECT at FROM events WHERE type != 'close'").all().map((row) => localDay(new Date(row.at))));
  let streakDays = 0;
  const day = new Date(now);
  if (!days.has(localDay(day))) day.setDate(day.getDate() - 1);
  while (days.has(localDay(day))) {
    streakDays++;
    day.setDate(day.getDate() - 1);
  }
  return { weekMs, streakDays };
}

/** The most recent unfinished attempt, for "Continue" on the home screen. */
export function latestActiveAttempt(db) {
  return db
    .prepare(
      `SELECT a.*, c.frontend_id, c.title, c.difficulty FROM attempts a
       LEFT JOIN catalog c ON c.slug = a.slug
       WHERE a.outcome = 'active' AND a.source = 'bokken'
       ORDER BY (SELECT max(at) FROM events e WHERE e.attempt_id = a.id) DESC LIMIT 1`,
    )
    .get();
}

function attemptEvents(db, attemptId) {
  return db.prepare('SELECT type, at FROM events WHERE attempt_id = ? ORDER BY at, rowid').all(attemptId);
}

function lastEvent(db, attemptId) {
  return db.prepare('SELECT type, at FROM events WHERE attempt_id = ? ORDER BY at DESC, rowid DESC LIMIT 1').get(attemptId);
}

function insertEvent(db, attemptId, type, at, data) {
  db.prepare('INSERT INTO events (id, attempt_id, type, at, data) VALUES (?, ?, ?, ?, ?)').run(
    randomUUID(),
    attemptId,
    type,
    at.toISOString(),
    data === undefined ? null : JSON.stringify(data),
  );
}

function updateTimes(db, attemptId, now, idleMs) {
  const { started_at: startedAt } = db.prepare('SELECT started_at FROM attempts WHERE id = ?').get(attemptId);
  const active = Math.round(activeMs(attemptEvents(db, attemptId), { idleMs }) / 1000);
  const wall = Math.round((now - Date.parse(startedAt)) / 1000);
  db.prepare('UPDATE attempts SET active_sec = ?, wall_sec = ? WHERE id = ?').run(active, wall, attemptId);
}

function localDay(date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}
