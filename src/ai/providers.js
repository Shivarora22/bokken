// --- Providers -------------------------------------------------------------

// The providers setup offers. Every one uses one of two adapters: Anthropic's own API,
// or the OpenAI-compatible API that almost every other provider and local server speaks.
export const PROVIDERS = {
  anthropic: {
    name: 'Anthropic (Claude)',
    adapter: 'anthropic',
    key: 'required',
    keyEnv: ['ANTHROPIC_API_KEY'],
    preferredModels: [/^claude-opus-5-5$/, /^claude-opus/, /^claude-sonnet/],
  },
  openai: {
    name: 'OpenAI',
    adapter: 'openai',
    key: 'required',
    keyEnv: ['OPENAI_API_KEY'],
    baseUrl: 'https://api.openai.com/v1',
    reportsUsage: true,
    preferredModels: [/^gpt-5(\.\d+)?$/, /^gpt-5/, /^gpt-4\.1$/, /^gpt-4o$/],
  },
  gemini: {
    name: 'Google Gemini',
    adapter: 'openai',
    key: 'required',
    keyEnv: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    preferredModels: [/^gemini-[\d.]+-pro$/, /^gemini-[\d.]+-flash$/, /^gemini/],
  },
  ollama: { name: 'Ollama (local)', adapter: 'openai', key: 'none', baseUrl: 'http://localhost:11434/v1', local: true },
  vllm: { name: 'vLLM (local)', adapter: 'openai', key: 'optional', baseUrl: 'http://localhost:8000/v1', local: true },
  lmstudio: { name: 'LM Studio (local)', adapter: 'openai', key: 'none', baseUrl: 'http://localhost:1234/v1', local: true },
  other: {
    name: 'Other OpenAI-compatible',
    hint: 'OpenRouter, Groq, Together, DeepSeek…',
    adapter: 'openai',
    key: 'optional',
    baseUrl: '',
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS);

export function asksForBaseUrl(id) {
  return Boolean(PROVIDERS[id]?.local) || id === 'other';
}

/** The first of the provider's usual environment variables that's set, e.g. OPENAI_API_KEY. */
export function envKeyFor(id, env = process.env) {
  return PROVIDERS[id]?.keyEnv?.find((name) => env[name]) ?? null;
}

/**
 * The AI settings bokken runs with, or null when AI isn't set up. `keyProblem` explains a
 * missing key before any request is made.
 */
export function resolveAi(config, credentials = {}, env = process.env) {
  const { provider, model, baseUrl, apiKeyEnv, effort, maxContext } = config.ai ?? {};
  const preset = PROVIDERS[provider];
  if (!preset || !model) return null;

  const apiKey = credentials.ai?.apiKey || (apiKeyEnv && env[apiKeyEnv]) || null;
  let keyProblem = null;
  if (preset.key === 'required' && !apiKey) {
    keyProblem = apiKeyEnv
      ? `Your ${preset.name} key should be in $${apiKeyEnv}, but that isn't set. Set it, or run /ai to paste a key.`
      : `There's no ${preset.name} key saved. Run /ai to add one.`;
  }
  return {
    provider,
    name: preset.name,
    adapter: preset.adapter,
    local: Boolean(preset.local),
    reportsUsage: Boolean(preset.reportsUsage),
    model,
    baseUrl: baseUrl || preset.baseUrl || null,
    apiKey,
    effort: effort ?? 'medium',
    maxContext: maxContext ?? null,
    keyProblem,
  };
}

const NOT_FOR_CHAT = /embed|tts|whisper|dall-e|davinci|babbage|moderation|transcri|realtime|audio|image|search|sora|computer-use|aqa|imagen|veo|learnlm|guard/i;

/** Model ids worth offering for chat, sorted, without Gemini's "models/" prefix. */
export function chatModels(ids) {
  return [...new Set(ids.map((id) => id.replace(/^models\//, '')))].filter((id) => !NOT_FOR_CHAT.test(id)).sort();
}

/** The model setup preselects: the provider's preferred one if offered, else the first. */
export function defaultModel(id, models) {
  for (const pattern of PROVIDERS[id]?.preferredModels ?? []) {
    const match = models.find((model) => pattern.test(model));
    if (match) return match;
  }
  return models[0] ?? null;
}

// --- Errors ----------------------------------------------------------------

/**
 * `code` is one of: aborted, timeout, connection, auth, not_found, rate_limit,
 * unavailable, bad_request, unknown.
 */
export class AiError extends Error {
  constructor(code, message, { cause } = {}) {
    super(message, { cause });
    this.name = 'AiError';
    this.code = code;
  }
}

/**
 * Both SDKs throw errors with the same names and an HTTP `status`; this turns them into
 * something a person can act on. `listing` is true while setup lists models.
 */
export function toAiError(error, settings, { listing = false } = {}) {
  if (error instanceof AiError) return error;
  const { name } = settings;
  const status = error?.status;
  // The SDKs leave error.name as "Error"; the class name says what happened.
  const kind = error?.constructor?.name === 'Error' ? (error?.name ?? '') : (error?.constructor?.name ?? '');
  const make = (code, message) => new AiError(code, message, { cause: error });

  if (kind === 'APIUserAbortError' || kind === 'AbortError' || error?.name === 'AbortError') return make('aborted', 'Stopped.');
  if (kind === 'APIConnectionTimeoutError') return make('timeout', `${name} didn't answer in time. Try again.`);
  if (kind === 'APIConnectionError' || (status === undefined && /fetch failed|ECONNREFUSED|ENOTFOUND/i.test(String(error?.cause ?? error?.message)))) {
    if (!settings.local) return make('connection', `Couldn't reach ${name}. Check your internet connection.`);
    const start = settings.provider === 'ollama' ? ' Start it with: ollama serve' : '';
    return make('connection', `Couldn't reach ${name} at ${settings.baseUrl}. Is it running?${start}`);
  }
  if (status === 401 || status === 403) return make('auth', `${name} didn't accept your API key. Run /ai to enter a new one.`);
  if (status === 404) {
    return listing
      ? make('not_found', `Nothing answered at ${settings.baseUrl}. Check the base URL.`)
      : make('not_found', `${name} doesn't have the model "${settings.model}". Run /ai to pick another.`);
  }
  if (status === 429) return make('rate_limit', `${name} is rate-limiting you, or your credit ran out. Wait a minute, or check your account.`);
  if (status >= 500) return make('unavailable', `${name} is having trouble right now (${status}). Try again shortly.`);
  if (status === 400) return make('bad_request', `${name} rejected the request: ${apiMessage(error)}`);
  return make('unknown', `${name}: ${error?.message ?? String(error)}`);
}

function apiMessage(error) {
  return error?.error?.error?.message ?? error?.error?.message ?? error?.message ?? 'no details';
}

// --- Adapters --------------------------------------------------------------

/**
 * @typedef {{ role: 'user' | 'assistant', content: string | { text: string, cache?: boolean }[] }} ChatMessage
 *   A `cache` part is one that stays the same across calls (the problem), for prompt caching.
 * @typedef {{
 *   system: string,
 *   messages: ChatMessage[],
 *   maxTokens: number,
 *   think?: boolean,
 *   effort?: string,
 *   onText?: (delta: string) => void,
 *   signal?: AbortSignal,
 * }} ChatRequest
 * @typedef {{ text: string, usage: { inputTokens: number, outputTokens: number, cachedTokens: number } | null,
 *   stopReason: string | null, declined: boolean }} ChatResult
 * @typedef {{ streamChat: (request: ChatRequest) => Promise<ChatResult>, listModels: () => Promise<string[]> }} Adapter
 */

/**
 * The SDKs load only when AI is actually used.
 *
 * @returns {Promise<Adapter>}
 */
export async function createAdapter(settings, options) {
  if (settings.adapter === 'anthropic') {
    return (await import('./anthropic.js')).createAnthropicAdapter(settings, options);
  }
  return (await import('./openai.js')).createOpenAiAdapter(settings, options);
}
