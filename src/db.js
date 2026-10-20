import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

// Append new migrations; never edit one that has shipped.
const MIGRATIONS = [
  `
  CREATE TABLE catalog (
    frontend_id INTEGER PRIMARY KEY,
    question_id INTEGER NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    difficulty TEXT NOT NULL,
    paid_only INTEGER NOT NULL,
    ac_rate REAL
  );

  CREATE TABLE problems (
    slug TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    fetched_at TEXT NOT NULL
  );

  CREATE TABLE problem_topics (
    slug TEXT NOT NULL,
    topic_slug TEXT NOT NULL,
    topic_name TEXT NOT NULL,
    PRIMARY KEY (slug, topic_slug)
  );
  CREATE INDEX problem_topics_by_topic ON problem_topics (topic_slug);

  CREATE TABLE attempts (
    id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    slug TEXT NOT NULL,
    lang TEXT,
    source TEXT NOT NULL,   -- bokken | import
    started_at TEXT NOT NULL,
    ended_at TEXT,
    outcome TEXT NOT NULL,  -- active | solved | abandoned
    active_sec INTEGER NOT NULL DEFAULT 0,
    wall_sec INTEGER NOT NULL DEFAULT 0,
    runs INTEGER NOT NULL DEFAULT 0,
    submissions INTEGER NOT NULL DEFAULT 0,
    wrong_submissions INTEGER NOT NULL DEFAULT 0,
    hints_seen INTEGER NOT NULL DEFAULT 0,
    ai_level INTEGER NOT NULL DEFAULT 0,
    asks INTEGER NOT NULL DEFAULT 0,
    viewed_solution INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX attempts_by_slug ON attempts (slug);

  CREATE TABLE events (
    id TEXT PRIMARY KEY,
    attempt_id TEXT NOT NULL,
    type TEXT NOT NULL,
    at TEXT NOT NULL,
    data TEXT
  );
  CREATE INDEX events_by_attempt ON events (attempt_id, at);

  CREATE TABLE submissions (
    id TEXT PRIMARY KEY,
    attempt_id TEXT,
    slug TEXT NOT NULL,
    lang TEXT,
    status TEXT,
    runtime TEXT,
    memory TEXT,
    remote_id TEXT,
    submitted_at TEXT NOT NULL
  );
  CREATE INDEX submissions_by_attempt ON submissions (attempt_id);
  CREATE UNIQUE INDEX submissions_by_remote_id ON submissions (remote_id) WHERE remote_id IS NOT NULL;
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

/** Opens (or creates) the database and brings its schema up to date. Pass ':memory:' for tests. */
export async function openDb(file) {
  const { DatabaseSync } = await loadSqlite();
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  migrate(db);
  if (!getMeta(db, 'device_id')) setMeta(db, 'device_id', randomUUID());
  return db;
}

export function getMeta(db, key) {
  return db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value;
}

export function setMeta(db, key, value) {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value);
}

export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)');
  const current = Number(getMeta(db, 'schema_version') ?? 0);
  if (current > MIGRATIONS.length) {
    throw new Error(`Your bokken database is from a newer version of bokken (schema ${current}). Update bokken: npm i -g bokken`);
  }
  for (let version = current + 1; version <= MIGRATIONS.length; version++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[version - 1]);
      setMeta(db, 'schema_version', String(version));
    });
  }
}

// Node 22 warns "SQLite is an experimental feature" when it loads; users shouldn't see that every run.
async function loadSqlite() {
  const emitWarning = process.emitWarning;
  process.emitWarning = (warning, ...rest) => {
    if (String(warning?.message ?? warning).includes('SQLite')) return;
    return emitWarning.call(process, warning, ...rest);
  };
  try {
    return await import('node:sqlite');
  } finally {
    process.emitWarning = emitWarning;
  }
}
