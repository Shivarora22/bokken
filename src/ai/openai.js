import OpenAI from 'openai';
import { toAiError } from './providers.js';

/**
 * OpenAI, Gemini, Ollama, vLLM, LM Studio and any other OpenAI-compatible server.
 *
 * @param {ReturnType<typeof import('./providers.js').resolveAi>} settings
 */
export function createOpenAiAdapter(settings, { fetch, maxRetries = 1 } = {}) {
  const client = new OpenAI({
    // Local servers don't check the key, but the SDK requires one.
    apiKey: settings.apiKey || 'not-needed',
    baseURL: settings.baseUrl,
    fetch,
    maxRetries,
    timeout: 120_000,
  });
  // OpenAI's reasoning models take an effort. Models that don't reason (GPT-4.1) reject it;
  // then it's dropped for the rest of the session. Other providers never get it.
  let sendEffort = settings.provider === 'openai';

  async function run(body, { onText, signal }) {
    const stream = await client.chat.completions.create(body, { signal });
    const hideThinking = createThinkFilter();
    let text = '';
    let finish = null;
    for await (const chunk of stream) {
      const choice = chunk.choices?.[0];
      const visible = hideThinking(choice?.delta?.content ?? '');
      if (visible) {
        text += visible;
        onText?.(visible);
      }
      finish = choice?.finish_reason ?? finish;
    }
    const rest = hideThinking.flush();
    if (rest) {
      text += rest;
      onText?.(rest);
    }
    return { text, stopReason: finish, declined: finish === 'content_filter' };
  }

  return {
    /** @param {import('./providers.js').ChatRequest} request */
    async streamChat({ system, messages, effort, onText, signal }) {
      const body = {
        model: settings.model,
        stream: true,
        messages: [{ role: 'system', content: system }, ...messages.map(toOpenAiMessage)],
      };
      if (sendEffort) {
        try {
          return await run({ ...body, reasoning_effort: effort ?? settings.effort }, { onText, signal });
        } catch (error) {
          if (error?.status !== 400 || !/reasoning_effort/i.test(error.message)) throw toAiError(error, settings);
          sendEffort = false;
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
        for await (const model of client.models.list()) ids.push(model.id);
        return ids;
      } catch (error) {
        throw toAiError(error, settings, { listing: true });
      }
    },
  };
}

function toOpenAiMessage({ role, content }) {
  return { role, content: typeof content === 'string' ? content : content.map((part) => part.text).join('\n\n') };
}

/**
 * Reasoning models served locally (DeepSeek-R1, Qwen3 under Ollama) often put their
 * thinking inside <think>…</think> in the answer itself. This drops it, even when a tag is
 * split across chunks.
 */
export function createThinkFilter() {
  let pending = '';
  let thinking = false;
  // The answer after </think> usually starts with blank lines; drop them.
  let afterThinking = false;
  const visible = (text) => {
    if (!afterThinking) return text;
    const trimmed = text.replace(/^\s+/, '');
    if (trimmed) afterThinking = false;
    return trimmed;
  };
  const filter = (chunk) => {
    pending += chunk;
    let out = '';
    for (;;) {
      const tag = thinking ? '</think>' : '<think>';
      const at = pending.indexOf(tag);
      if (at !== -1) {
        if (!thinking) out += visible(pending.slice(0, at));
        pending = pending.slice(at + tag.length);
        afterThinking = thinking;
        thinking = !thinking;
        continue;
      }
      // Keep back anything that could be the start of a tag.
      let keep = 0;
      for (let n = Math.min(tag.length - 1, pending.length); n > 0; n--) {
        if (tag.startsWith(pending.slice(-n))) {
          keep = n;
          break;
        }
      }
      if (!thinking) out += visible(pending.slice(0, pending.length - keep));
      pending = pending.slice(pending.length - keep);
      break;
    }
    return out;
  };
  filter.flush = () => {
    const rest = thinking ? '' : visible(pending);
    pending = '';
    return rest;
  };
  return filter;
}
