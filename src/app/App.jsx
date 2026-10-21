import { readFileSync } from 'node:fs';
import { Box, Text, useApp, useInput, useWindowSize } from 'ink';
import { useEffect, useMemo, useRef, useState } from 'react';
import { LEVEL_NAMES } from '../ai/prompts.js';
import { PROVIDERS, resolveAi } from '../ai/providers.js';
import { extractCode } from '../languages.js';
import { htmlToMarkdown } from '../markdown.js';
import {
  aiHints,
  attemptTimes,
  finishAttempt,
  latestActiveAttempt,
  markViewedSolution,
  practiceSummary,
  recordAi,
  recordEvent,
  recordHint,
} from '../tracking.js';
import { humanDuration, watchSaves } from '../util.js';
import { AiSetup } from './AiSetup.jsx';
import { clampOffset, Rule, TextInput } from './components.jsx';
import { Home, MESSAGE_STYLES } from './Home.jsx';
import { markdownLines, textLines } from './markdown-lines.js';
import { loadPractice, tildePath, todaysProblem } from './practice.js';
import { ProblemView, problemLayout } from './ProblemView.jsx';
import { Setup } from './Setup.jsx';

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
Keys: ctrl+e opens your editor · tab switches which section scrolls · PgUp/PgDn scroll · Esc stops an answer · ↑↓ earlier commands`;

const NEED_PROBLEM = 'Open a problem first: /today, or /open 1.';
const KEY_EVENT_EVERY_MS = 30_000;

/**
 * The whole app: setup, home and the problem screen, with the input line at the bottom.
 * `ctx` holds the database, LeetCode client, AI and terminal helpers (see open.jsx).
 * `size` fixes the screen size, for tests.
 */
export function App({ version, ctx, firstRun = false, start, size, showUsage = false }) {
  const { exit, suspendTerminal } = useApp();
  const windowSize = useWindowSize();
  const { columns, rows } = size ?? windowSize;

  const [config, setConfig] = useState(() => ctx.loadConfig());
  const [screen, setScreen] = useState(firstRun || start?.setup ? 'setup' : start?.aiSetup ? 'aiSetup' : 'home');
  const [messages, setMessages] = useState([]);
  const [practice, setPractice] = useState(null);
  const [busy, setBusy] = useState(null);
  const [asking, setAsking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [history, setHistory] = useState([]);
  const [focus, setFocus] = useState('problem');
  const [offsets, setOffsets] = useState({ problem: 0, coach: null });
  const [today, setToday] = useState({ status: 'loading' });
  const [homeVisits, setHomeVisits] = useState(0);
  const [credentialsVersion, setCredentialsVersion] = useState(0);
  const [coach, setCoach] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);

  const practiceRef = useRef(null);
  practiceRef.current = practice;
  const coachRef = useRef(null);
  coachRef.current = coach;
  const pendingStart = useRef(start?.daily || start?.ref ? start : null);
  const started = useRef(false);
  const returnTo = useRef('home');
  const abortRef = useRef(null);
  const solutionQuestion = useRef(null);
  const lastKeyEvent = useRef(0);
  const nextId = useRef(0);
  const idleMs = config.stats.idleMinutes * 60_000;
  // The solution question takes two lines instead of the input's one.
  const layout = problemLayout(columns, confirming ? rows - 1 : rows);

  const aiSettings = useMemo(() => resolveAi(config, ctx.loadCredentials(), ctx.env), [config, credentialsVersion]);

  // --- Effects -------------------------------------------------------------

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

  useEffect(() => {
    let cancelled = false;
    setCoach(null);
    if (aiSettings && !aiSettings.keyProblem) {
      ctx.createCoach(aiSettings).then(
        (created) => !cancelled && setCoach(created),
        (error) => !cancelled && say(error.message, 'error'),
      );
    }
    return () => {
      cancelled = true;
    };
  }, [aiSettings]);

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

  // --- Messages and state helpers -----------------------------------------

  function say(text, kind = 'info') {
    const message = { id: ++nextId.current, kind, text };
    if (practiceRef.current) {
      setPractice((p) => p && { ...p, coach: [...p.coach, message] });
      setOffsets((o) => ({ ...o, coach: null }));
    } else {
      setMessages((m) => [...m, message].slice(-30));
    }
    return message.id;
  }

  function updateMessage(id, changes) {
    const update = (list) => list.map((m) => (m.id === id ? { ...m, ...changes } : m));
    setPractice((p) => p && { ...p, coach: update(p.coach) });
    setMessages(update);
    setOffsets((o) => ({ ...o, coach: null }));
  }

  /** `change` must be pure: it runs on the ref now and on the state at render. */
  function updatePractice(change) {
    if (practiceRef.current) practiceRef.current = change(practiceRef.current);
    setPractice((p) => p && change(p));
  }

  function ifActive(record) {
    const current = practiceRef.current;
    if (current && !current.done) record(current.attemptId);
  }

  function withId(message) {
    return { ...message, id: ++nextId.current };
  }

  // --- Problems ------------------------------------------------------------

  function leaveProblem() {
    abortRef.current?.abort();
    const current = practiceRef.current;
    if (current && !current.done) recordEvent(ctx.db, current.attemptId, 'close', { idleMs });
    ctx.current.attemptId = null;
    practiceRef.current = null;
    setPractice(null);
    setConfirming(false);
  }

  async function openProblem(target) {
    setBusy(target.daily ? "Getting today's problem…" : `Opening ${target.ref}…`);
    try {
      const loaded = await loadPractice(ctx, config, target);
      const previous = practiceRef.current;
      if (previous && previous.attemptId !== loaded.attempt.id && !previous.done) {
        recordEvent(ctx.db, previous.attemptId, 'close', { idleMs });
      }
      abortRef.current?.abort();
      const { split, askWindowsTerminal } = ctx.resolveSplit(config);
      const session = ctx.createEditorSession({ file: loaded.file, slug: loaded.problem.slug, config });
      const earlierAiHints = aiHints(ctx.db, loaded.attempt.id);
      const next = {
        ...loaded,
        attemptId: loaded.attempt.id,
        lang: loaded.attempt.lang,
        hintsShown: loaded.attempt.hints_seen,
        aiLevel: loaded.attempt.ai_level,
        aiHints: earlierAiHints,
        chat: [],
        done: false,
        lastSaveAt: null,
        session,
        split,
        askWindowsTerminal,
        coach: introMessages(loaded, session, earlierAiHints).map(withId),
      };
      ctx.current.attemptId = next.attemptId;
      ctx.current.idleMs = idleMs;
      practiceRef.current = next;
      setPractice(next);
      setConfirming(false);
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
    updatePractice((p) => ({ ...p, split, askWindowsTerminal: false }));
    openEditor(split);
  }

  function markDone() {
    const current = practiceRef.current;
    if (!current) return say(NEED_PROBLEM);
    if (current.done) return say('Already marked solved. /today or /open for the next one.');
    finishAttempt(ctx.db, current.attemptId, { idleMs });
    const { active_sec: active, wall_sec: wall } = ctx.db.prepare('SELECT active_sec, wall_sec FROM attempts WHERE id = ?').get(current.attemptId);
    ctx.current.attemptId = null;
    updatePractice((p) => ({ ...p, done: true }));
    say(`✓ Solved in ${humanDuration(active * 1000)} active (${humanDuration(wall * 1000)} total). Next: /today or /open.`, 'success');
  }

  function goHome() {
    leaveProblem();
    setScreen('home');
    setHomeVisits((n) => n + 1);
  }

  // --- The coach -----------------------------------------------------------

  function aiMissing() {
    if (!aiSettings) return "AI isn't set up. Type /ai to set it up: Claude, OpenAI, Gemini, or a local model like Ollama.";
    if (aiSettings.keyProblem) return aiSettings.keyProblem;
    return 'The AI coach is still starting. Try again in a moment.';
  }

  async function withAi(work) {
    if (abortRef.current) return say('Still answering. Press Esc to stop it.');
    const controller = new AbortController();
    abortRef.current = controller;
    setAiBusy(true);
    try {
      await work(controller.signal);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setAiBusy(false);
    }
  }

  function currentCode(p) {
    try {
      const text = readFileSync(p.file, 'utf8');
      return extractCode(text) ?? text;
    } catch {
      return '';
    }
  }

  function coachInput(p) {
    return {
      problem: p.problem,
      code: currentCode(p),
      lang: p.lang,
      lastResult: null,
      earlierHints: [
        ...p.problem.hints.slice(0, p.hintsShown).map((hint, i) => ({ label: `Official hint ${i + 1}`, text: htmlToMarkdown(hint) })),
        ...p.aiHints.map((hint) => ({ label: `AI hint, level ${hint.level} (${LEVEL_NAMES[hint.level]})`, text: hint.text })),
      ],
    };
  }

  function usageNote(usage) {
    if (!showUsage) return '';
    if (!usage) return '\n\n(the provider reported no token usage)';
    const n = (x) => x.toLocaleString('en-US');
    return `\n\n(${n(usage.inputTokens)} tokens in${usage.cachedTokens ? `, ${n(usage.cachedTokens)} cached` : ''} · ${n(usage.outputTokens)} out)`;
  }

  /** The next step on the ladder: LeetCode's hints first, then AI nudge → approach → outline. */
  function showHint() {
    const current = practiceRef.current;
    if (!current) return say(NEED_PROBLEM);
    const { hints } = current.problem;
    if (current.hintsShown < hints.length) {
      const n = current.hintsShown + 1;
      ifActive((attemptId) => recordHint(ctx.db, attemptId, n, { idleMs }));
      updatePractice((p) => ({ ...p, hintsShown: n }));
      say(officialHintText(hints, n), 'hint');
      return;
    }
    const lastOfficial = hints.length ? "That was LeetCode's last official hint." : 'LeetCode has no official hints for this problem.';
    if (!coachRef.current) return say(`${lastOfficial} ${aiMissing()}`);
    if (current.aiLevel >= 3) return say("That was the last hint level, an outline. If you're still stuck, ask for the solution.");
    withAi((signal) => giveAiHint(signal, { level: current.aiLevel + 1 }));
  }

  async function giveAiHint(signal, { level, question, pendingId }) {
    const current = practiceRef.current;
    const id = pendingId ?? say('Thinking…', 'pending');
    try {
      const result = await coachRef.current.hint({ ...coachInput(current), level, question, signal });
      if (result.declined && !result.text) return updateMessage(id, { kind: 'error', text: `${aiSettings.name} declined to answer that.` });
      const text = result.text || 'That hint was all code, so bokken held it back. Try /hint again.';
      updateMessage(id, { kind: 'hint', text: `**AI hint, level ${level} (${LEVEL_NAMES[level]}):** ${text}${usageNote(result.usage)}` });
      ifActive((attemptId) => recordAi(ctx.db, attemptId, { log: result.log, usage: result.usage, hintText: result.text }, { idleMs }));
      updatePractice((p) => ({ ...p, aiLevel: Math.max(p.aiLevel, level), aiHints: [...p.aiHints, { level, text: result.text }] }));
    } catch (error) {
      updateMessage(id, { kind: error.code === 'aborted' ? 'info' : 'error', text: error.message });
    }
  }

  function ask(question) {
    say(question, 'you');
    const current = practiceRef.current;
    if (!current) return say(`${NEED_PROBLEM} Then ask about it.`);
    if (!coachRef.current) return say(aiMissing());
    withAi(async (signal) => {
      const id = say('Thinking…', 'pending');
      try {
        const code = currentCode(current);
        const hintsUsed = current.hintsShown + current.aiHints.length;
        const { mode, log, usage } = await coachRef.current.classify({ question, hintsUsed, hasCode: Boolean(code.trim()), signal });
        ifActive((attemptId) => recordAi(ctx.db, attemptId, { log: { ...log, mode }, usage, question: true }, { idleMs }));
        if (mode === 'hint') return await giveAiHint(signal, { level: Math.min(3, current.aiLevel + 1), question, pendingId: id });
        if (mode === 'solution') {
          updateMessage(id, { kind: 'info', text: 'That sounds like a request for the full solution.' });
          solutionQuestion.current = question;
          setConfirming(true);
          return;
        }
        await streamAnswer(signal, { mode, question, pendingId: id });
      } catch (error) {
        updateMessage(id, { kind: error.code === 'aborted' ? 'info' : 'error', text: error.message });
      }
    });
  }

  async function streamAnswer(signal, { mode, question, pendingId }) {
    const current = practiceRef.current;
    const id = pendingId ?? say('Thinking…', 'pending');
    let text = '';
    let timer = null;
    const flush = () => {
      timer = null;
      updateMessage(id, { kind: 'ai', text });
    };
    try {
      const result = await coachRef.current.answer({
        ...coachInput(current),
        mode,
        level: current.aiLevel,
        history: current.chat,
        question,
        signal,
        onText: (piece) => {
          text += piece;
          timer ??= setTimeout(flush, 50);
        },
      });
      clearTimeout(timer);
      if (result.declined && !result.text) {
        updateMessage(id, { kind: 'error', text: `${aiSettings.name} declined to answer that.` });
      } else {
        updateMessage(id, { kind: 'ai', text: (result.text || '(no answer)') + usageNote(result.usage) });
      }
      ifActive((attemptId) => {
        recordAi(ctx.db, attemptId, { log: result.log, usage: result.usage }, { idleMs });
        if (mode === 'solution' || result.gaveSolution) markViewedSolution(ctx.db, attemptId);
      });
      updatePractice((p) => ({ ...p, chat: [...p.chat, { role: 'user', text: question }, { role: 'assistant', text: result.text }].slice(-20) }));
    } catch (error) {
      clearTimeout(timer);
      if (error.code === 'aborted') updateMessage(id, { kind: 'ai', text: `${text}${text ? '\n\n' : ''}(stopped)` });
      else updateMessage(id, { kind: 'error', text: error.message });
    }
  }

  function answerSolutionChoice(choice) {
    setConfirming(false);
    if (choice === 'hint') return showHint();
    if (choice === 'cancel') return say('No solution, then. You can do this.');
    const question = solutionQuestion.current;
    withAi((signal) => streamAnswer(signal, { mode: 'solution', question }));
  }

  // --- Commands and input --------------------------------------------------

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
      case 'new':
        if (!current) return say(NEED_PROBLEM);
        updatePractice((p) => ({ ...p, chat: [] }));
        return say('Started a fresh chat. Your hints so far still count.');
      case 'ai':
        returnTo.current = screen;
        return setScreen('aiSetup');
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
    if (aiBusy) return say('Still answering. Press Esc to stop it.');
    ask(text);
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
      if (confirming) {
        if (input === 'h') answerSolutionChoice('hint');
        else if (input === 's') answerSolutionChoice('solution');
        else if (input === 'c' || key.escape) answerSolutionChoice('cancel');
        return;
      }
      if (key.escape && abortRef.current) {
        abortRef.current.abort();
      } else if (key.ctrl && input === 'e') {
        openEditor();
      } else if (screen === 'problem' && key.tab) {
        setFocus((f) => (f === 'problem' ? 'coach' : 'problem'));
      } else if (screen === 'problem' && (key.pageUp || key.pageDown)) {
        scroll(focus, key.pageUp ? -1 : 1);
      }
    },
    { isActive: screen === 'home' || screen === 'problem' },
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
          onDone={(next, { setupAi }) => {
            setConfig(next);
            setHomeVisits((n) => n + 1);
            say(`Setup saved. Solutions go in ${tildePath(next.workspace)}. Type /today to start.`, 'success');
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
            say(`✓ AI ready: ${PROVIDERS[next.ai.provider].name}, ${next.ai.model}. Ask anything, or /hint.`, 'success');
          }}
        />
      </Box>
    );
  }

  const inProblem = screen === 'problem' && practice;
  const footer = aiBusy
    ? 'Esc stops the answer'
    : inProblem
      ? 'ctrl+e editor · tab switch section · PgUp/PgDn scroll · /hint · /done · /home · /help'
      : '/today · /open 1 · /ai · /setup · /help · ctrl+c quit';

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
      <Box paddingX={1} flexShrink={0}>
        {asking ? (
          <Text color="yellow">
            Is this window Windows Terminal? <Text bold>[y]</Text> open the editor in a split · <Text bold>[n]</Text> use the full screen
          </Text>
        ) : confirming && practice ? (
          <SolutionChoice practice={practice} idleMs={idleMs} db={ctx.db} />
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
          {busy ? `… ${busy}` : footer}
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
        <Text bold>[h]</Text> one more hint · <Text bold>[s]</Text> show the solution · <Text bold>[c]</Text> cancel
      </Text>
    </Box>
  );
}

function introMessages({ problem, file, created, attempt }, session, earlierAiHints) {
  const opening = created
    ? { kind: 'info', text: `Created ${tildePath(file)}.` }
    : { kind: 'info', text: `Welcome back: ${humanDuration(attempt.active_sec * 1000)} on this so far. Your code is in ${tildePath(file)}.` };
  const official = problem.hints.slice(0, attempt.hints_seen).map((_, i) => ({ kind: 'hint', text: officialHintText(problem.hints, i + 1) }));
  const ai = earlierAiHints.map((hint) => ({ kind: 'hint', text: `**AI hint, level ${hint.level} (${LEVEL_NAMES[hint.level]}):** ${hint.text}` }));
  const editor = session.editor ? `ctrl+e opens ${session.editor.name}` : 'no editor found (/setup)';
  return [opening, ...official, ...ai, { kind: 'info', text: `/hint for a hint · type a question to ask the coach · ${editor} · /done once it's solved` }];
}

function officialHintText(hints, n) {
  return `**Hint ${n} of ${hints.length}:** ${htmlToMarkdown(hints[n - 1])}`;
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
