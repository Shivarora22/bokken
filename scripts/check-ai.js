// Live check of the AI coach against a real provider. Spends a few cents' worth of tokens at most.
//   npm run check:ai                      your bokken AI setup
//   npm run check:ai -- gemini            GEMINI_API_KEY, the default Gemini model
//   npm run check:ai -- ollama qwen3:8b   a local model (BOKKEN_AI_BASE_URL to change the URL)
import { createCoach } from '../src/ai/coach.js';
import { chatModels, createAdapter, defaultModel, envKeyFor, PROVIDER_IDS, PROVIDERS, resolveAi } from '../src/ai/providers.js';
import { openDb } from '../src/db.js';
import { createClient, getProblem } from '../src/leetcode.js';
import { loadConfig, loadCredentials } from '../src/settings.js';

const [provider, modelArg] = process.argv.slice(2);
const fail = (message) => {
  console.error(`✗ ${message}`);
  process.exit(1);
};
const timed = async (label, work) => {
  const start = Date.now();
  const result = await work();
  console.log(`  ${label} (${((Date.now() - start) / 1000).toFixed(1)}s${result?.usage ? `, ${result.usage.inputTokens} in / ${result.usage.outputTokens} out` : ''})`);
  return result;
};

try {
  let settings;
  if (provider) {
    if (!PROVIDERS[provider]) fail(`Unknown provider "${provider}". Use one of: ${PROVIDER_IDS.join(', ')}.`);
    const ai = { provider, model: modelArg ?? 'checking', apiKeyEnv: envKeyFor(provider), baseUrl: process.env.BOKKEN_AI_BASE_URL };
    settings = resolveAi({ ai }, {}, process.env);
  } else {
    settings = resolveAi(loadConfig(), loadCredentials());
    if (!settings) fail("AI isn't set up. Run bokken ai setup, or name a provider: npm run check:ai -- ollama");
  }
  if (settings.keyProblem) fail(settings.keyProblem);

  const models = chatModels(await (await createAdapter(settings)).listModels());
  if (provider && !modelArg) settings = { ...settings, model: defaultModel(provider, models) };
  console.log(`✓ ${settings.name} lists ${models.length} chat models. Using ${settings.model}.\n`);

  const db = await openDb(':memory:');
  const problem = await getProblem(db, createClient(), 'two-sum');
  const coach = createCoach(await createAdapter(settings), settings);
  const base = { problem, code: '', lang: 'python3', earlierHints: [], lastResult: null };

  const { mode } = await timed('classify', () => coach.classify({ question: 'what does example 2 mean?', hintsUsed: 0, hasCode: false }));
  console.log(`    "what does example 2 mean?" → ${mode} ${mode === 'explain' ? '✓' : '(expected explain)'}\n`);

  const hint = await timed('level 1 hint', () => coach.hint({ ...base, level: 1 }));
  console.log(`    ${hint.text.replace(/\n/g, '\n    ')}`);
  if (hint.log.retried) console.log(`    (the first answer had code; ${hint.log.stripped ? 'stripped after a retry' : 'fixed by a retry'})`);
  console.log();

  process.stdout.write('    ');
  await timed('\n  streamed explanation', () =>
    coach.answer({ ...base, mode: 'explain', level: 0, history: [], question: 'What does example 2 mean?', onText: (piece) => process.stdout.write(piece.replace(/\n/g, '\n    ')) }),
  );
  console.log(`\n✓ ${settings.name} works with bokken.`);
} catch (error) {
  fail(error.message);
}
