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
 * bokken): one section at a time, full height, with tabs. `notifications` (results of /run
 * and /submit) adds a third column, or a third tab; there's none until you run something.
 */
export function problemLayout(columns, rows, { notifications = false } = {}) {
  const available = rows - APP_ROWS;
  if (columns >= WIDE_COLUMNS) {
    // Header, a rule, and each section's title.
    const height = Math.max(3, available - 3);
    if (notifications) {
      // The problem takes the left 40%; the coach and the notifications share the rest.
      const first = Math.floor(columns * 0.4);
      const second = first + Math.floor((columns - first) / 2);
      return {
        wide: true,
        dividers: [first, second],
        problem: { width: first - 2, height },
        coach: { width: second - first - 3, height },
        notifications: { width: columns - second - 3, height },
      };
    }
    // The problem takes the left 58%; a vertical line at the divider separates the coach.
    const left = Math.floor(columns * 0.58);
    return { wide: true, dividers: [left], problem: { width: left - 2, height }, coach: { width: columns - left - 3, height }, notifications: null };
  }
  // Title, timer, tabs and a rule.
  const height = Math.max(3, available - 4);
  const section = { width: columns - 2, height };
  return { wide: false, dividers: [], problem: section, coach: section, notifications: notifications ? section : null };
}

/** `unread` is `{ coach, notifications }`: a dot on a tab with something new you haven't seen. */
export function ProblemView({ practice, columns, layout, view, unread, problemLines, coachLines, notificationLines, offsets, getTimes }) {
  const { problem } = practice;
  const lines = { problem: problemLines, coach: coachLines, notifications: notificationLines };
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
        <Rule width={columns} junctions={layout.dividers.map((at) => ({ at, char: '┬' }))} />
        <Box flexDirection="row">
          <Box flexDirection="column" width={layout.problem.width + 2} paddingX={1}>
            <Rule width={layout.problem.width} title="Problem" focused={view === 'problem'} />
            <ScrollBox lines={lines.problem} height={layout.problem.height} offset={offsets.problem} />
          </Box>
          <Column title="Coach" section="coach" layout={layout} view={view} lines={lines} offsets={offsets} />
          {layout.notifications && <Column title="Notifications" section="notifications" layout={layout} view={view} lines={lines} offsets={offsets} />}
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
        {unread.coach && <Text color="yellow"> •</Text>}
        {layout.notifications && (
          <>
            <Text>   </Text>
            <Tab label="Notifications" active={view === 'notifications'} />
            {unread.notifications && <Text color="yellow"> •</Text>}
          </>
        )}
      </Box>
      <Rule width={columns} />
      <Box paddingX={1}>
        <ScrollBox lines={lines[view]} height={layout[view].height} offset={offsets[view]} />
      </Box>
    </Box>
  );
}

// A column to the right of the problem, with a line on its left.
function Column({ title, section, layout, view, lines, offsets }) {
  const { width, height } = layout[section];
  return (
    <Box flexDirection="column" width={width + 3} paddingX={1} borderStyle="single" borderTop={false} borderRight={false} borderBottom={false} borderDimColor>
      <Rule width={width} title={title} focused={view === section} />
      <ScrollBox lines={lines[section]} height={height} offset={offsets[section]} />
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
