import chalk from 'chalk';
import { Box, Text } from 'ink';
import { humanDuration } from '../util.js';
import { Rule, ScrollBox } from './components.jsx';
import { textLines } from './markdown-lines.js';
import { tildePath } from './practice.js';

export const MESSAGE_STYLES = { error: chalk.red, success: chalk.green, you: chalk.dim, pending: chalk.dim, info: (s) => s };

// The name in a block font, lit like a fire: red at the top to amber at the bottom, with the
// box-drawing edges as its shadow, in a darker ember.
const WORDMARK = [
  '██████╗  ██████╗ ██╗  ██╗██╗  ██╗███████╗███╗   ██╗',
  '██╔══██╗██╔═══██╗██║ ██╔╝██║ ██╔╝██╔════╝████╗  ██║',
  '██████╔╝██║   ██║█████╔╝ █████╔╝ █████╗  ██╔██╗ ██║',
  '██╔══██╗██║   ██║██╔═██╗ ██╔═██╗ ██╔══╝  ██║╚██╗██║',
  '██████╔╝╚██████╔╝██║  ██╗██║  ██╗███████╗██║ ╚████║',
  '╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═══╝',
];
const FIRE = ['#ff3d1f', '#ff5a1a', '#ff7614', '#ff920f', '#ffad0a', '#ffc505'];
const EMBER = chalk.hex('#8c2a0c');
const LIT_WORDMARK = WORDMARK.map((line, row) => line.replace(/█+|[^█ ]+/g, (run) => (run[0] === '█' ? chalk.hex(FIRE[row])(run) : EMBER(run))));
const WORDMARK_WIDTH = WORDMARK[0].length;
// The wordmark and the gap above it.
const WORDMARK_ROWS = WORDMARK.length + 1;
// The quick start's commands, indented, and the space after them.
const COMMAND_WIDTH = 18;

export function Difficulty({ value }) {
  const color = { Easy: 'green', Medium: 'yellow', Hard: 'red' }[value];
  return <Text color={color}>{value}</Text>;
}

/**
 * `loggedIn` and `aiReady` leave out the quick start's notes about /login and /ai.
 * `suggested` is what /next would pick from what bokken has; `weakest`, your weakest topics.
 */
export function Home({ version, width, height, summary, continueItem, suggested, weakest = [], today, messages, workspace, loggedIn, aiReady }) {
  const { weekMs, streakDays } = summary;
  const stats = [
    streakDays > 0 ? `🔥 ${streakDays}-day streak` : null,
    weekMs >= 60_000 ? `${humanDuration(weekMs)} this week` : 'no practice yet this week',
  ].filter(Boolean);

  const quickStart = quickStartLines({ width: width - 4, workspace, loggedIn, aiReady });
  const messageLines = messages.flatMap((m, i) => [...(i ? [''] : []), ...textLines(m.text, width - 4, MESSAGE_STYLES[m.kind])]);
  // The bottom section gets what the header, the rules, the rows (Continue, Today, …) and the
  // gaps leave. Messages come before the quick start, and the quick start before the wordmark:
  // when they don't all fit, the wordmark goes first, then the quick start.
  const rows = 1 + [continueItem, suggested, weakest.length].filter(Boolean).length;
  const room = height - 6 - rows;
  const all = messageLines.length ? [...quickStart, '', ...messageLines] : quickStart;
  const wordmark = width >= WORDMARK_WIDTH + 4 && all.length <= room - WORDMARK_ROWS;
  const lines = all.length <= room || !messageLines.length ? all : messageLines;

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
      {wordmark && (
        <Box flexDirection="column" alignItems="center" marginTop={1}>
          {LIT_WORDMARK.map((line, i) => (
            <Text key={i}>{line}</Text>
          ))}
        </Box>
      )}
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
        {suggested && (
          <Row label="Suggested">
            {suggested.frontendId}. {suggested.title} <Difficulty value={suggested.difficulty} />
            <Text dimColor>  {suggested.topic} · /next says why</Text>
          </Row>
        )}
        {weakest.length > 0 && (
          <Row label="Weakest">
            <Text dimColor>{weakest.map((topic) => `${topic.name}${topic.medianSec ? ` ${humanDuration(topic.medianSec * 1000)}` : ''}`).join(' · ')}</Text>
          </Row>
        )}
      </Box>
      <Rule width={width} />
      <Box paddingX={2} paddingTop={1} flexGrow={1}>
        <ScrollBox lines={lines} height={Math.max(1, room - (wordmark ? WORDMARK_ROWS : 0))} offset={messageLines.length ? null : 0} />
      </Box>
    </Box>
  );
}

function quickStartLines({ width, workspace, loggedIn, aiReady }) {
  const step = (command, text, note) => {
    const [first, ...rest] = textLines(note ? `${text}${chalk.dim(note)}` : text, width - COMMAND_WIDTH);
    const indent = ' '.repeat(COMMAND_WIDTH);
    return [`  ${chalk.cyan(command.padEnd(COMMAND_WIDTH - 2))}${first}`, ...rest.map((line) => indent + line)];
  };
  return [
    chalk.dim('Quick start'),
    ...step('/today', "today's problem, opened in your editor", ' · /open 1 for any other'),
    ...step('/run · /submit', 'check your code on LeetCode', loggedIn ? null : '  (/login first)'),
    ...step('/hint', 'stuck? get a nudge', aiReady ? null : '  (/ai adds the AI coach)'),
    ...step('/next · /stats', 'what to practice next, and how it’s going'),
    ...step('/help', 'every command and key'),
    ...(workspace
      ? ['', ...textLines(`Your solutions are saved in ${tildePath(workspace)}, ready to push to GitHub. /setup changes the folder.`, width, chalk.dim)]
      : []),
  ];
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
