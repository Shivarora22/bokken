import { Command, CommanderError } from 'commander';
import pkg from '../package.json' with { type: 'json' };
import { runEditorWithLock } from './terminal/editor.js';

const defaults = {
  isInteractive: () => Boolean(process.stdin.isTTY && process.stdout.isTTY),
  // Loaded on demand, so plain commands don't pay for Ink and React.
  openApp: async () => (await import('./app/open.jsx')).openApp({ version: pkg.version }),
};

/**
 * Runs the CLI and returns its exit code: 0 success, 1 failure, 2 bad usage.
 *
 * @param {string[]} argv
 * @param {Partial<typeof defaults> & { output?: import('commander').OutputConfiguration }} [deps]
 * @returns {Promise<number>}
 */
export async function main(argv, deps = {}) {
  const { isInteractive, openApp, output } = { ...defaults, ...deps };

  const program = new Command('bokken')
    .description(pkg.description)
    .version(pkg.version, '-v, --version')
    .exitOverride()
    .action(async () => {
      if (!isInteractive()) {
        program.error('bokken needs an interactive terminal to open the practice app. See `bokken --help`.', {
          exitCode: 2,
        });
      }
      await openApp();
    });
  // Before adding commands, so they inherit it.
  if (output) program.configureOutput(output);

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
    return 0;
  } catch (error) {
    // Commander has already printed its message (or the help text).
    if (error instanceof CommanderError) return error.exitCode === 0 ? 0 : 2;
    const writeErr = output?.writeErr ?? ((text) => process.stderr.write(text));
    writeErr(`bokken: ${error.message}\n`);
    return 1;
  }
}
