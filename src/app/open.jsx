import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { render } from 'ink';
import { findEditor } from '../terminal/editor.js';
import { createEditorSession } from '../terminal/session.js';
import { detectSplit, mightBeWindowsTerminal } from '../terminal/split.js';
import { App } from './App.jsx';

// M1 spike: a scratch solution file to edit. M3 replaces it with real problem folders.
const SAMPLE = `# bokken M1 spike: edit and save this file, and watch bokken notice.

# @bokken code=start
class Solution:
    def twoSum(self, nums, target):
        pass
# @bokken code=end
`;

/**
 * Opens the full-screen app and resolves once the user quits.
 * The alternate screen gives the terminal back exactly as it was, like vim does.
 *
 * @param {{ version: string }} props
 */
export async function openApp({ version }) {
  const dir = path.join(os.tmpdir(), 'bokken-spike');
  const file = path.join(dir, 'solution.py');
  mkdirSync(dir, { recursive: true });
  try {
    writeFileSync(file, SAMPLE, { flag: 'wx' });
  } catch (error) {
    // Never overwrite: keep what the user wrote last time.
    if (error.code !== 'EEXIST') throw error;
  }

  const split = detectSplit();
  const session = createEditorSession({
    editor: findEditor(),
    file,
    split,
    mightBeWindowsTerminal: !split && mightBeWindowsTerminal(),
    lockPath: path.join(dir, '.editor.lock'),
    cliCommand: [process.execPath, process.argv[1]],
  });

  const app = render(<App version={version} session={session} />, { alternateScreen: true });
  await app.waitUntilExit();
}
