import { Box, Text } from 'ink';
import { useEffect, useState } from 'react';
import { formatDuration } from '../util.js';
import { Rule, ScrollBox } from './components.jsx';
import { Difficulty } from './Home.jsx';

// Rows outside the two sections: the input line, its rule and the footer (drawn by App),
// plus the title, the timer and a rule here.
const CHROME_ROWS = 6;
export const WIDE_COLUMNS = 100;

/** Problem and coach side by side when there's room, stacked in a narrow split pane. */
export function problemLayout(columns, rows) {
  const body = Math.max(6, rows - CHROME_ROWS);
  if (columns >= WIDE_COLUMNS) {
    const left = Math.floor(columns * 0.58);
    return {
      wide: true,
      problem: { width: left - 2, height: body - 1 },
      coach: { width: columns - left - 2, height: body - 1 },
    };
  }
  const problemHeight = Math.max(2, Math.floor(body * 0.6) - 1);
  return {
    wide: false,
    problem: { width: columns - 2, height: problemHeight },
    coach: { width: columns - 2, height: Math.max(2, body - problemHeight - 2) },
  };
}

export function ProblemView({ practice, columns, layout, focus, problemLines, coachLines, offsets, getTimes }) {
  const { problem } = practice;
  const sections = [
    { key: 'problem', title: 'Problem', lines: problemLines },
    { key: 'coach', title: 'Coach', lines: coachLines },
  ];

  return (
    <Box flexDirection="column" width={columns}>
      <Box paddingX={1}>
        <Text wrap="truncate-end">
          <Text bold>
            {problem.frontendId}. {problem.title}
          </Text>
          {' · '}
          <Difficulty value={problem.difficulty} />
          <Text dimColor> · {problem.topics.map((t) => t.name).join(', ')}</Text>
        </Text>
      </Box>
      <Box paddingX={1}>
        <TimerLine
          getTimes={getTimes}
          done={practice.done}
          hintsShown={practice.hintsShown}
          hintsTotal={problem.hints.length}
          lastSaveAt={practice.lastSaveAt}
        />
      </Box>
      <Rule width={columns} />
      <Box flexDirection={layout.wide ? 'row' : 'column'}>
        {sections.map(({ key, title, lines }) => (
          <Box key={key} flexDirection="column" width={layout[key].width + 2} paddingX={1}>
            <Rule width={layout[key].width} title={title} focused={focus === key} />
            <ScrollBox lines={lines} height={layout[key].height} offset={offsets[key]} />
          </Box>
        ))}
      </Box>
    </Box>
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
