import { Box, Text, useApp, useInput, useWindowSize } from 'ink';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PROVIDERS } from '../ai/providers.js';
import { htmlToMarkdown } from '../markdown.js';
import { attemptTimes, latestActiveAttempt, practiceSummary, recordEvent } from '../tracking.js';
import { humanDuration } from '../util.js';
import { AiSetup } from './AiSetup.jsx';
import { clampOffset, Rule, TextInput } from './components.jsx';
import { Home, MESSAGE_STYLES } from './Home.jsx';
import { markdownLines, textLines } from './markdown-lines.js';
import { tildePath, todaysProblem } from './practice.js';
import { ProblemView, problemLayout } from './ProblemView.jsx';
import { Setup } from './Setup.jsx';
import { useCoach } from './useCoach.js';
import { usePractice } from './usePractice.js';

const HELP = `Commands
  /today            today's problem
  /open <problem>   a problem by number, slug, title or link
  /hint             the next hint: LeetCode's first, then the AI's
  /done             mark it solved and stop the clock
  /new              start a fresh chat with the coach
  /ai               set up the AI coach (any provider)
  /home             back to the home screen
  /setup            change your language, editor or folder
  /quit             quit (or ctrl+c)
Type anything else to ask the coach.
Keys: ctrl+e opens your editor · tab switches between the problem and the coach · PgUp/PgDn scroll · Esc stops an answer · ↑↓ earlier commands`;

const COACH_EMPTY = 'Hints and answers show up here. Type /hint, or ask a question.';
const KEY_EVENT_EVERY_MS = 30_000;

/**
 * The whole app: setup, home and the problem screen, with the input line at the bottom.
 * `ctx` holds the database, LeetCode client, AI and terminal helpers (see open.jsx).
 * `size` fixes the screen size, for tests.
 */
