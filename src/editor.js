import { spawn } from 'node:child_process';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { focusSplit, openSplit, SPLIT_NAMES } from './split.js';
import { formatDuration, which } from './util.js';

// Your terminal editor: finding it, running it, and opening it next to the app.

// --- Finding and running editors -------------------------------------------

// Terminal editors we look for, in order. Microsoft's `edit` only counts on Windows:
// on Debian and Ubuntu, `edit` is run-mailcap.
const TERMINAL_EDITORS = ['nvim', 'vim', 'hx', 'micro', 'nano', 'edit', 'vi'];

// GUI editors people often set as their editor. bokken only opens terminal editors.
const GUI_EDITORS = new Set(['code', 'code-insiders', 'cursor', 'codium', 'subl', 'zed', 'gedit', 'kate', 'mate', 'atom', 'notepad', 'notepad++', 'gvim', 'mvim']);

/**
 * @typedef {{ name: string, command: string, args: string[] }} Editor
 *   `command` is an absolute path, so it still works in a new pane with a different PATH.
 */

/**
 * Picks a terminal editor. The one chosen in setup comes first, then $VISUAL and $EDITOR,
 * the standard Unix variables for your editor ("visual" means full-screen, like vim,
 * not GUI). A GUI editor there is skipped. Otherwise, the first terminal editor installed.
 *
 * @param {{ env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform, preferred?: string | null }} [options]
 * @returns {Editor | null}
 */
export function findEditor({ env = process.env, platform = process.platform, preferred } = {}) {
  return listEditors({ env, platform, preferred })[0] ?? null;
}

/** Every terminal editor available, best first, for setup to offer. */
export function listEditors({ env = process.env, platform = process.platform, preferred } = {}) {
  const found = [];
  const add = (editor) => {
    if (editor && !GUI_EDITORS.has(editor.name) && !found.some((e) => e.command === editor.command)) found.push(editor);
  };
  for (const setting of [preferred, env.VISUAL, env.EDITOR]) {
    if (setting) add(parseEditorSetting(setting.trim(), { env, platform }));
  }
  for (const name of TERMINAL_EDITORS) {
    if (name === 'edit' && platform !== 'win32') continue;
    const command = which(name, { env, platform });
    if (command) add({ name, command, args: [] });
  }
  return found;
}

/**
 * The command that installs micro (easy for beginners: ctrl+s saves, ctrl+q quits), or
 * null when no known package manager is around. bokken only runs it if the user says yes.
 */
export function installSuggestion({ env = process.env, platform = process.platform } = {}) {
  const has = (name) => which(name, { env, platform }) !== null;
  if (platform === 'win32') return has('winget') ? 'winget install zyedidia.micro' : null;
  if (platform === 'darwin') return has('brew') ? 'brew install micro' : null;
  if (has('apt-get')) return 'sudo apt install micro';
  if (has('dnf')) return 'sudo dnf install micro';
  if (has('pacman')) return 'sudo pacman -S micro';
  if (has('brew')) return 'brew install micro';
  return null;
}

function parseEditorSetting(setting, options) {
  // A path with spaces ("C:\Program Files\…\nvim.exe") is one command, not a command and args.
  const whole = which(setting, options);
  const [first, ...args] = whole ? [setting] : setting.split(/\s+/);
  const command = whole ?? which(first, options);
  if (!command) return null;
  return { name: editorName(command), command, args };
}

function editorName(command) {
  return path.win32.basename(path.posix.basename(command)).replace(/\.(exe|cmd|bat|com)$/i, '').toLowerCase();
}

/**
 * Runs the editor in this terminal and resolves with its exit code when it quits.
 *
 * @param {Editor} editor
 * @param {string} file
 */
export function runEditor(editor, file, { platform = process.platform } = {}) {
  // Node won't spawn .cmd/.bat files without a shell.
  const shell = platform === 'win32' && /\.(cmd|bat)$/i.test(editor.command);
  const quote = (arg) => (shell ? `"${arg}"` : arg);
  return new Promise((resolve, reject) => {
    const child = spawn(quote(editor.command), [...editor.args, file].map(quote), { stdio: 'inherit', shell });
    child.on('error', reject);
    child.on('exit', (code, signal) => resolve(code ?? (signal ? 128 : 1)));
  });
}

/** Runs an install command (from `installSuggestion`) in this terminal, so sudo can ask for a password. */
export function runInstall(command) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { stdio: 'inherit', shell: true });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

