import { accessSync, chmodSync, constants, mkdirSync, readFileSync, renameSync, statSync, watch, writeFileSync } from 'node:fs';
import path from 'node:path';

// Small helpers with nothing bokken-specific in them.

// --- Durations -------------------------------------------------------------

/** For sentences: "under a minute", "18 min", "3h 10m". */
export function humanDuration(ms) {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/** 75_000 → "01:15", 3_725_000 → "1:02:05". */
export function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mmss = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return hours ? `${hours}:${mmss}` : mmss;
}

// --- JSON files ------------------------------------------------------------

/** Returns undefined when the file doesn't exist. */
export function readJson(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${file} isn't valid JSON (${error.message}). Fix it or delete it.`);
  }
}

/** Writes a temp file and renames it into place, so a crash never leaves half a file. */
export function writeJson(file, data, { mode = 0o644 } = {}) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', { mode });
  chmodSync(temp, mode);
  renameSync(temp, file);
}

// --- Programs on PATH ------------------------------------------------------

/**
 * Finds a program on PATH, like `which`. On Windows it also tries each PATHEXT
 * extension (.EXE, .CMD, …). Returns the absolute path, or null.
 *
 * @param {string} name
 * @param {{ env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform }} [options]
 */
export function which(name, { env = process.env, platform = process.platform } = {}) {
  const isWindows = platform === 'win32';
  const paths = isWindows ? path.win32 : path.posix;
  const extensions = isWindows ? ['', ...(env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)] : [''];

  const dirs = name.includes('/') || (isWindows && name.includes('\\'))
    ? ['']
    : (env.PATH ?? env.Path ?? '').split(isWindows ? ';' : ':').filter(Boolean);

  for (const dir of dirs) {
    for (const extension of extensions) {
      const candidate = dir ? paths.join(dir, name + extension) : name + extension;
      if (isExecutable(candidate, isWindows)) return paths.resolve(candidate);
    }
  }
  return null;
}

function isExecutable(file, isWindows) {
  try {
    if (!statSync(file).isFile()) return false;
    if (!isWindows) accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// --- Watching a file for saves ---------------------------------------------

/**
 * Calls `onSave` each time the file is saved. It watches the folder rather than the
 * file, because many editors save by writing a new file and renaming it over the old
 * one. A slow poll backs it up where file events don't arrive (WSL's /mnt/c, network
 * drives).
 *
 * @param {string} file
 * @param {() => void} onSave
 * @returns {() => void} stops watching
 */
export function watchSaves(file, onSave, { pollMs = 1000, settleMs = 50 } = {}) {
  let last = stamp(file);
  let settle;
  const check = () => {
    const now = stamp(file);
    if (now !== null && now !== last) {
      last = now;
      onSave();
    }
  };

  let watcher;
  try {
    watcher = watch(path.dirname(file), (_event, name) => {
      if (name && name !== path.basename(file)) return;
      // One save can fire several events; check once they settle.
      clearTimeout(settle);
      settle = setTimeout(check, settleMs);
    });
    watcher.on('error', () => {});
  } catch {
    // The poll still works.
  }
  const poll = setInterval(check, pollMs);

  return () => {
    watcher?.close();
    clearInterval(poll);
    clearTimeout(settle);
  };
}

function stamp(file) {
  try {
    const { mtimeMs, size } = statSync(file);
    return `${mtimeMs}:${size}`;
  } catch {
    // Mid-save: the old file is gone and the new one isn't there yet.
    return null;
  }
}
