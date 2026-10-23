import chalk from 'chalk';
import { Box, Text } from 'ink';
import { humanDuration } from '../util.js';
import { Rule, ScrollBox } from './components.jsx';
import { textLines } from './markdown-lines.js';
import { tildePath } from './practice.js';

export const MESSAGE_STYLES = { error: chalk.red, success: chalk.green, you: chalk.dim, pending: chalk.dim, info: (s) => s };

export function Difficulty({ value }) {
  const color = { Easy: 'green', Medium: 'yellow', Hard: 'red' }[value];
  return <Text color={color}>{value}</Text>;
}

export function Home({ version, width, height, summary, continueItem, today, messages, workspace }) {
  const { weekMs, streakDays } = summary;
  const folderLines = workspace
    ? textLines(
        `Your solutions are saved in ${tildePath(workspace)}, with each problem's problem.md beside your code, so they're easy to push to GitHub. You can change the folder anytime with /setup.`,
        width - 4,
        chalk.dim,
      )
    : [];
  const stats = [
    streakDays > 0 ? `🔥 ${streakDays}-day streak` : null,
    weekMs >= 60_000 ? `${humanDuration(weekMs)} this week` : 'no practice yet this week',
  ].filter(Boolean);

  const messageLines = messages.length
    ? messages.flatMap((m, i) => [...(i ? [''] : []), ...textLines(m.text, width - 4, MESSAGE_STYLES[m.kind])])
    : textLines('Type /today for the daily problem, /open 1 for a specific one, or /help.', width - 4, chalk.dim);

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Box justifyContent="space-between" paddingX={1}>
        <Text>
          <Text bold>bokken</Text>
          <Text dimColor> v{version}</Text>
        </Text>
        <Text dimColor>{stats.join(' · ')}</Text>
      </Box>
      <Rule width={width} />
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        {continueItem && (
          <Row label="Continue">
            {continueItem.frontendId ? `${continueItem.frontendId}. ` : ''}
            {continueItem.title ?? continueItem.slug} <Difficulty value={continueItem.difficulty} />
            <Text dimColor>  {humanDuration(continueItem.activeMs)} so far</Text>
          </Row>
        )}
        <Row label="Today">
          {today.status === 'ready' ? (
            <>
              {today.daily.frontendId}. {today.daily.title} <Difficulty value={today.daily.difficulty} />
            </>
          ) : (
            <Text dimColor>{today.status === 'loading' ? 'loading…' : today.message}</Text>
          )}
        </Row>
        {folderLines.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            {folderLines.map((line, i) => (
              <Text key={i}>{line}</Text>
            ))}
          </Box>
        )}
      </Box>
      <Rule width={width} />
      <Box paddingX={2} paddingTop={1} flexGrow={1}>
        <ScrollBox lines={messageLines} height={Math.max(1, height - 9 - (folderLines.length ? folderLines.length + 1 : 0))} offset={null} />
      </Box>
    </Box>
  );
}

function Row({ label, children }) {
  return (
    <Box>
      <Box width={12} flexShrink={0}>
        <Text dimColor>{label}</Text>
      </Box>
      <Text wrap="truncate-end">{children}</Text>
    </Box>
  );
}
