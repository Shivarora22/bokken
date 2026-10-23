import { Box, Text, useInput } from 'ink';
import { useEffect, useState } from 'react';
import { parseSession } from '../leetcode.js';
import { Ask, TextInput } from './components.jsx';

const COPY_AGAIN = 'Log in on leetcode.com, then copy LEETCODE_SESSION again.';

/**
 * `/login` and `bokken login`: paste LeetCode's session cookie. It's checked with LeetCode
 * before it's saved, and the app uses it straight away. `onDone(username)`.
 */
export function Login({ ctx, onDone, onCancel }) {
  const [step, setStep] = useState('paste');
  const [session, setSession] = useState(null);
  const [error, setError] = useState(null);
  const [saved] = useState(() => Boolean(ctx.loadCredentials().leetcode?.session));

  useInput((_input, key) => {
    if (key.escape) onCancel();
  });

  const retry = (message) => {
    setError(message);
    setStep('paste');
  };

  useEffect(() => {
    if (step !== 'check') return undefined;
    let cancelled = false;
    ctx.checkSession(session).then(
      (username) => {
        if (cancelled) return;
        if (!username) return retry(`LeetCode says that session isn't signed in. ${COPY_AGAIN}`);
        const credentials = ctx.loadCredentials();
        credentials.leetcode = { session };
        ctx.saveCredentials(credentials);
        ctx.client.setSession(session);
        onDone(username);
      },
      (failure) => {
        if (!cancelled) retry(failure.code === 'auth' ? `LeetCode didn't accept that session. ${COPY_AGAIN}` : failure.message);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [step]);

  const submit = (value) => {
    const found = parseSession(value);
    if (!found) return setError("That doesn't look like a session. Copy the value of the LEETCODE_SESSION cookie.");
    setError(null);
    setSession(found);
    setStep('check');
  };

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text bold>Log in to LeetCode</Text>
      <Text dimColor>To run and submit your code from bokken. Esc to cancel.</Text>
      <Box flexDirection="column" marginTop={1}>
        <Text>1. Open https://leetcode.com in your browser and log in.</Text>
        <Text>2. Press F12, then open Application → Cookies → https://leetcode.com (in Firefox: Storage → Cookies).</Text>
        <Text>3. Copy the value of LEETCODE_SESSION and paste it below.</Text>
        <Text dimColor>It's saved only on this computer. bokken never sees your password.</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        {step === 'paste' ? (
          <Ask label={saved ? 'LEETCODE_SESSION (one is saved; a new one replaces it)' : 'LEETCODE_SESSION'}>
            <TextInput prompt="" mask placeholder="the value, or the whole cookie line" onSubmit={submit} />
          </Ask>
        ) : (
          <Text dimColor>Checking with LeetCode…</Text>
        )}
        {error && step === 'paste' && <Text color="red">{error}</Text>}
      </Box>
    </Box>
  );
}
