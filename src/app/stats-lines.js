import chalk from 'chalk';
import stringWidth from 'string-width';
import { DIFFICULTIES, MIN_SOLVES } from '../stats.js';
import { humanDuration } from '../util.js';
import { textLines } from './markdown-lines.js';

// A /stats view (from statsView) → styled terminal lines, for the Stats screen and for
// `bokken stats`. Plain JS, so the plain command doesn't load Ink.

const DIFFICULTY_COLORS = { Easy: chalk.green, Medium: chalk.yellow, Hard: chalk.red };
const BLOCKS = '▁▂▃▄▅▆▇█';
const NONE = '·';
const DASH = '—';

export function statsLines(data, width) {
  width = Math.max(30, width);
  if (data.view === 'overview') return overviewLines(data, width);
  if (data.view === 'topics') return tableView(data.topics, width, 'Topic');
  if (data.view === 'difficulty') return tableView(data.difficulties, width, 'Difficulty');
  if (data.view === 'trend') return trendLines(data.weeks, width);
  return problemLines(data, width);
}

function overviewLines(o, width) {
  if (!o.attempts.solved && !o.attempts.gaveUp && !o.attempts.active) {
    return textLines('No practice yet. /next picks a problem to start with, or /today for the daily one.', width, chalk.dim);
  }
  const split = (counts) => DIFFICULTIES.filter((d) => counts[d]).map((d) => `${counts[d]} ${d}`).join(' · ');
  const solved = (counts) => `${counts.total} ${plural(counts.total, 'problem')}${counts.total ? ` (${split(counts)})` : ''}`;
  const attempts = [`${o.attempts.solved} solved`, o.attempts.gaveUp && `${o.attempts.gaveUp} gave up`, o.attempts.active && `${o.attempts.active} in progress`];
  const change = o.weekSec - o.lastWeekSec;
  const rows = [
    ['Solved', solved(o.solved)],
    o.leetcode && ['On LeetCode', solved(o.leetcode)],
    ['Attempts', attempts.filter(Boolean).join(' · ')],
    ['Practice', `${duration(o.activeSec)} over ${o.activeDays} ${plural(o.activeDays, 'day')}`],
    ['Streak', o.streakDays ? `🔥 ${o.streakDays} ${plural(o.streakDays, 'day')}` : 'none right now'],
    ['This week', `${duration(o.weekSec)} ${chalk.dim(`(last week ${duration(o.lastWeekSec)}, ${change >= 0 ? '+' : '−'}${duration(Math.abs(change))})`)}`],
  ];
  return [...rows.filter(Boolean).map(([label, value]) => `${chalk.dim(label.padEnd(13))}${value}`), '', ...viewHint(width)];
}

/** Topics or difficulties: one row each, with the same columns. */
function tableView(rows, width, first) {
  const shown = rows.filter((row) => row.attempts);
  if (!shown.length) return textLines('Nothing finished yet. Solve a few problems and the numbers show up here.', width, chalk.dim);
  const label = (row) => (row.difficulty ? DIFFICULTY_COLORS[row.difficulty](row.difficulty) : row.name);
  // `drop` is the order columns go in when the pane is too narrow for all of them.
  const columns = [
    { title: 'Solved', cell: (row) => String(row.problems) },
    { title: 'Median', cell: (row) => (row.medianSec === null ? DASH : duration(row.medianSec)) },
    { title: 'First try', cell: (row) => percent(row.firstTryRate), drop: 2 },
    { title: 'Subs', cell: (row) => (row.submissionsToAccepted === null ? DASH : row.submissionsToAccepted.toFixed(1)), drop: 1 },
    { title: 'Help', cell: (row) => `${row.helped}/${row.attempts}` },
  ];
  const lines = table(shown, label, first, columns, width);
  if (first === 'Topic') {
    const ranked = shown.filter((row) => row.score !== null).length;
    // The header, then the ranked rows, then a note above the rest.
    if (ranked < shown.length) lines.splice(1 + ranked, 0, chalk.dim(`Not enough data yet (fewer than ${MIN_SOLVES} solves):`));
    lines.unshift(chalk.dim(ranked ? 'Weakest first.' : `Topics are ranked once they have ${MIN_SOLVES} solves.`), '');
  }
  return [...lines, '', ...textLines('Help: attempts where you used hints, the solution, or gave up. Subs: submissions per Accepted.', width, chalk.dim)];
}

