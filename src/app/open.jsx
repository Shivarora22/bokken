import { render } from 'ink';
import { App } from './App.jsx';

/**
 * Opens the full-screen app and resolves once the user quits.
 * The alternate screen gives the terminal back exactly as it was, like vim does.
 *
 * @param {{ version: string }} props
 */
export async function openApp({ version }) {
  const app = render(<App version={version} />, { alternateScreen: true });
  await app.waitUntilExit();
}
