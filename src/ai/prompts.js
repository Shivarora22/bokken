import { LANGUAGES } from '../languages.js';
import { htmlToMarkdown } from '../markdown.js';

// Every prompt bokken sends. They're public: this is exactly what goes to your provider.

// --- Shared context --------------------------------------------------------

// The parts of a request that describe the problem and where the user is. The problem
// block never changes for a problem, so it goes first and providers can cache it.

function problemBlock(problem) {
  const topics = problem.topics.map((t) => t.name).join(', ');
  const hints = problem.hints.map((hint, i) => `${i + 1}. ${htmlToMarkdown(hint)}`).join('\n');
  return [
    '<problem>',
    `# ${problem.frontendId}. ${problem.title} (${problem.difficulty})${topics ? `: ${topics}` : ''}`,
    htmlToMarkdown(problem.content),
    signature(problem.metaData),
    hints ? `Official hints:\n${hints}` : 'Official hints: none',
    '</problem>',
  ]
    .filter(Boolean)
    .join('\n');
}

function codeBlock(code, lang) {
  return code?.trim() ? `<my_code language="${lang}">\n${code}\n</my_code>` : '<my_code>(nothing written yet)</my_code>';
}

/** @param {{ label: string, text: string }[]} hints official and AI hints the user already has */
function earlierHintsBlock(hints) {
  if (!hints.length) return '<earlier_hints>none</earlier_hints>';
  return `<earlier_hints>\n${hints.map((h) => `${h.label}: ${h.text}`).join('\n')}\n</earlier_hints>`;
}

function lastResultBlock(lastResult) {
  return lastResult ? `<last_result>${lastResult}</last_result>` : null;
}

function signature(metaData) {
  if (!metaData) return null;
  const params = (list) => (list ?? []).map((p) => `${p.name}: ${p.type}`).join(', ');
  if (metaData.name && metaData.params) return `Function: ${metaData.name}(${params(metaData.params)}) -> ${metaData.return?.type ?? 'void'}`;
  if (metaData.classname) {
    const methods = (metaData.methods ?? []).map((m) => `${m.name}(${params(m.params)})`).join(', ');
    return `Class: ${metaData.classname}${methods ? ` with methods ${methods}` : ''}`;
  }
  return null;
}

// --- Hints -----------------------------------------------------------------

export const HINT_VERSION = 'hint-1';

export const LEVEL_NAMES = { 1: 'Nudge', 2: 'Approach', 3: 'Outline' };

// The same for every hint, so providers can cache it.
export const HINT_SYSTEM = `You are a coding-interview coach inside bokken, a terminal tool.
Help the user solve the problem themselves.

Rules:
- Never write code in any programming language.
- Give exactly what the requested level asks for, nothing more.
- If the user's code is on a workable path, build on it. If it's a dead end, say so kindly and redirect.
- Don't repeat earlier hints; go further than them.
- If the user asked a question, answer it at the requested level.
- Plain text, at most 5 sentences.

Levels:
1 Nudge: one guiding question or observation. Don't name the algorithm.
2 Approach: the technique or data structure, why it fits, target time/space complexity.
3 Outline: numbered plain-language steps and the edge cases to handle.`;

export const NO_CODE_RETRY = 'Your answer contained code. Give the same hint again with no code at all, not even one line or expression. Describe it in words.';

/** The problem first (cached), then what changes: code, last result, earlier hints, question. */
export function hintMessages({ problem, code, lang, lastResult, earlierHints, level, question }) {
  const state = [
    codeBlock(code, lang),
    lastResultBlock(lastResult),
    earlierHintsBlock(earlierHints),
    question ? `<question>${question}</question>` : null,
    `Give a level ${level} hint.`,
  ];
  return [{ role: 'user', content: [{ text: problemBlock(problem), cache: true }, { text: state.filter(Boolean).join('\n') }] }];
}

// --- Classifying a question ------------------------------------------------

export const CLASSIFY_VERSION = 'classify-1';

export const MODES = ['hint', 'explain', 'solution', 'other'];

