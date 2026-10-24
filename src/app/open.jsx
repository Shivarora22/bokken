import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { render } from 'ink';
import { createCoach } from '../ai/coach.js';
import { createAdapter } from '../ai/providers.js';
import { openDb } from '../db.js';
import { createEditorSession, findEditor, installSuggestion, listEditors, runInstall } from '../editor.js';
import { createClient, pruneProblems, signedInUser } from '../leetcode.js';
import { getPaths, loadConfig, loadCredentials, saveConfig, saveCredentials } from '../settings.js';
import { resolveSplit } from '../split.js';
import { recordEvent } from '../tracking.js';
import { App } from './App.jsx';

/**
 * Opens the full-screen app and resolves once the user quits. The alternate screen gives
 * the terminal back exactly as it was, like vim does.
 *
 * @param {{ version: string, start?: { daily?: boolean, ref?: string, setup?: boolean, aiSetup?: boolean, login?: boolean } }} options
 */
export async function openApp({ version, start }) {
  const paths = getPaths();
  const firstRun = !existsSync(paths.config);
  const db = await openDb(paths.db);
  pruneProblems(db);
  const { leetcode } = loadCredentials(paths.credentials);
  const current = { attemptId: null, idleMs: undefined };

  const ctx = {
    db,
    client: createClient({ session: leetcode?.session }),
    // A pasted session is checked with a client of its own before it replaces the app's.
    checkSession: (session) => signedInUser(createClient({ session })),
    env: process.env,
    loadConfig: () => loadConfig(paths.config),
    saveConfig: (config) => saveConfig(config, paths.config),
    loadCredentials: () => loadCredentials(paths.credentials),
    saveCredentials: (credentials) => saveCredentials(credentials, paths.credentials),
    createCoach: async (settings) => createCoach(await createAdapter(settings), settings),
    listAiModels: async (settings) => (await createAdapter(settings)).listModels(),
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

  const app = render(<App version={version} ctx={ctx} firstRun={firstRun} start={start} />, { alternateScreen: true, exitOnCtrlC: false });
  await app.waitUntilExit();
}
