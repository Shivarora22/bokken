import Anthropic from '@anthropic-ai/sdk';
import { toAiError } from './providers.js';

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** @param {ReturnType<typeof import('./providers.js').resolveAi>} settings */
export function createAnthropicAdapter(settings, { fetch, maxRetries = 1 } = {}) {
  const client = new Anthropic({
    apiKey: settings.apiKey,
    ...(settings.baseUrl ? { baseURL: settings.baseUrl } : {}),
    fetch,
    maxRetries,
    timeout: 120_000,
  });
  // Adaptive thinking, effort and server-side fallback. Older models reject some of
  // these; then they're dropped for the rest of the session.
  let useExtras = true;

  async function run(body, { onText, signal }) {
    const stream = body.betas ? client.beta.messages.stream(body, { signal }) : client.messages.stream(body, { signal });
    let text = '';
    stream.on('text', (delta) => {
      text += delta;
      onText?.(delta);
    });
    const message = await stream.finalMessage();
    const { usage } = message;
    return {
      text,
      stopReason: message.stop_reason,
      declined: message.stop_reason === 'refusal',
      usage: usage && {
        inputTokens: usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
        outputTokens: usage.output_tokens,
        cachedTokens: usage.cache_read_input_tokens ?? 0,
      },
    };
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
      if (useExtras) {
        try {
          return await run(
            {
              ...body,
              thinking: think ? { type: 'adaptive', display: 'omitted' } : { type: 'disabled' },
              output_config: { effort: effort ?? settings.effort },
              fallbacks: 'default',
              betas: [FALLBACK_BETA],
            },
            { onText, signal },
          );
        } catch (error) {
          if (error?.status !== 400 || !/thinking|effort|output_config|fallback|beta/i.test(error.message)) throw toAiError(error, settings);
          useExtras = false;
        }
      }
      try {
        return await run(body, { onText, signal });
      } catch (error) {
        throw toAiError(error, settings);
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
