import {
  ASK_VERSION,
  askMessages,
  askSystemPrompt,
  CLASSIFY_SYSTEM,
  CLASSIFY_VERSION,
  classifyMessages,
  HINT_SYSTEM,
  HINT_VERSION,
  hintMessages,
  NO_CODE_RETRY,
  parseMode,
} from './prompts.js';

// --- Coach -----------------------------------------------------------------

const MAX_TOKENS = { hint: 4000, classify: 16, explain: 6000, other: 2000, solution: 16000 };

/**
 * The only part of bokken that talks to a model. It builds the prompts, applies the rules
 * and checks the answers; the app never sees a prompt.
 *
 * @param {import('./providers.js').Adapter} adapter
 */
export function createCoach(adapter, settings) {
  const log = (kind, version, extra = {}) => ({ kind, promptVersion: version, provider: settings.provider, model: settings.model, ...extra });

  return {
    settings,

    /** hint | explain | solution | other, from a tiny call that sees only the question and a state summary. */
    async classify({ question, hintsUsed, hasCode, signal }) {
      const result = await adapter.streamChat({
        system: CLASSIFY_SYSTEM,
        messages: classifyMessages({ question, hintsUsed, hasCode }),
        maxTokens: MAX_TOKENS.classify,
        think: false,
        effort: 'low',
        signal,
      });
      return { mode: parseMode(result.text), log: log('classify', CLASSIFY_VERSION) };
    },

    /**
     * An AI hint at `level` (1–3). Hints are short, so the whole answer is checked before
     * it's shown: if it has code, ask once more without; if it still does, strip it.
     */
    async hint({ problem, code, lang, lastResult, earlierHints, level, question, signal }) {
      const messages = hintMessages({ problem, code, lang, lastResult, earlierHints, level, question });
      const request = { system: HINT_SYSTEM, maxTokens: MAX_TOKENS.hint, signal };
      let result = await adapter.streamChat({ ...request, messages });
      let text = result.text.trim();
      let retried = false;
      let stripped = false;
      if (containsCode(text)) {
        retried = true;
        result = await adapter.streamChat({
          ...request,
          messages: [...messages, { role: 'assistant', content: text }, { role: 'user', content: NO_CODE_RETRY }],
        });
        text = result.text.trim();
        if (containsCode(text)) {
          stripped = true;
          text = stripCode(text);
        }
      }
      return { text, declined: result.declined, log: log('hint', HINT_VERSION, { level, retried, stripped }) };
    },

    /**
     * explain, solution or other: streamed as it's written. A solution shows every approach,
     * or answers a follow-up (`variant: 'asked'`). `solutionShown` lifts the hint-level limit
     * on explanations.
     */
    async answer({ mode, variant, solutionShown, problem, code, lang, lastResult, earlierHints, level, history, question, onText, signal }) {
      const result = await adapter.streamChat({
        system: askSystemPrompt(mode, lang, { variant, solutionShown }),
        messages: askMessages({ mode, problem, code, lang, lastResult, earlierHints, level, history, question, maxContext: settings.maxContext }),
        maxTokens: MAX_TOKENS[mode] ?? MAX_TOKENS.explain,
        onText,
        signal,
      });
      return {
        text: result.text,
        declined: result.declined,
        gaveSolution: containsSolution(result.text, problem.metaData),
        log: log('ask', ASK_VERSION, { mode, level, ...(mode === 'solution' ? { variant: variant ?? 'all' } : {}) }),
      };
    },
  };
}

// --- Checks ----------------------------------------------------------------

// Code decides what kind of help you get; these checks enforce it on the model's answer.

const FENCE = /(```|~~~)[\s\S]*?(?:\1|$)/g;
const CODE_LINE =
  /^\s*(def |class |for\b.*[:{]\s*$|while\b.*[:{]\s*$|if\b.*[:{]\s*$|elif\b|else\s*[:{]|return\b|public |private |static |int |long |vector<|unordered_map|HashMap|function\b|const |let |var |#include|import |from \S+ import|print\(|console\.log|[{}]\s*$)|;\s*$/;
const INLINE = /`([^`\n]+)`/g;

function isCodeSpan(span) {
  if (/^O\(.*\)$/.test(span)) return false; // Big-O, like `O(n log n)`
  if (/[;{}]|[^=!<>]=[^=]|==/.test(span)) return true; // assignment, comparison, statement
  return span.length >= 10 && /\w\(.*\)/.test(span);
}

/** A fenced block, two or more code-looking lines, or an inline span that's an expression. */
export function containsCode(text) {
  if (/```|~~~/.test(text)) return true;
  if (text.split('\n').filter((line) => CODE_LINE.test(line)).length >= 2) return true;
  return [...text.matchAll(INLINE)].some(([, span]) => isCodeSpan(span));
}

/** What's left of a hint once the code is taken out (may be empty). */
export function stripCode(text) {
  return text
    .replace(FENCE, '')
    .split('\n')
    .filter((line) => !CODE_LINE.test(line))
    .join('\n')
    .replace(INLINE, (match, span) => (isCodeSpan(span) ? '(code removed)' : match))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** A code block that defines the problem's function or class: the answer gave the solution away. */
export function containsSolution(text, metaData) {
  const names = [metaData?.name, metaData?.classname].filter(Boolean);
  if (!names.length) return false;
  const blocks = text.match(/(```|~~~)[\s\S]*?(?:\1|$)/g) ?? [];
  return blocks.some((block) => names.some((name) => block.includes(name)));
}
