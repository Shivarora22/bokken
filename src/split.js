import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { which } from './util.js';

const run = promisify(execFile);

/** @typedef {'tmux' | 'wezterm' | 'wt'} SplitKind */

export const SPLIT_NAMES = { tmux: 'tmux', wezterm: 'WezTerm', wt: 'Windows Terminal' };

/**
 * Which terminal can open the editor in a split next to bokken, or null when none can.
 * tmux comes first: inside tmux, a terminal-level split would open outside the session.
 * BOKKEN_SPLIT=tmux|wezterm|wt|none forces the choice, for testing.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {SplitKind | null}
 */
export function detectSplit(env = process.env) {
  const forced = env.BOKKEN_SPLIT;
  if (forced === 'none') return null;
  if (forced && Object.hasOwn(SPLIT_NAMES, forced)) return /** @type {SplitKind} */ (forced);
  if (env.TMUX) return 'tmux';
  if (env.WEZTERM_PANE) return 'wezterm';
  // VS Code's terminal inherits WT_SESSION when VS Code was started from Windows Terminal.
  if (env.WT_SESSION && env.TERM_PROGRAM !== 'vscode') return 'wt';
  return null;
}

/**
 * The split to use, and whether to ask "Is this window Windows Terminal?". A saved answer
 * only applies when bokken can't tell, so tmux still wins inside tmux.
 *
 * @returns {{ split: SplitKind | null, askWindowsTerminal: boolean }}
 */
export function resolveSplit(config, env = process.env, options) {
  const split = detectSplit(env);
  if (split || !mightBeWindowsTerminal(env, options)) return { split, askWindowsTerminal: false };
  const answer = config.terminal?.windowsTerminal;
  if (answer == null) return { split: null, askWindowsTerminal: true };
  return { split: answer ? 'wt' : null, askWindowsTerminal: false };
}

export function mightBeWindowsTerminal(env = process.env, { platform = process.platform } = {}) {
  if (env.BOKKEN_SPLIT) return false;
  if (platform !== 'win32' && !env.WSL_DISTRO_NAME) return false;
  if (env.TERM_PROGRAM || env.TERMINAL_EMULATOR || env.ALACRITTY_WINDOW_ID || env.KITTY_WINDOW_ID) return false;
  return which('wt.exe', { env, platform }) !== null;
}

/**
 * The command that runs `commandLine` in a new pane beside bokken.
 *
 * @param {SplitKind} kind
 * @param {{ commandLine: string[], cwd: string, env?: NodeJS.ProcessEnv }} options
 * @returns {{ command: string, args: string[] }}
 */
export function splitCommand(kind, { commandLine, cwd, env = process.env }) {
  switch (kind) {
    case 'tmux':
      // -b puts the editor on the left; -P prints the new pane's id.
      return {
        command: 'tmux',
        args: [
          'split-window', '-h', '-b', '-l', '60%',
          ...(env.TMUX_PANE ? ['-t', env.TMUX_PANE] : []),
          '-c', cwd, '-P', '-F', '#{pane_id}',
          shellQuote(commandLine),
        ],
      };
    case 'wezterm':
      return {
        command: 'wezterm',
        args: [
          'cli', 'split-pane',
          ...(env.WEZTERM_PANE ? ['--pane-id', env.WEZTERM_PANE] : []),
          '--left', '--percent', '60', '--cwd', cwd, '--', ...commandLine,
        ],
      };
    case 'wt': {
      // From WSL, the pane runs the editor in the same Linux distro, not in Windows.
      const pane = env.WSL_DISTRO_NAME
        ? ['wsl.exe', '-d', env.WSL_DISTRO_NAME, '--cd', cwd, '--', ...commandLine]
        : ['-d', cwd, ...commandLine];
      // wt.exe reads a bare `;` as the start of another wt command.
      return {
        command: 'wt.exe',
        args: ['-w', '0', 'split-pane', '-V', '-s', '0.6', ...pane.map((arg) => arg.replaceAll(';', '\\;'))],
      };
    }
    default:
      throw new Error(`Unknown split kind: ${kind}`);
  }
}

/**
 * Opens the pane. Returns its id when the terminal reports one (tmux, WezTerm).
 *
 * @param {SplitKind} kind
 * @param {Parameters<typeof splitCommand>[1]} options
 * @returns {Promise<string | null>}
 */
export async function openSplit(kind, options) {
  const { command, args } = splitCommand(kind, options);
  const { stdout } = await run(command, args, { timeout: 5000 });
  const paneId = stdout.trim() || null;
  if (kind === 'wezterm' && paneId) await focusSplit(kind, paneId);
  return paneId;
}

/**
 * Moves keyboard focus to the editor's pane.
 *
 * @param {SplitKind} kind
 * @param {string | null} paneId
 */
export async function focusSplit(kind, paneId) {
  if (kind === 'tmux' && paneId) await run('tmux', ['select-pane', '-t', paneId], { timeout: 5000 });
  if (kind === 'wezterm' && paneId) await run('wezterm', ['cli', 'activate-pane', '--pane-id', paneId], { timeout: 5000 });
  // Windows Terminal can't target a pane by id, but the editor's pane opened to our right.
  if (kind === 'wt') await run('wt.exe', ['-w', '0', 'move-focus', 'right'], { timeout: 5000 });
}

/** Joins arguments into one POSIX shell command line. */
export function shellQuote(args) {
  return args.map((arg) => `'${arg.replaceAll("'", "'\\''")}'`).join(' ');
}
