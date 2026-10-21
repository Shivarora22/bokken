import { Box, Text, useApp, useInput, useWindowSize } from 'ink';
import { useEffect, useMemo, useRef, useState } from 'react';
import { humanDuration } from '../format.js';
import { htmlToMarkdown } from '../markdown.js';
import { attemptTimes, finishAttempt, latestActiveAttempt, practiceSummary, recordEvent, recordHint } from '../tracking.js';
import { watchSaves } from '../watch.js';
import { clampOffset, Rule, TextInput } from './components.jsx';
import { Home, MESSAGE_STYLES } from './Home.jsx';
import { markdownLines, textLines } from './markdown-lines.js';
import { loadPractice, tildePath, todaysProblem } from './practice.js';
import { ProblemView, problemLayout } from './ProblemView.jsx';
import { Setup } from './Setup.jsx';

const HELP = `Commands
  /today            today's problem
  /open <problem>   a problem by number, slug, title or link
  /hint             the next official hint
  /done             mark it solved and stop the clock
  /home             back to the home screen
  /setup            change your language, editor or folder
  /quit             quit (or ctrl+c)
Keys: ctrl+e opens your editor · tab switches which section scrolls · PgUp/PgDn scroll · ↑↓ earlier commands`;

const NO_AI = "The AI coach comes in a later version. For now, /hint shows LeetCode's official hints.";
const NEED_PROBLEM = 'Open a problem first: /today, or /open 1.';
const KEY_EVENT_EVERY_MS = 30_000;

/**
 * The whole app: setup, home and the problem screen, with the input line at the bottom.
 * `ctx` holds the database, LeetCode client and terminal helpers (see open.jsx).
 * `size` fixes the screen size, for tests.
 */
