import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

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
