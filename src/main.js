import { Command, CommanderError } from 'commander';
import pkg from '../package.json' with { type: 'json' };
import { chatModels, createAdapter, PROVIDERS, resolveAi } from './ai/providers.js';
import { runEditorWithLock } from './editor.js';
import { getPaths, loadConfig, loadCredentials, saveConfig, saveCredentials } from './settings.js';

// --- Commands --------------------------------------------------------------

const defaults = {
  isInteractive: () => Boolean(process.stdin.isTTY && process.stdout.isTTY),
  // Loaded on demand, so plain commands don't pay for Ink and React.
  openApp: async (options = {}) => (await import('./app/open.jsx')).openApp({ version: pkg.version, ...options }),
  aiCommands: async () => ({ aiStatus, aiOff }),
  logout,
};

/**
 * Runs the CLI and returns its exit code: 0 success, 1 failure, 2 bad usage.
 *
 * @param {string[]} argv
 * @param {Partial<typeof defaults> & { output?: import('commander').OutputConfiguration }} [deps]
 * @returns {Promise<number>}
 */
export async function main(argv, deps = {}) {
  const { isInteractive, openApp, aiCommands, logout: logoutFn, output } = { ...defaults, ...deps };
  const write = output?.writeOut ?? ((text) => process.stdout.write(text));
  let exitCode = 0;

  const program = new Command('bokken')
    .description(pkg.description)
    .version(pkg.version, '-v, --version')
    .option('--usage', 'show the tokens each AI answer used')
    .exitOverride();
  // Before adding commands, so they inherit it.
  if (output) program.configureOutput(output);

  const inApp = (options) => async () => {
    if (!isInteractive()) {
      program.error('bokken needs an interactive terminal to open the practice app. See `bokken --help`.', { exitCode: 2 });
    }
    await openApp({ ...options, ...(program.opts().usage ? { showUsage: true } : {}) });
  };

  program.action(inApp({}));
  program.command('today').description("open today's problem").action(inApp({ start: { daily: true } }));
  program
    .command('open')
    .description('open a problem by number, slug, title or link')
    .argument('<problem...>')
    .action((words) => inApp({ start: { ref: words.join(' ') } })());
  program.command('setup').description('choose your language, editor and solutions folder').action(inApp({ start: { setup: true } }));

  const ai = program.command('ai').description('set up or manage the AI coach (Claude, OpenAI, Gemini, local models)');
  ai.command('setup').description('choose a provider, key and model').action(inApp({ start: { aiSetup: true } }));
  ai.command('status')
    .description('show the AI provider and model')
    .option('--check', 'also check that the key and model work')
    .action(async ({ check }) => {
      exitCode = await (await aiCommands()).aiStatus({ check, write });
    });
  ai.command('off')
    .description('turn AI off and delete a key bokken saved')
    .action(async () => {
      exitCode = (await aiCommands()).aiOff({ write });
    });

  program.command('login').description('log in to LeetCode, to run and submit your code').action(inApp({ start: { login: true } }));
  program
    .command('logout')
    .description('forget the LeetCode login saved on this computer')
    .action(() => {
      exitCode = logoutFn({ write });
    });

  // What a split pane runs: the editor, plus a lock file that says it's open.
  program
    .command('__editor', { hidden: true })
    .argument('<lock>')
    .argument('<editor...>', 'editor command, its args, and the file (after --)')
    .action(async (lock, commandLine) => {
      await runEditorWithLock(lock, commandLine);
    });

  try {
    await program.parseAsync(argv);
    return exitCode;
  } catch (error) {
    // Commander has already printed its message (or the help text).
    if (error instanceof CommanderError) return error.exitCode === 0 ? 0 : 2;
    const writeErr = output?.writeErr ?? ((text) => process.stderr.write(text));
    writeErr(`bokken: ${error.message}\n`);
    return 1;
  }
}

// --- bokken ai status | off ------------------------------------------------

/**
 * `bokken ai status [--check]`. Returns the exit code.
 *
 * @param {{ check?: boolean, write: (text: string) => void, env?: NodeJS.ProcessEnv, paths?: ReturnType<typeof getPaths>, createAdapterFn?: typeof createAdapter }} options
 */
export async function aiStatus({ check = false, write, env = process.env, paths = getPaths(env), createAdapterFn = createAdapter }) {
  const credentials = loadCredentials(paths.credentials);
  const settings = resolveAi(loadConfig(paths.config), credentials, env);
  if (!settings) {
    write("AI isn't set up. Run: bokken ai setup\n");
    return 0;
  }

  const key = credentials.ai?.apiKey
    ? `saved in ${paths.credentials} (ends in ${credentials.ai.apiKey.slice(-4)})`
    : settings.apiKey
      ? `from $${loadConfig(paths.config).ai.apiKeyEnv}`
      : PROVIDERS[settings.provider].key === 'none'
        ? 'none needed'
        : 'none';
  write(`Provider  ${settings.name}\nModel     ${settings.model}\n`);
  if (settings.baseUrl) write(`Base URL  ${settings.baseUrl}\n`);
  write(`API key   ${key}\n`);
  if (settings.keyProblem) {
    write(`\n${settings.keyProblem.replace('/ai', 'bokken ai setup')}\n`);
    return 1;
  }

  if (check) {
    try {
      const models = chatModels(await (await createAdapterFn(settings)).listModels());
      write(
        models.includes(settings.model)
          ? `\n✓ ${settings.name} answered, and ${settings.model} is available.\n`
          : `\n✓ ${settings.name} answered, but it doesn't list ${settings.model}. If answers fail, run: bokken ai setup\n`,
      );
    } catch (error) {
      write(`\n✗ ${error.message.replace('/ai', 'bokken ai setup')}\n`);
      return 1;
    }
  }
  return 0;
}

/** `bokken ai off`: turns AI off and deletes a key bokken saved. Keys in environment variables stay where they are. */
export function aiOff({ write, env = process.env, paths = getPaths(env) }) {
  const config = loadConfig(paths.config);
  saveConfig({ ...config, ai: { ...config.ai, provider: null, model: null, baseUrl: null, apiKeyEnv: null } }, paths.config);
  const credentials = loadCredentials(paths.credentials);
  const hadKey = Boolean(credentials.ai);
  if (hadKey) {
    delete credentials.ai;
    saveCredentials(credentials, paths.credentials);
  }
  write(`AI is off.${hadKey ? ' The key bokken saved is deleted.' : ''} Turn it back on with: bokken ai setup\n`);
  return 0;
}

// --- bokken logout ---------------------------------------------------------

/** `bokken logout`. The session stays valid on LeetCode; logging out there ends it everywhere. */
export function logout({ write, env = process.env, paths = getPaths(env) }) {
  const credentials = loadCredentials(paths.credentials);
  if (!credentials.leetcode) {
    write("You weren't logged in to LeetCode.\n");
    return 0;
  }
  delete credentials.leetcode;
  saveCredentials(credentials, paths.credentials);
  write('Logged out. The LeetCode login saved on this computer is deleted. To end it everywhere, log out on leetcode.com too.\n');
  return 0;
}
