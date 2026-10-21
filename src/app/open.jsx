import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { render } from 'ink';
import { loadConfig, saveConfig } from '../config.js';
import { loadCredentials } from '../credentials.js';
import { openDb } from '../db.js';
import { createClient } from '../leetcode/client.js';
import { getPaths } from '../paths.js';
import { findEditor, installSuggestion, listEditors, runInstall } from '../terminal/editor.js';
import { createEditorSession } from '../terminal/session.js';
import { resolveSplit } from '../terminal/split.js';
import { recordEvent } from '../tracking.js';
import { App } from './App.jsx';

/**
 * Opens the full-screen app and resolves once the user quits. The alternate screen gives
 * the terminal back exactly as it was, like vim does.
 *
 * @param {{ version: string, start?: { daily?: boolean, ref?: string, setup?: boolean } }} options
 */
export async function openApp({ version, start }) {
  const paths = getPaths();
  const firstRun = !existsSync(paths.config);
  const db = await openDb(paths.db);
  const { leetcode } = loadCredentials(paths.credentials);
  const current = { attemptId: null, idleMs: undefined };

  const ctx = {
    db,
    client: createClient({ session: leetcode?.session, csrftoken: leetcode?.csrftoken }),
    loadConfig: () => loadConfig(paths.config),
    saveConfig: (config) => saveConfig(config, paths.config),
    listEditors,
    installSuggestion,
    runInstall,
    resolveSplit: (config) => resolveSplit(config),
    createEditorSession: ({ file, slug, config }) => {
      const runDir = path.join(paths.home, 'run');
      mkdirSync(runDir, { recursive: true });
      return createEditorSession({
        editor: findEditor({ preferred: config.editor }),
        file,
        lockPath: path.join(runDir, `${slug}.lock`),
        cliCommand: [process.execPath, process.argv[1]],
      });
    },
    // The attempt on screen, so it can be closed however bokken exits.
    current,
  };

  process.on('exit', () => {
    try {
      if (current.attemptId) recordEvent(db, current.attemptId, 'close', { idleMs: current.idleMs });
      db.close();
    } catch {
      // Exiting anyway.
    }
  });

  const app = render(<App version={version} ctx={ctx} firstRun={firstRun} start={start} />, { alternateScreen: true });
  await app.waitUntilExit();
}