export function App({ version, ctx, firstRun = false, start, size, showUsage = false }) {
  const { exit } = useApp();
  const windowSize = useWindowSize();
  const { columns, rows } = size ?? windowSize;

  const [config, setConfig] = useState(() => ctx.loadConfig());
  const [screen, setScreen] = useState(firstRun || start?.setup ? 'setup' : start?.aiSetup ? 'aiSetup' : 'home');
  const [history, setHistory] = useState([]);
  // Narrow panes show one section at a time; wide ones show both, and `view` is the one PgUp/PgDn scroll.
  const [view, setView] = useState('problem');
  // The coach's messages as you last saw them; anything newer puts a dot on its tab.
  const [seenCoach, setSeenCoach] = useState({ attemptId: null, coach: null });
  const [offsets, setOffsets] = useState({ problem: 0, coach: null });
  const [today, setToday] = useState({ status: 'loading' });
  const [homeVisits, setHomeVisits] = useState(0);
  const [credentialsVersion, setCredentialsVersion] = useState(0);
  // Quitting while the editor bokken opened is still open asks whether to close it too.
  const [quitting, setQuitting] = useState(false);
  const pendingStart = useRef(start?.daily || start?.ref ? start : null);
  const started = useRef(false);
  const returnTo = useRef('home');
  const lastKeyEvent = useRef(0);
  const idleMs = config.stats.idleMinutes * 60_000;

  const practice = usePractice({ ctx, config, setConfig, idleMs });
  const coach = useCoach({ ctx, config, credentialsVersion, practice, showUsage, idleMs });
  const current = practice.practice;
  // The solution question takes two lines instead of the input's one.
  const layout = problemLayout(columns, coach.confirming ? rows - 1 : rows);

  useEffect(() => {
    if (started.current || (screen !== 'home' && screen !== 'problem')) return;
    started.current = true;
    todaysProblem(ctx).then(
      (daily) => setToday({ status: 'ready', daily }),
      (error) => setToday({ status: 'error', message: error.message }),
    );
    if (pendingStart.current) {
      const target = pendingStart.current;
      pendingStart.current = null;
      openProblem(target);
    }
  }, [screen]);

  // A problem was opened: show it from the top. A layout effect, so it's done before the next
  // key is read; otherwise a quick tab could land first and be undone.
  useLayoutEffect(() => {
    if (!current?.attemptId) return;
    setScreen('problem');
    setView('problem');
    setOffsets({ problem: 0, coach: null });
    setSeenCoach({ attemptId: current.attemptId, coach: current.coach });
  }, [current?.attemptId]);

  // The coach section follows its newest message.
  useEffect(() => setOffsets((o) => ({ ...o, coach: null })), [current?.coach]);

  useEffect(() => {
    if (current && (layout.wide || view === 'coach')) setSeenCoach({ attemptId: current.attemptId, coach: current.coach });
  }, [current?.coach, view, layout.wide]);
  const unread =
    Boolean(current) && !layout.wide && view === 'problem' && seenCoach.attemptId === current.attemptId && current.coach !== seenCoach.coach;

  function openProblem(target) {
    coach.stop();
    return practice.open(target);
  }

  function leaveProblem() {
    coach.stop();
    practice.leave();
  }

  function goHome() {
    leaveProblem();
    setScreen('home');
    setHomeVisits((n) => n + 1);
  }

  function quit() {
    if (practice.practiceRef.current?.session.isOpen()) {
      setQuitting(true);
      if (screen !== 'home' && screen !== 'problem') setScreen('problem');
      return;
    }
    leaveProblem();
    exit();
  }

  function finishQuit(closeEditor) {
    if (closeEditor) practice.practiceRef.current?.session.close();
    leaveProblem();
    exit();
  }

  function runCommand(text) {
    const [rawName, ...args] = text.slice(1).trim().split(/\s+/);
    const name = rawName.toLowerCase();
    if (current && !current.done && !['hint', 'done', 'quit', 'home'].includes(name)) {
      recordEvent(ctx.db, current.attemptId, 'command', { idleMs, data: { name } });
    }
    switch (name) {
      case 'today':
        return openProblem({ daily: true });
      case 'open':
        return args.length ? openProblem({ ref: args.join(' ') }) : practice.say('Which problem? For example: /open 1, /open two-sum.');
      case 'hint':
        setView('coach');
        return coach.nextHint();
      case 'done':
        setView('coach');
        return practice.markDone();
      case 'new':
        setView('coach');
        return coach.newChat();
      case 'ai':
        returnTo.current = screen;
        return setScreen('aiSetup');
      case 'home':
        return goHome();
      case 'setup':
        leaveProblem();
        return setScreen('setup');
      case 'help':
        setView('coach');
        return practice.say(`${HELP}\nbokken v${version}`);
      case 'quit':
      case 'exit':
        return quit();
      default:
        return practice.say(`There's no /${rawName} command. Type /help to see them all.`, 'error');
    }
  }

  function submit(raw) {
    const text = raw.trim();
    if (!text) return;
    setHistory((h) => (h.at(-1) === text ? h : [...h, text].slice(-100)));
    if (practice.loading) return practice.say('Still working on the last command…');
    if (text.startsWith('/')) return runCommand(text);
    if (coach.busy) return practice.say('Still answering. Press Esc to stop it.');
    setView('coach');
    coach.ask(text);
  }

  function noteTyping() {
    const p = practice.practiceRef.current;
    if (!p || p.done || Date.now() - lastKeyEvent.current < KEY_EVENT_EVERY_MS) return;
    lastKeyEvent.current = Date.now();
    recordEvent(ctx.db, p.attemptId, 'key', { idleMs });
  }

  function scroll(section, direction) {
    const { height } = layout[section];
    const length = (section === 'problem' ? problemLines : coachLines).length;
    setOffsets((o) => {
      const next = clampOffset(clampOffset(o[section], length, height) + direction * Math.max(1, height - 2), length, height);
      const atEnd = next >= length - height;
      return { ...o, [section]: section === 'coach' && atEnd ? null : next };
    });
  }

  // ctrl+c works on every screen. Pressed again while bokken asks about the editor, it quits and leaves the editor open.
  useInput((input, key) => {
    if (!(key.ctrl && input === 'c')) return;
    if (quitting) finishQuit(false);
    else quit();
  });

  useInput(
    (input, key) => {
      if (quitting) {
        if (key.return || input === 'y' || input === 'Y') finishQuit(true);
        else if (input === 'n' || input === 'N') finishQuit(false);
        else if (key.escape) setQuitting(false);
        return;
      }
      if (practice.asking) {
        if (input === 'y' || input === 'Y') practice.answerWindowsTerminal(true);
        else if (input === 'n' || input === 'N') practice.answerWindowsTerminal(false);
        else if (key.escape) practice.cancelAsking();
        return;
      }
      if (coach.confirming) {
        const letter = input.toLowerCase();
        if (letter === 'h') coach.chooseSolution('hint');
        else if (letter === 's') coach.chooseSolution('solution');
        else if (letter === 'c' || key.escape) coach.chooseSolution('cancel');
        return;
      }
      if (key.escape && coach.busy) {
        coach.stop();
      } else if (key.ctrl && input === 'e') {
        practice.openEditor();
      } else if (screen === 'problem' && key.tab) {
        setView((v) => (v === 'problem' ? 'coach' : 'problem'));
      } else if (screen === 'problem' && (key.pageUp || key.pageDown)) {
        scroll(view, key.pageUp ? -1 : 1);
      }
    },
    { isActive: screen === 'home' || screen === 'problem' },
  );

  const problemLines = useMemo(
    () => (current ? markdownLines(htmlToMarkdown(current.problem.content), layout.problem.width) : []),
    [current?.problem, layout.problem.width],
  );
  const coachLines = useMemo(() => {
    if (!current) return [];
    if (!current.coach.length) return textLines(COACH_EMPTY, layout.coach.width, MESSAGE_STYLES.pending);
    return renderMessages(current.coach, layout.coach.width);
  }, [current?.coach, layout.coach.width]);
  const home = useMemo(() => {
    if (screen === 'setup' || current) return null;
    const latest = latestActiveAttempt(ctx.db);
    return {
      summary: practiceSummary(ctx.db, { idleMs }),
      continueItem: latest && {
        frontendId: latest.frontend_id,
        title: latest.title,
        slug: latest.slug,
        difficulty: latest.difficulty,
        activeMs: attemptTimes(ctx.db, latest.id, { idleMs }).activeMs,
      },
    };
  }, [screen, homeVisits, current === null]);

  if (screen === 'setup') {
    return (
      <Box flexDirection="column" width={columns} height={rows}>
        <Setup
          ctx={ctx}
          config={config}
          firstRun={firstRun}
          onDone={(next, { setupAi }) => {
            setConfig(next);
            setHomeVisits((n) => n + 1);
            practice.say(`Setup saved. Solutions go in ${tildePath(next.workspace)}. Type /today to start.`, 'success');
            returnTo.current = 'home';
            setScreen(setupAi ? 'aiSetup' : 'home');
          }}
        />
      </Box>
    );
  }

  if (screen === 'aiSetup') {
    return (
      <Box flexDirection="column" width={columns} height={rows}>
        <AiSetup
          ctx={ctx}
          config={config}
          onCancel={() => setScreen(returnTo.current)}
          onDone={(next) => {
            setConfig(next);
            setCredentialsVersion((v) => v + 1);
            setScreen(returnTo.current);
            practice.say(`✓ AI ready: ${PROVIDERS[next.ai.provider].name}, ${next.ai.model}. Ask anything, or /hint.`, 'success');
          }}
        />
      </Box>
    );
  }

  const inProblem = Boolean(current);
  let footer = '/today · /open 1 · /ai · /setup · /help · ctrl+c quit';
  if (coach.busy) footer = 'Esc stops the answer';
  else if (inProblem && layout.wide) footer = 'ctrl+e editor · tab scroll · /hint · /done · /help';
  else if (inProblem) footer = `tab ${view === 'problem' ? 'coach' : 'problem'} · ctrl+e editor · /hint · /done`;

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {inProblem ? (
          <ProblemView
            practice={current}
            columns={columns}
            layout={layout}
            view={view}
            unread={unread}
            problemLines={problemLines}
            coachLines={coachLines}
            offsets={offsets}
            getTimes={(now) => attemptTimes(ctx.db, current.attemptId, { now: new Date(now), idleMs })}
          />
        ) : (
          <Home version={version} width={columns} height={rows - 3} {...home} today={today} messages={practice.messages} />
        )}
      </Box>
      <Rule width={columns} junction={inProblem && layout.wide ? { at: layout.dividerAt, char: '┴' } : undefined} />
      <Box paddingX={1} flexShrink={0}>
        {quitting && current ? (
          <Text color="yellow">
            Close {current.session.editor.name} too? <Text bold>[Y/n]</Text> · Esc to stay in bokken
          </Text>
        ) : practice.asking ? (
          <Text color="yellow">
            Is this window Windows Terminal? <Text bold>[y]</Text> open the editor in a split · <Text bold>[n]</Text> use the full screen
          </Text>
        ) : coach.confirming && current ? (
          <SolutionChoice practice={current} idleMs={idleMs} db={ctx.db} />
        ) : (
          <TextInput
            history={history}
            onSubmit={submit}
            onType={noteTyping}
            placeholder={inProblem ? 'ask anything, or /hint' : 'type a command, like /today or /open 1'}
          />
        )}
      </Box>
      <Box paddingX={1} flexShrink={0}>
        <Text dimColor wrap="truncate-end">
          {practice.loading ? `… ${practice.loading}` : footer}
        </Text>
      </Box>
    </Box>
  );
}

function SolutionChoice({ practice, idleMs, db }) {
  const spent = humanDuration(attemptTimes(db, practice.attemptId, { idleMs }).activeMs);
  const used = practice.hintsShown + practice.aiHints.length;
  return (
    <Box flexDirection="column">
      <Text color="yellow">
        You've spent {spent} on this and used {used} hint{used === 1 ? '' : 's'}.
      </Text>
      <Text color="yellow">
        <Text bold>[h]</Text> one more hint · <Text bold>[s]</Text> show the solutions · <Text bold>[c]</Text> cancel
      </Text>
    </Box>
  );
}

function renderMessages(messages, width) {
  const lines = [];
  for (const message of messages) {
    if (lines.length) lines.push('');
    if (message.kind === 'hint' || message.kind === 'ai') lines.push(...markdownLines(message.text, width));
    else lines.push(...textLines(message.kind === 'you' ? `> ${message.text}` : message.text, width, MESSAGE_STYLES[message.kind]));
  }
  return lines;
}
