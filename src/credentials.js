import { readJson, writeJson } from './json-file.js';
import { getPaths } from './paths.js';

/**
 * @typedef {{ leetcode?: { session: string, csrftoken: string }, ai?: { apiKey: string } }} Credentials
 */

/** @returns {Credentials} */
export function loadCredentials(file = getPaths().credentials) {
  return readJson(file) ?? {};
}

/** Only the user can read the file (mode 0600). Windows ignores the mode. */
export function saveCredentials(credentials, file = getPaths().credentials) {
  writeJson(file, credentials, { mode: 0o600 });
}