export function App({ version, ctx, firstRun = false, start, size }) {
  const { exit, suspendTerminal } = useApp();
  const windowSize = useWindowSize();
  const { columns, rows } = size ?? windowSize;

  const [config, setConfig] = useState(() => ctx.loadConfig());
  const [screen, setScreen] = useState(firstRun || start?.setup ? 'setup' : 'home');
  const [messages, setMessages] = useState([]);
  const [practice, setPractice] = useState(null);
  const [busy, setBusy] = useState(null);
  const [asking, setAsking] = useState(false);
  const [history, setHistory] = useState([]);
  const [focus, setFocus] = useState('problem');
  const [offsets, setOffsets] = useState({ problem: 0, coach: null });
  const [today, setToday] = useState({ status: 'loading' });
  const [homeVisits, setHomeVisits] = useState(0);

  const practiceRef = useRef(null);
  practiceRef.current = practice;
  const pendingStart = useRef(start?.setup ? null : start);
  const lastKeyEvent = useRef(0);
  const idleMs = config.stats.idleMinutes * 60_000;
  const layout = problemLayout(columns, rows);

  // --- Effects -------------------------------------------------------------

  const leftSetup = screen !== 'setup';
  useEffect(() => {
    if (!leftSetup) return undefined;
    let cancelled = false;
    todaysProblem(ctx).then(
      (daily) => !cancelled && setToday({ status: 'ready', daily }),
      (error) => !cancelled && setToday({ status: 'error', message: error.message }),
    );
    if (pendingStart.current) {
      const target = pendingStart.current;
      pendingStart.current = null;
      openProblem(target);
    }
    return () => {
      cancelled = true;
    };
  }, [leftSetup]);

  useEffect(() => {
    if (!practice?.file) return undefined;
    return watchSaves(practice.file, () => {
      const current = practiceRef.current;
      if (!current || current.done) return;
      recordEvent(ctx.db, current.attemptId, 'save', { idleMs });
      setPractice((p) => p && { ...p, lastSaveAt: new Date() });
    });
  }, [practice?.file]);

  // Notice when the editor in a split quits. (A full-screen hand-off already knows.)
  useEffect(() => {
    const session = practice?.session;
    if (!practice?.split || !session?.editor) return undefined;
    let wasOpen = session.isOpen();
    const timer = setInterval(() => {
      const isOpen = session.isOpen();
      if (wasOpen && !isOpen) say(`${session.editor.name} closed. ctrl+e opens it again.`);
      wasOpen = isOpen;
    }, 1000);
    return () => clearInterval(timer);
  }, [practice?.session, practice?.split]);

  // --- Actions -------------------------------------------------------------

  function say(text, kind = 'info') {
    if (practiceRef.current) {
      setPractice((p) => p && { ...p, coach: [...p.coach, { kind, text }] });
      setOffsets((o) => ({ ...o, coach: null }));
    } else {
      setMessages((m) => [...m, { kind, text }].slice(-30));
    }
  }

  function leaveProblem() {
    const current = practiceRef.current;
    if (current && !current.done) recordEvent(ctx.db, current.attemptId, 'close', { idleMs });
    ctx.current.attemptId = null;
    practiceRef.current = null;
    setPractice(null);
  }

  async function openProblem(target) {
    setBusy(target.daily ? "Getting today's problem…" : `Opening ${target.ref}…`);
    try {
      const loaded = await loadPractice(ctx, config, target);
      const previous = practiceRef.current;
      if (previous && previous.attemptId !== loaded.attempt.id && !previous.done) {
        recordEvent(ctx.db, previous.attemptId, 'close', { idleMs });
      }
      const { split, askWindowsTerminal } = ctx.resolveSplit(config);
      const session = ctx.createEditorSession({ file: loaded.file, slug: loaded.problem.slug, config });
      const next = {
        ...loaded,
        attemptId: loaded.attempt.id,
        hintsShown: loaded.attempt.hints_seen,
        done: false,
        lastSaveAt: null,
        session,
        split,
        askWindowsTerminal,
        coach: introMessages(loaded, session),
      };
      ctx.current.attemptId = next.attemptId;
      ctx.current.idleMs = idleMs;
      practiceRef.current = next;
      setPractice(next);
      setScreen('problem');
      setFocus('problem');
      setOffsets({ problem: 0, coach: null });
      if (split && session.editor) await openEditor();
    } catch (error) {
      say(error.message, 'error');
    } finally {
      setBusy(null);
    }
  }

  async function openEditor(kind) {
    const current = practiceRef.current;
    if (!current) return say(NEED_PROBLEM);
    if (!current.session.editor) return say('No terminal editor found. Run /setup to choose or install one.', 'error');
    const split = kind === undefined ? current.split : kind;
    if (!split && current.askWindowsTerminal) return setAsking(true);
    try {
      const lines = await current.session.open({
        suspendTerminal,
        split,
        elapsed: () => attemptTimes(ctx.db, current.attemptId, { idleMs }).activeMs,
      });
      for (const line of lines) say(line);
    } catch (error) {
      say(error.message, 'error');
    }
  }

  function answerWindowsTerminal(yes) {
    setAsking(false);
    const next = { ...config, terminal: { ...config.terminal, windowsTerminal: yes } };
    ctx.saveConfig(next);
    setConfig(next);
    const split = yes ? 'wt' : null;
    practiceRef.current = { ...practiceRef.current, split, askWindowsTerminal: false };
    setPractice((p) => p && { ...p, split, askWindowsTerminal: false });
    openEditor(split);
  }

  function showHint() {
    const current = practiceRef.current;
    if (!current) return say(NEED_PROBLEM);
    const { hints } = current.problem;
    if (current.hintsShown >= hints.length) {
      return say(
        hints.length
          ? `That was LeetCode's last official hint. AI hints come in a later version.`
          : `LeetCode has no official hints for this problem. AI hints come in a later version.`,
      );
    }
    const n = current.hintsShown + 1;
    if (!current.done) recordHint(ctx.db, current.attemptId, n, { idleMs });
    practiceRef.current = { ...current, hintsShown: n };
    setPractice((p) => p && { ...p, hintsShown: n, coach: [...p.coach, hintMessage(hints, n)] });
    setOffsets((o) => ({ ...o, coach: null }));
  }

  function markDone() {
    const current = practiceRef.current;
    if (!current) return say(NEED_PROBLEM);
    if (current.done) return say('Already marked solved. /today or /open for the next one.');
    finishAttempt(ctx.db, current.attemptId, { idleMs });
    const { active_sec: active, wall_sec: wall } = ctx.db.prepare('SELECT active_sec, wall_sec FROM attempts WHERE id = ?').get(current.attemptId);
    ctx.current.attemptId = null;
    practiceRef.current = { ...current, done: true };
    setPractice((p) => p && { ...p, done: true });
    say(`✓ Solved in ${humanDuration(active * 1000)} active (${humanDuration(wall * 1000)} total). Next: /today or /open.`, 'success');
  }

  function goHome() {
    leaveProblem();
    setScreen('home');
    setHomeVisits((n) => n + 1);
  }

  function runCommand(text) {
    const [rawName, ...args] = text.slice(1).trim().split(/\s+/);
    const name = rawName.toLowerCase();
    const current = practiceRef.current;
    if (current && !current.done && !['hint', 'done', 'quit', 'home'].includes(name)) {
      recordEvent(ctx.db, current.attemptId, 'command', { idleMs, data: { name } });
    }
    switch (name) {
      case 'today':
        return openProblem({ daily: true });
      case 'open':
        return args.length ? openProblem({ ref: args.join(' ') }) : say('Which problem? For example: /open 1, /open two-sum.');
      case 'hint':
        return showHint();
      case 'done':
        return markDone();
      case 'home':
        return goHome();
      case 'setup':
        leaveProblem();
        return setScreen('setup');
      case 'help':
        return say(`${HELP}\nbokken v${version}`);
      case 'quit':
      case 'exit':
        leaveProblem();
        return exit();
      default:
        return say(`There's no /${rawName} command. Type /help to see them all.`, 'error');
    }
  }

  function submit(raw) {
    const text = raw.trim();
    if (!text) return;
    setHistory((h) => (h.at(-1) === text ? h : [...h, text].slice(-100)));
    if (busy) return say('Still working on the last command…');
    if (text.startsWith('/')) return runCommand(text);
    say(text, 'you');
    say(NO_AI);
  }

  function noteTyping() {
    const current = practiceRef.current;
    if (!current || current.done || Date.now() - lastKeyEvent.current < KEY_EVENT_EVERY_MS) return;
    lastKeyEvent.current = Date.now();
    recordEvent(ctx.db, current.attemptId, 'key', { idleMs });
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

  useInput(
    (input, key) => {
      if (asking) {
        if (input === 'y' || input === 'Y') answerWindowsTerminal(true);
        else if (input === 'n' || input === 'N') answerWindowsTerminal(false);
        else if (key.escape) setAsking(false);
        return;
      }
      if (key.ctrl && input === 'e') {
        openEditor();
      } else if (screen === 'problem' && key.tab) {
        setFocus((f) => (f === 'problem' ? 'coach' : 'problem'));
      } else if (screen === 'problem' && (key.pageUp || key.pageDown)) {
        scroll(focus, key.pageUp ? -1 : 1);
      }
    },
    { isActive: screen !== 'setup' },
  );

  // --- Rendering -----------------------------------------------------------

  const problemLines = useMemo(
    () => (practice ? markdownLines(htmlToMarkdown(practice.problem.content), layout.problem.width) : []),
    [practice?.problem, layout.problem.width],
  );
  const coachLines = useMemo(
    () => (practice ? renderMessages(practice.coach, layout.coach.width) : []),
    [practice?.coach, layout.coach.width],
  );
  const home = useMemo(() => {
    if (screen === 'setup' || practice) return null;
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
  }, [screen, homeVisits, practice === null]);

  if (screen === 'setup') {
    return (
      <Box flexDirection="column" width={columns} height={rows}>
        <Setup
          ctx={ctx}
          config={config}
          firstRun={firstRun}
          onDone={(next) => {
            setConfig(next);
            setScreen('home');
            setHomeVisits((n) => n + 1);
            say(`Setup saved. Solutions go in ${tildePath(next.workspace)}. Type /today to start.`, 'success');
          }}
        />
      </Box>
    );
  }

  const inProblem = screen === 'problem' && practice;
  const footer = inProblem
    ? 'ctrl+e editor · tab switch section · PgUp/PgDn scroll · /hint · /done · /home · /help'
    : '/today · /open 1 · /setup · /help · ctrl+c quit';

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {inProblem ? (
          <ProblemView
            practice={practice}
            columns={columns}
            layout={layout}
            focus={focus}
            problemLines={problemLines}
            coachLines={coachLines}
            offsets={offsets}
            getTimes={(now) => attemptTimes(ctx.db, practice.attemptId, { now: new Date(now), idleMs })}
          />
        ) : (
          <Home version={version} width={columns} height={rows - 3} {...home} today={today} messages={messages} />
        )}
      </Box>
      <Rule width={columns} />
      <Box paddingX={1}>
        {asking ? (
          <Text color="yellow">
            Is this window Windows Terminal? <Text bold>[y]</Text> open the editor in a split · <Text bold>[n]</Text> use the full screen
          </Text>
        ) : (
          <TextInput
            history={history}
            onSubmit={submit}
            onType={noteTyping}
            placeholder={inProblem ? 'ask anything, or /hint' : 'type a command, like /today or /open 1'}
          />
        )}
      </Box>
      <Box paddingX={1}>
        <Text dimColor wrap="truncate-end">
          {busy ? `… ${busy}` : footer}
        </Text>
      </Box>
    </Box>
  );
}

function introMessages({ problem, file, created, attempt }, session) {
  const opening = created
    ? { kind: 'info', text: `Created ${tildePath(file)}.` }
    : { kind: 'info', text: `Welcome back: ${humanDuration(attempt.active_sec * 1000)} on this so far. Your code is in ${tildePath(file)}.` };
  const earlierHints = problem.hints.slice(0, attempt.hints_seen).map((_, i) => hintMessage(problem.hints, i + 1));
  const editor = session.editor ? `ctrl+e opens ${session.editor.name}` : 'no editor found (/setup)';
  return [opening, ...earlierHints, { kind: 'info', text: `/hint for a hint · ${editor} · /done once it's solved` }];
}

function hintMessage(hints, n) {
  return { kind: 'hint', text: `**Hint ${n} of ${hints.length}:** ${htmlToMarkdown(hints[n - 1])}` };
}

function renderMessages(messages, width) {
  const lines = [];
  for (const message of messages) {
    if (lines.length) lines.push('');
    if (message.kind === 'hint') lines.push(...markdownLines(message.text, width));
    else lines.push(...textLines(message.kind === 'you' ? `> ${message.text}` : message.text, width, MESSAGE_STYLES[message.kind]));
  }
  return lines;
}
