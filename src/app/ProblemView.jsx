import { Box, Text } from 'ink';
import { useEffect, useState } from 'react';
import { formatDuration } from '../util.js';
import { Rule, ScrollBox } from './components.jsx';
import { Difficulty } from './Home.jsx';

// App draws three rows under this view: the input line, its rule and the footer.
const APP_ROWS = 3;
export const WIDE_COLUMNS = 100;

/**
 * Wide: the problem on the left, the coach on the right. Narrow (an editor split beside
 * bokken): one of them at a time, full height, with tabs.
 */
export function problemLayout(columns, rows) {
  const available = rows - APP_ROWS;
  if (columns >= WIDE_COLUMNS) {
    // The problem takes the left 58%; a vertical line at `dividerAt` separates the coach.
    const left = Math.floor(columns * 0.58);
    // Header, a rule, and each section's title.
    const height = Math.max(3, available - 3);
    return { wide: true, dividerAt: left, problem: { width: left - 2, height }, coach: { width: columns - left - 3, height } };
  }
  // Title, timer, tabs and a rule.
  const height = Math.max(3, available - 4);
  return { wide: false, problem: { width: columns - 2, height }, coach: { width: columns - 2, height } };
}

export function ProblemView({ practice, columns, layout, view, unread, problemLines, coachLines, offsets, getTimes }) {
  const { problem } = practice;
  const lines = { problem: problemLines, coach: coachLines };
  const title = (
    <Text wrap="truncate-end">
      <Text bold>
        {problem.frontendId}. {problem.title}
      </Text>
      {' · '}
      <Difficulty value={problem.difficulty} />
      <Text dimColor> · {problem.topics.map((t) => t.name).join(', ')}</Text>
    </Text>
  );
  const timer = (
    <TimerLine getTimes={getTimes} done={practice.done} hintsShown={practice.hintsShown} hintsTotal={problem.hints.length} lastSaveAt={practice.lastSaveAt} />
  );

  if (layout.wide) {
    return (
      <Box flexDirection="column" width={columns}>
        <Box paddingX={1}>
          <Box flexGrow={1} flexShrink={1}>
            {title}
          </Box>
          <Box flexShrink={0} marginLeft={2}>
            {timer}
          </Box>
        </Box>
        <Rule width={columns} junction={{ at: layout.dividerAt, char: '┬' }} />
        <Box flexDirection="row">
          <Box flexDirection="column" width={layout.problem.width + 2} paddingX={1}>
            <Rule width={layout.problem.width} title="Problem" focused={view === 'problem'} />
            <ScrollBox lines={lines.problem} height={layout.problem.height} offset={offsets.problem} />
          </Box>
          <Box
            flexDirection="column"
            width={layout.coach.width + 3}
            paddingX={1}
            borderStyle="single"
            borderTop={false}
            borderRight={false}
            borderBottom={false}
            borderDimColor
          >
            <Rule width={layout.coach.width} title="Coach" focused={view === 'coach'} />
            <ScrollBox lines={lines.coach} height={layout.coach.height} offset={offsets.coach} />
          </Box>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={columns}>
      <Box paddingX={1}>{title}</Box>
      <Box paddingX={1}>{timer}</Box>
      <Box paddingX={1}>
        <Tab label="Problem" active={view === 'problem'} />
        <Text>   </Text>
        <Tab label="Coach" active={view === 'coach'} />
        {unread && <Text color="yellow"> •</Text>}
      </Box>
      <Rule width={columns} />
      <Box paddingX={1}>
        <ScrollBox lines={lines[view]} height={layout[view].height} offset={offsets[view]} />
      </Box>
    </Box>
  );
}

function Tab({ label, active }) {
  return active ? (
    <Text bold underline color="cyan">
      {label}
    </Text>
  ) : (
    <Text dimColor>{label}</Text>
  );
}

// Its own component, so the once-a-second tick redraws only this line.
function TimerLine({ getTimes, done, hintsShown, hintsTotal, lastSaveAt }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (done) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [done]);

  const { activeMs, idle } = getTimes(now);
  const clock = done
    ? `✓ solved · ${formatDuration(activeMs)} active`
    : idle
      ? `⏸ ${formatDuration(activeMs)} paused (idle)`
      : `⏱ ${formatDuration(activeMs)} active`;
  const details = [`hints ${hintsShown}/${hintsTotal}`, lastSaveAt && `saved ${lastSaveAt.toTimeString().slice(0, 5)}`].filter(Boolean);
  return (
    <Text>
      <Text color={done ? 'green' : idle ? 'yellow' : undefined}>{clock}</Text>
      <Text dimColor> · {details.join(' · ')}</Text>
    </Text>
  );
}
