import path from 'node:path';
import { formatDuration } from '../format.js';
import { isEditorOpen, runEditor } from './editor.js';
import { focusSplit, openSplit, SPLIT_NAMES } from './split.js';
import { RESTORE_TITLE, SAVE_TITLE, titleSequence } from './title.js';

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
