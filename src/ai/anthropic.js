import Anthropic from '@anthropic-ai/sdk';
import { toAiError } from './providers.js';

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

// Settings a model can reject with a 400 that names them: adaptive thinking (Opus 4.5 and
// older), effort (Sonnet 4.5, Haiku 4.5) and the server-side fallback for declined requests
// (older models, proxies). Each is dropped on its own, for the rest of the session.
const OPTIONAL = [
  { name: 'thinking', rejected: /thinking/i },
  { name: 'effort', rejected: /effort|output_config/i },
  { name: 'fallback', rejected: /fallback|beta/i },
];

/** @param {ReturnType<typeof import('./providers.js').resolveAi>} settings */
export function createAnthropicAdapter(settings, { fetch, maxRetries = 1 } = {}) {
  const client = new Anthropic({
    apiKey: settings.apiKey,
    ...(settings.baseUrl ? { baseURL: settings.baseUrl } : {}),
    fetch,
    maxRetries,
    timeout: 120_000,
  });
  // Haiku has no server-side fallback: a declined request stays declined.
  const supports = { thinking: true, effort: true, fallback: !/haiku/i.test(settings.model) };

  async function run(body, { onText, signal }) {
    const stream = body.betas ? client.beta.messages.stream(body, { signal }) : client.messages.stream(body, { signal });
    let text = '';
    stream.on('text', (delta) => {
      text += delta;
      onText?.(delta);
    });
    const message = await stream.finalMessage();
    return { text, stopReason: message.stop_reason, declined: message.stop_reason === 'refusal' };
  }

  return {
    /** @param {import('./providers.js').ChatRequest} request */
    async streamChat({ system, messages, maxTokens, think = true, effort, onText, signal }) {
      const body = {
        model: settings.model,
        max_tokens: maxTokens,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: messages.map(toAnthropicMessage),
      };
      for (;;) {
        // Thinking can't be turned off on the 5.5 models (`disabled` is a 400), so `think:
        // false` leaves it out: older models then don't think, and the 5.5 ones think as
        // little as the low effort allows.
        const sent = { thinking: supports.thinking && think, effort: supports.effort, fallback: supports.fallback };
        try {
          return await run(
            {
              ...body,
              ...(sent.thinking ? { thinking: { type: 'adaptive', display: 'omitted' } } : {}),
              ...(sent.effort ? { output_config: { effort: effort ?? settings.effort } } : {}),
              ...(sent.fallback ? { fallbacks: 'default', betas: [FALLBACK_BETA] } : {}),
            },
            { onText, signal },
          );
        } catch (error) {
          const setting = error?.status === 400 && OPTIONAL.find(({ name, rejected }) => sent[name] && rejected.test(error.message));
          if (!setting) throw toAiError(error, settings);
          supports[setting.name] = false;
        }
      }
    },

    async listModels() {
      try {
        const ids = [];
        for await (const model of client.models.list({ limit: 100 })) ids.push(model.id);
        return ids;
      } catch (error) {
        throw toAiError(error, settings, { listing: true });
      }
    },
  };
}

function toAnthropicMessage({ role, content }) {
  if (typeof content === 'string') return { role, content };
  return {
    role,
    content: content.map((part) => ({ type: 'text', text: part.text, ...(part.cache ? { cache_control: { type: 'ephemeral' } } : {}) })),
  };
}
