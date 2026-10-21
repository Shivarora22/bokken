import os from 'node:os';
import path from 'node:path';
import { readJson, writeJson } from './util.js';

// bokken's own files: ~/.bokken (or $BOKKEN_HOME) with config.json, credentials.json and the database.

// --- Paths -----------------------------------------------------------------

export function getPaths(env = process.env) {
  const home = env.BOKKEN_HOME ? path.resolve(env.BOKKEN_HOME) : path.join(os.homedir(), '.bokken');
  return {
    home,
    config: path.join(home, 'config.json'),
    credentials: path.join(home, 'credentials.json'),
    db: path.join(home, 'bokken.db'),
  };
}

export function defaultWorkspace() {
  return path.join(os.homedir(), 'leetcode-solutions');
}

// --- config.json -----------------------------------------------------------

const DEFAULTS = {
  language: 'python3',
  editor: null,
  workspace: null,
  ai: { provider: null, model: null, baseUrl: null, apiKeyEnv: null, effort: 'medium', maxContext: null },
  stats: { idleMinutes: 10 },
  terminal: { windowsTerminal: null },
};

// `?` means the setting can be unset (null).
const TYPES = {
  language: 'string',
  editor: 'string?',
  workspace: 'string',
  'ai.provider': 'string?',
  'ai.model': 'string?',
  'ai.baseUrl': 'string?',
  'ai.apiKeyEnv': 'string?',
  'ai.effort': 'string',
  'ai.maxContext': 'number?',
  'stats.idleMinutes': 'number',
  // Your answer to "Is this window Windows Terminal?", for when bokken can't tell.
  'terminal.windowsTerminal': 'boolean?',
};

export const SETTINGS = Object.keys(TYPES);

export function loadConfig(file = getPaths().config) {
  return merge({ ...DEFAULTS, workspace: defaultWorkspace() }, readJson(file) ?? {});
}

export function saveConfig(config, file = getPaths().config) {
  writeJson(file, config);
}

export function getSetting(config, key) {
  if (!Object.hasOwn(TYPES, key)) throw unknownSetting(key);
  return key.split('.').reduce((value, part) => value?.[part], config);
}

/** Returns a new config with `key` set from text, as typed in `bokken config set`. */
export function setSetting(config, key, text) {
  if (!Object.hasOwn(TYPES, key)) throw unknownSetting(key);
  const type = TYPES[key];
  let value = text;
  if (type.endsWith('?') && (text === '' || text === 'null')) {
    value = null;
  } else if (type.startsWith('number')) {
    value = Number(text);
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${key} must be a positive number.`);
  } else if (type.startsWith('boolean')) {
    if (!['true', 'false', 'yes', 'no'].includes(text)) throw new Error(`${key} must be yes or no.`);
    value = text === 'true' || text === 'yes';
  }

  const next = structuredClone(config);
  const parts = key.split('.');
  const parent = parts.slice(0, -1).reduce((object, part) => (object[part] ??= {}), next);
  parent[parts.at(-1)] = value;
  return next;
}

function unknownSetting(key) {
  return new Error(`Unknown setting "${key}". Settings: ${SETTINGS.join(', ')}.`);
}

function merge(defaults, saved) {
  const result = { ...defaults };
  for (const [key, value] of Object.entries(saved)) {
    const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
    result[key] = isObject(value) && isObject(defaults[key]) ? merge(defaults[key], value) : value;
  }
  return result;
}

// --- credentials.json ------------------------------------------------------

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