export const CLASSIFY_SYSTEM = `Classify the user's request about a coding problem. Reply with exactly one word:
hint     - wants help moving forward without being given the answer
           (includes "I'm stuck", "how do I approach this", "why is my code wrong")
explain  - wants something explained: the problem, an example, a concept,
           an error message, or the complexity of their own code
solution - explicitly asks for the full solution, the answer, or working code
other    - not about this problem
If unsure, reply hint.`;

/** Only the question and a one-line state: never the problem text or the user's code. */
export function classifyMessages({ question, hintsUsed, hasCode }) {
  const state = `State: ${hintsUsed} hint${hintsUsed === 1 ? '' : 's'} used; ${hasCode ? 'has written some code' : 'no code yet'}.`;
  return [{ role: 'user', content: `${state}\nRequest: ${question}` }];
}

/** Anything unexpected counts as hint, the safe default. */
export function parseMode(reply) {
  const word = reply.trim().toLowerCase().match(/[a-z]+/)?.[0];
  return MODES.includes(word) ? word : 'hint';
}

// --- Answering a question --------------------------------------------------

export const ASK_VERSION = 'ask-2';

const BASE = `You are a coding-interview coach inside bokken, a terminal tool. Your answer is shown in a small terminal pane: keep it short and use plain text or simple Markdown.`;

const SOLUTIONS = {
  all: (name) => `The user asked for the solution and confirmed they want it.
Show every main way to solve it (two to four), from the simplest to the most efficient. For each one:
- A heading with its number and name, like "### 1. Brute force".
- The idea in one or two sentences.
- The complete code in ${name}, in a fenced code block, using the starter code's class and function signature.
- Its time and space complexity, on one line.
End with one line saying which approach is the most efficient, judged by the constraints (like n ≤ 10^5).`,
  asked: (name) => `The user has already seen the solutions and is asking for more (<question>), such as a faster, simpler or different version.
Give what they ask for: the idea, the complete code in ${name} in a fenced code block, and its complexity.`,
};

export function askSystemPrompt(mode, lang, { variant = 'all', solutionShown = false } = {}) {
  const name = LANGUAGES[lang]?.name ?? lang;
  if (mode === 'solution') return `${BASE}\n${(SOLUTIONS[variant] ?? SOLUTIONS.all)(name)}`;
  if (mode === 'other') {
    return `${BASE}
The user asked something that isn't about this problem. Answer briefly, in at most three sentences, then nudge them back to the problem.`;
  }
  if (solutionShown) {
    return `${BASE}
The user has already seen a full solution, so explain anything they ask: how a line works, why the approach is correct, other approaches and their complexity, how to make it faster. Show code when it helps.`;
  }
  return `${BASE}
The user wants something explained: the problem, an example, a concept, an error message, or their own code.
Rules:
- Be clear and concrete. Use the problem's own examples where they help.
- Don't reveal more of the approach than the hint level they've reached (<hint_level>). At level 0, don't name the technique that solves the problem.
- Never write solution code for this problem.`;
}

/**
 * The problem first (cached), then the user's state, the recent conversation, and the
 * question. `maxContext` (in tokens, for small local models) drops the oldest turns.
 */
export function askMessages({ mode, problem, code, lang, lastResult, earlierHints, level, history = [], question, maxContext }) {
  const head = problemBlock(problem);
  const state = [codeBlock(code, lang), lastResultBlock(lastResult), earlierHintsBlock(earlierHints), `<hint_level>${level}</hint_level>`];
  const tail = `<question>${question}</question>`;

  let turns = history;
  const size = () => estimateTokens([head, ...state, conversation(turns), tail].filter(Boolean).join('\n'));
  while (maxContext && turns.length && size() > maxContext) turns = turns.slice(1);

  const body = [...state, conversation(turns), tail].filter(Boolean).join('\n');
  return [{ role: 'user', content: [{ text: head, cache: true }, { text: body }] }];
}

function conversation(turns) {
  if (!turns.length) return null;
  return `<conversation>\n${turns.map((t) => `${t.role === 'user' ? 'User' : 'Coach'}: ${t.text}`).join('\n')}\n</conversation>`;
}

// Roughly four characters a token, close enough to keep a small model's context from overflowing.
export function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}
