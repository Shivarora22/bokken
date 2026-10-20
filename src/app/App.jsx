import { Box, Text, useApp, useInput, useWindowSize } from 'ink';
import { useEffect, useState } from 'react';
import { formatDuration } from '../format.js';
import { SPLIT_NAMES } from '../terminal/split.js';
import { watchSaves } from '../watch.js';

// Lines the screen uses besides the log, so the log gets whatever is left.
const FIXED_ROWS = 16;

/**
 * M1 spike screen: opens your editor in a split (or hands it the full screen), keeps a
 * live timer, and logs every save. M3 replaces it with the real app.
 *
 * @param {{ version: string, session: ReturnType<typeof import('../terminal/session.js').createEditorSession> }} props
 */
export function App({ version, session }) {
  const { suspendTerminal } = useApp();
  const { columns, rows } = useWindowSize();
  const [startedAt] = useState(Date.now);
  const [log, setLog] = useState([]);
  const [saves, setSaves] = useState(0);
  const [busy, setBusy] = useState(false);
  const [split, setSplit] = useState(session.split);
  // Windows Terminal we couldn't confirm: ask on the first ctrl+e.
  const [mightBeWt, setMightBeWt] = useState(session.mightBeWindowsTerminal);
  const [asking, setAsking] = useState(false);

  const addLog = (...lines) =>
    setLog((old) => [...old, ...lines.map((text) => ({ at: new Date(), text }))].slice(-100));

  useEffect(
    () =>
      watchSaves(session.file, () => {
        setSaves((count) => count + 1);
        addLog('Saved.');
      }),
    [session.file],
  );

  // Notice when the editor in a split quits. (A hand-off already knows.)
  useEffect(() => {
    let wasOpen = session.isOpen();
    const timer = setInterval(() => {
      const isOpen = session.isOpen();
      if (wasOpen && !isOpen) addLog(`${session.editor.name} closed.`);
      wasOpen = isOpen;
    }, 1000);
    return () => clearInterval(timer);
  }, [session]);

  const openEditor = (kind) => {
    setBusy(true);
    session
      .open({ suspendTerminal, elapsed: () => Date.now() - startedAt, split: kind })
      .then((lines) => addLog(...lines), (error) => addLog(`Error: ${error.message}`))
      .finally(() => setBusy(false));
  };

  // Reading keys also puts the terminal in raw mode, which is how Ink sees ctrl+c.
  useInput((input, key) => {
    if (asking) {
      if (input === 'y') {
        setAsking(false);
        setSplit('wt');
        openEditor('wt');
      } else if (input === 'n') {
        setAsking(false);
        setMightBeWt(false);
        openEditor(null);
      } else if (key.escape) {
        setAsking(false);
      }
      return;
    }
    if (!(key.ctrl && input === 'e') || busy) return;
    if (!split && mightBeWt && session.editor) setAsking(true);
    else openEditor(split);
  });

  const { editor } = session;
  return (
    <Box flexDirection="column" width={columns} height={rows}>
      <Box justifyContent="space-between" paddingX={1}>
        <Text bold>bokken</Text>
        <Text dimColor>v{version}</Text>
      </Box>
      <Rule />
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text bold>Spike: editor splits and hand-off</Text>
        <Box flexDirection="column" marginTop={1}>
          <Row label="Terminal">
            {split
              ? `${SPLIT_NAMES[split]}: the editor opens in a split`
              : mightBeWt
                ? "Maybe Windows Terminal (couldn't confirm): ctrl+e will ask"
                : 'No split available: the editor takes the full screen'}
          </Row>
          <Row label="Editor">{editor ? `${editor.name} (${editor.command})` : 'none found'}</Row>
          <Row label="File">{session.file}</Row>
          <Row label="Time">
            <Clock since={startedAt} />
          </Row>
          <Row label="Saves">{saves}</Row>
        </Box>
      </Box>
      <Box flexDirection="column" flexGrow={1} paddingX={2} overflow="hidden">
        <Text bold>Log</Text>
        {log.slice(-Math.max(1, (rows ?? 24) - FIXED_ROWS)).map((entry, index) => (
          <Text key={index} wrap="truncate-end">
            <Text dimColor>{entry.at.toTimeString().slice(0, 8)}</Text> {entry.text}
          </Text>
        ))}
      </Box>
      {asking ? (
        <Box paddingX={2}>
          <Text color="yellow">
            Is this window Windows Terminal? <Text bold>[y]</Text> open the editor in a split · <Text bold>[n]</Text> use the full screen
          </Text>
        </Box>
      ) : (
        <Text> </Text>
      )}
      <Rule />
      <Box paddingX={1}>
        <Text dimColor>ctrl+e editor · ctrl+c quit</Text>
      </Box>
    </Box>
  );
}

function Row({ label, children }) {
  return (
    <Box>
      <Box width={10} flexShrink={0}>
        <Text dimColor>{label}</Text>
      </Box>
      <Text wrap="truncate-middle">{children}</Text>
    </Box>
  );
}

// Its own component, so the once-a-second tick redraws only the timer.
function Clock({ since }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <Text>{formatDuration(now - since)}</Text>;
}

function Rule() {
  return <Box borderStyle="single" borderBottom={false} borderLeft={false} borderRight={false} borderDimColor />;
}
