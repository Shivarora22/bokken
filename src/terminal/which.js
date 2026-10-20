import { accessSync, constants, statSync } from 'node:fs';
import path from 'node:path';

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
