import { readJson, writeJson } from './json-file.js';
import { defaultWorkspace, getPaths } from './paths.js';

const DEFAULTS = {
  language: 'python3',
  editor: null,
  workspace: null,
  ai: { provider: null, model: null, baseUrl: null, apiKeyEnv: null, effort: 'medium', maxContext: null },
  stats: { idleMinutes: 10 },
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
