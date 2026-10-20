import { Box, Text, useInput, useWindowSize } from 'ink';

/** Placeholder home screen, until M3 builds the real one. */
export function App({ version }) {
  // Reading keys puts the terminal in raw mode, which is how Ink sees ctrl+c.
  useInput(() => {});
  const { columns, rows } = useWindowSize();

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      <Box justifyContent="space-between" paddingX={1}>
        <Text bold>bokken</Text>
        <Text dimColor>v{version}</Text>
      </Box>
      <Rule />
      <Box flexGrow={1} flexDirection="column" paddingX={2} paddingY={1}>
        <Text>Practice coding problems in your terminal.</Text>
        <Text dimColor>This is a placeholder. The practice app is on its way.</Text>
      </Box>
      <Rule />
      <Box paddingX={1}>
        <Text dimColor>ctrl+c to quit</Text>
      </Box>
    </Box>
  );
}

function Rule() {
  return <Box borderStyle="single" borderBottom={false} borderLeft={false} borderRight={false} borderDimColor />;
}
