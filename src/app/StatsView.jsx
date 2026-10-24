import { Box, Text } from 'ink';
import { VIEWS } from '../stats.js';
import { Rule, ScrollBox } from './components.jsx';

const NAMES = { overview: 'Overview', topics: 'Topics', difficulty: 'Difficulty', trend: 'Trend' };

/** `/stats`: the views as tabs (tab switches), and the one on screen. A problem's attempts get a tab of their own. */
export function StatsView({ width, height, view, lines, offset }) {
  const tabs = [...VIEWS, ...(VIEWS.includes(view) ? [] : [view])];
  return (
    <Box flexDirection="column" width={width} height={height}>
      <Box paddingX={1}>
        <Text wrap="truncate-end">
          <Text bold>Stats</Text>
          {tabs.map((tab) => (
            <Text key={tab} bold={tab === view} color={tab === view ? 'cyan' : undefined} dimColor={tab !== view}>
              {'   '}
              {NAMES[tab] ?? 'Problem'}
            </Text>
          ))}
        </Text>
      </Box>
      <Rule width={width} />
      <Box paddingX={1} paddingTop={1}>
        <ScrollBox lines={lines} height={Math.max(1, height - 3)} offset={offset} />
      </Box>
    </Box>
  );
}
