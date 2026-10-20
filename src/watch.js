import { statSync, watch } from 'node:fs';
import path from 'node:path';

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