function trendLines(weeks, width) {
  const current = weeks.at(-1);
  const lines = [
    chalk.bold(`Practice time, last ${weeks.length} weeks`),
    `  ${sparkline(weeks.map((w) => w.activeSec))}  ${duration(current.activeSec)} this week`,
    '',
    chalk.bold('Median solve time'),
  ];
  for (const difficulty of DIFFICULTIES) {
    const values = weeks.map((w) => w.medianSec[difficulty]);
    const known = values.filter((v) => v !== null);
    const summary = known.length ? `${duration(known.at(-1))} latest${known.length > 1 ? chalk.dim(` (${duration(Math.min(...known))}–${duration(Math.max(...known))})`) : ''}` : chalk.dim('none solved');
    lines.push(`  ${pad(DIFFICULTY_COLORS[difficulty](difficulty), 8)}${sparkline(values)}  ${summary}`);
  }
  lines.push('');
  const columns = [
    { title: 'Time', cell: (w) => (w.activeSec ? duration(w.activeSec) : DASH) },
    { title: 'Solved', cell: (w) => String(w.solved) },
    ...DIFFICULTIES.map((d) => ({ title: d, cell: (w) => (w.medianSec[d] === null ? DASH : duration(w.medianSec[d])) })),
  ];
  const label = (w) => `Week of ${w.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  return [...lines, ...table(weeks, label, 'Week', columns, width)];
}

function problemLines(p, width) {
  if (p.error) return textLines(p.error, width, chalk.dim);
  const title = `${p.frontendId ? `${p.frontendId}. ` : ''}${p.title}${p.difficulty ? ` · ${DIFFICULTY_COLORS[p.difficulty]?.(p.difficulty) ?? p.difficulty}` : ''}`;
  const outcome = { solved: 'solved', abandoned: 'gave up', active: 'in progress' };
  const columns = [
    { title: 'Result', cell: (a) => outcome[a.outcome] ?? a.outcome },
    { title: 'Time', cell: (a) => duration(a.activeSec) },
    { title: 'Runs', cell: (a) => String(a.runs) },
    { title: 'Subs', cell: (a) => (a.submissions ? `${a.submissions - a.wrongSubmissions}/${a.submissions}` : DASH) },
    { title: 'Help', cell: (a) => help(a) },
  ];
  const label = (a) => new Date(a.startedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const lines = [chalk.bold(title), '', ...table(p.attempts, label, 'Started', columns, width)];
  const solved = p.attempts.filter((a) => a.outcome === 'solved');
  if (solved.length >= 2) {
    const [before, last] = solved.slice(-2);
    const verdict = last.activeSec < before.activeSec ? 'Faster' : last.activeSec > before.activeSec ? 'Slower' : 'Same time';
    lines.push('', `${verdict} than last time: ${duration(last.activeSec)}, against ${duration(before.activeSec)} before.`);
  }
  return lines;
}

function help(a) {
  if (a.outcome === 'abandoned') return 'gave up';
  if (a.viewedSolution) return 'solution';
  if (a.aiLevel) return `AI level ${a.aiLevel}`;
  if (a.hintsSeen) return `${a.hintsSeen} ${plural(a.hintsSeen, 'hint')}`;
  return DASH;
}

/**
 * A table: the first column takes what the others leave, cut short if it has to. Each other
 * column is as wide as its widest cell, right-aligned. When even a short first column won't
 * fit, columns with a `drop` order go, lowest first.
 */
function table(rows, label, first, columns, width) {
  const MIN_FIRST = 12;
  const widthOf = (column) => Math.max(stringWidth(column.title), ...rows.map((row) => stringWidth(column.cell(row))));
  let kept = columns;
  const rest = () => kept.reduce((total, column) => total + widthOf(column) + 2, 0);
  for (const column of columns.filter((c) => c.drop).sort((a, b) => a.drop - b.drop)) {
    if (MIN_FIRST + rest() <= width) break;
    kept = kept.filter((c) => c !== column);
  }
  const widths = kept.map(widthOf);
  const firstWidth = Math.max(MIN_FIRST, Math.min(width - rest(), Math.max(stringWidth(first), ...rows.map((row) => stringWidth(label(row))))));
  const line = (head, values) => pad(head, firstWidth) + values.map((value, i) => `  ${pad(value, widths[i], 'right')}`).join('');
  return [chalk.dim(line(first, kept.map((c) => c.title))), ...rows.map((row) => line(label(row), kept.map((c) => c.cell(row))))];
}

/** Weeks as blocks, scaled to the largest; `·` for none. The latest stands out, the rest are dimmed. */
function sparkline(values) {
  const max = Math.max(0, ...values.filter((v) => v !== null));
  return values
    .map((value, i) => {
      const mark = !value || !max ? NONE : BLOCKS[Math.max(0, Math.ceil((value / max) * BLOCKS.length) - 1)];
      return i === values.length - 1 ? chalk.bold(mark) : chalk.dim(mark);
    })
    .join('');
}

function viewHint(width) {
  return textLines('/stats topics · /stats difficulty · /stats trend · /stats <problem> · tab for the next view', width, chalk.dim);
}

function pad(text, width, align = 'left') {
  const visible = stringWidth(text);
  if (visible > width) return cut(text, width);
  const space = ' '.repeat(width - visible);
  return align === 'right' ? space + text : text + space;
}

// Plain labels only (topic names, dates): they carry no color codes to cut through.
function cut(text, width) {
  let out = '';
  for (const char of text) {
    if (stringWidth(out + char) > width - 1) break;
    out += char;
  }
  return `${out}…`;
}

/** Short durations for tables: "8 min", "1h 05m", and "<1 min" rather than "under a minute". */
function duration(sec) {
  if (!sec) return '0 min';
  return sec < 60 ? '<1 min' : humanDuration(sec * 1000);
}

function percent(rate) {
  return rate === null ? DASH : `${Math.round(rate * 100)}%`;
}

function plural(n, word) {
  return n === 1 ? word : `${word}s`;
}
