import { spawn } from 'node:child_process';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { which } from './which.js';

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