/**
 * The hidden `bokken __editor` command. A split pane runs the editor through it, so the
 * lock file exists exactly while the editor is open. That's how the app knows the
 * editor is still open, even in terminals like Windows Terminal that can't list panes.
 *
 * @param {string} lockPath
 * @param {string[]} commandLine the editor command, its args, and the file
 */
export async function runEditorWithLock(lockPath, [command, ...args]) {
  writeFileSync(lockPath, JSON.stringify({ pid: process.pid }));
  const removeLock = () => {
    if (readLockPid(lockPath) === process.pid) unlinkSync(lockPath);
  };
  process.on('exit', removeLock);
  // ctrl+c belongs to the editor; this wrapper just waits for it to quit.
  process.on('SIGINT', () => {});
  process.on('SIGQUIT', () => {});
  // Closing the pane hangs up both processes.
  for (const signal of ['SIGHUP', 'SIGTERM']) process.on(signal, () => process.exit(129));

  const file = args.pop();
  return runEditor({ name: editorName(command), command, args }, file);
}

/** Whether an editor started by `runEditorWithLock` is still open. */
export function isEditorOpen(lockPath) {
  const pid = readLockPid(lockPath);
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return error.code === 'EPERM';
  }
}

function readLockPid(lockPath) {
  try {
    return JSON.parse(readFileSync(lockPath, 'utf8')).pid;
  } catch {
    return null;
  }
}

// --- Tab title -------------------------------------------------------------

// xterm's title stack: save the tab's current title, and put it back later.
// Terminals without a title stack ignore these.
export const SAVE_TITLE = '\x1b[22;0t';
export const RESTORE_TITLE = '\x1b[23;0t';

/** The escape sequence that sets the terminal tab's title. */
export function titleSequence(text) {
  return `\x1b]0;${text.replace(/[\x00-\x1f\x7f]/g, '')}\x07`;
}

// --- Editor session --------------------------------------------------------

/**
 * Opens the editor next to the app: in a split when the terminal can do it, otherwise
 * by handing the editor the full screen until it quits.
 *
 * @param {{
 *   editor: import('./editor.js').Editor | null,
 *   file: string,
 *   lockPath: string,
 *   cliCommand: string[],
 *   env?: NodeJS.ProcessEnv,
 *   stdout?: NodeJS.WriteStream,
 * }} options `cliCommand` runs this bokken (Node plus script), for the split pane.
 */
export function createEditorSession({ editor, file, lockPath, cliCommand, env = process.env, stdout = process.stdout }) {
  let paneId = null;

  async function openInSplit(kind) {
    if (isEditorOpen(lockPath)) {
      await focusSplit(kind, paneId);
      return [`Switched to ${editor.name}.`];
    }
    paneId = await openSplit(kind, {
      commandLine: [...cliCommand, '__editor', lockPath, '--', editor.command, ...editor.args, file],
      cwd: path.dirname(file),
      env,
    });
    return [`Opened ${editor.name} in a ${SPLIT_NAMES[kind]} split${paneId ? ` (pane ${paneId})` : ''}.`];
  }

  async function handOff(suspendTerminal, elapsed) {
    const started = Date.now();
    await suspendTerminal(async () => {
      // The app is off screen, so the timer moves to the tab's title.
      const tick = () => stdout.write(titleSequence(`⏱ ${formatDuration(elapsed())} · bokken`));
      stdout.write(SAVE_TITLE);
      tick();
      const timer = setInterval(tick, 1000);
      try {
        await runEditor(editor, file);
      } finally {
        clearInterval(timer);
        stdout.write(RESTORE_TITLE);
      }
    });
    return [`Back from ${editor.name} after ${formatDuration(Date.now() - started)}.`];
  }

  return {
    editor,
    file,
    isOpen: () => isEditorOpen(lockPath),

    /**
     * Opens the editor, or focuses it if it's already open. Returns lines for the log.
     *
     * @param {{
     *   suspendTerminal: import('ink').SuspendTerminal,
     *   elapsed: () => number,
     *   split: import('./split.js').SplitKind | null,
     * }} app
     * @returns {Promise<string[]>}
     */
    async open({ suspendTerminal, elapsed, split: kind }) {
      if (!editor) return ['No terminal editor found. Install one, such as nvim, micro or nano.'];
      if (!kind) return handOff(suspendTerminal, elapsed);
      try {
        return await openInSplit(kind);
      } catch (error) {
        const reason = error.code === 'ENOENT' ? `${error.path} not found` : error.message.trim();
        return [`Couldn't open a ${SPLIT_NAMES[kind]} split (${reason}). Using the full screen instead.`, ...(await handOff(suspendTerminal, elapsed))];
      }
    },
  };
}
