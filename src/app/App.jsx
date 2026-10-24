import { Box, Text, useApp, useInput, useWindowSize } from 'ink';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PROVIDERS } from '../ai/providers.js';
import { browseProblems, loadMore, nextProblem, parseFilters, randomProblem, suggestNext } from '../browse.js';
import { expireCatalog, leetcodeProgress } from '../leetcode.js';
import { htmlToMarkdown } from '../markdown.js';
import { statsView, topicStats, VIEWS } from '../stats.js';
import { findTopic } from '../topics.js';
import { attemptTimes, latestActiveAttempt, practiceSummary, recordEvent } from '../tracking.js';
import { humanDuration } from '../util.js';
import { AiSetup } from './AiSetup.jsx';
import { Browse } from './Browse.jsx';
import { clampOffset, Rule, TextInput } from './components.jsx';
import { Home, MESSAGE_STYLES } from './Home.jsx';
import { Login } from './Login.jsx';
import { markdownLines, textLines } from './markdown-lines.js';
import { tildePath, todaysProblem } from './practice.js';
import { ProblemView, problemLayout } from './ProblemView.jsx';
import { Setup } from './Setup.jsx';
import { statsLines } from './stats-lines.js';
import { StatsView } from './StatsView.jsx';
import { useCoach } from './useCoach.js';
import { useJudge } from './useJudge.js';
import { usePractice } from './usePractice.js';

const HELP = `Commands
  /today            today's problem
  /open <problem>   a problem by number, slug, title or link
  /hint             the next hint: LeetCode's first, then the AI's
  /run              run your code on the examples, on LeetCode
  /submit           submit your code to LeetCode; Accepted marks it solved
  /done             mark it solved and stop the clock
  /next [topic]     what to practice next, and why
  /stats [view]     your numbers: topics, difficulty, trend, a problem
  /browse [filters] problems to pick from, e.g. /browse dp medium unsolved
  /random [filters] open a random one that matches
  /new              start a fresh chat with the coach
  /ai               set up the AI coach (any provider)
  /login            log in to LeetCode, to run and submit
  /logout           forget the LeetCode login saved on this computer
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
  const [screen, setScreen] = useState(firstRun || start?.setup ? 'setup' : start?.aiSetup ? 'aiSetup' : start?.login ? 'login' : 'home');
  const [history, setHistory] = useState([]);
  // Narrow panes show one section at a time; wide ones show them all, and `view` is the one PgUp/PgDn scroll.
  const [view, setView] = useState('problem');
  // The coach's and notifications' messages as you last saw them; anything newer puts a dot on its tab.
  const [seen, setSeen] = useState({ attemptId: null, coach: null, notifications: null });
  const [offsets, setOffsets] = useState({ problem: 0, coach: null, notifications: null });
  const [today, setToday] = useState({ status: 'loading' });
  const [homeVisits, setHomeVisits] = useState(0);
  const [credentialsVersion, setCredentialsVersion] = useState(0);
  // Quitting closes the editor bokken opened, so while it's open, quitting asks first.
  const [quitting, setQuitting] = useState(false);
  // /stats: the view on screen (one of VIEWS, or a problem) and how far it's scrolled.
  const [statsName, setStatsName] = useState('overview');
  const [statsOffset, setStatsOffset] = useState(0);
  // /browse: the list on screen.
  const [list, setList] = useState(null);
  // What /next or /random is waiting on, for the footer.
  const [working, setWorking] = useState(null);
  const pendingStart = useRef(start?.daily || start?.ref ? start : null);
  const started = useRef(false);
  // Where AI setup and login go when they're done: the screens queued here, then home.
  const upcoming = useRef([]);
  const lastKeyEvent = useRef(0);
  const idleMs = config.stats.idleMinutes * 60_000;

  const practice = usePractice({ ctx, config, setConfig, idleMs });
  const coach = useCoach({ ctx, config, credentialsVersion, practice, showUsage, idleMs });
  const judge = useJudge({ ctx, practice, idleMs });
  const current = practice.practice;
  // The solution question takes two lines instead of the input's one.
  const layout = problemLayout(columns, coach.confirming ? rows - 1 : rows, { notifications: Boolean(current?.notifications.length) });
  const sections = ['problem', 'coach', ...(layout.notifications ? ['notifications'] : [])];
  // `view` can name the notifications before there are any (/run on the home screen).
  const shown = sections.includes(view) ? view : 'problem';

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
    setOffsets({ problem: 0, coach: null, notifications: null });
    setSeen({ attemptId: current.attemptId, coach: current.coach, notifications: current.notifications });
  }, [current?.attemptId]);

  // The coach and notifications sections follow their newest message.
  useEffect(() => setOffsets((o) => ({ ...o, coach: null })), [current?.coach]);
  useEffect(() => setOffsets((o) => ({ ...o, notifications: null })), [current?.notifications]);

  useEffect(() => {
    if (!current) return;
    const showing = (section) => layout.wide || shown === section;
    setSeen((s) => ({
      attemptId: current.attemptId,
      coach: showing('coach') ? current.coach : s.coach,
      notifications: showing('notifications') ? current.notifications : s.notifications,
    }));
  }, [current?.coach, current?.notifications, shown, layout.wide]);
  const isUnread = (section) =>
    Boolean(current) && !layout.wide && shown !== section && seen.attemptId === current.attemptId && current[section] !== seen[section];
  const unread = { coach: isUnread('coach'), notifications: isUnread('notifications') };

  function openProblem(target) {
    coach.stop();
    judge.stop();
    return practice.open(target);
  }

  /** Closes the problem's editor too, unless `keepEditor`. */
  function leaveProblem({ keepEditor = false } = {}) {
    coach.stop();
    judge.stop();
    practice.leave({ keepEditor });
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

  function showNext() {
    setScreen(upcoming.current.shift() ?? 'home');
  }

  /** `/logout`. The session stays valid on LeetCode; logging out there ends it everywhere. */
  function logout() {
    const credentials = ctx.loadCredentials();
    if (!credentials.leetcode) return practice.say("You weren't logged in to LeetCode.");
    delete credentials.leetcode;
    ctx.saveCredentials(credentials);
    ctx.client.setSession(null);
    practice.say('Logged out. The LeetCode login saved on this computer is deleted. To end it everywhere, log out on leetcode.com too.', 'success');
  }

  function finishQuit({ keepEditor = false } = {}) {
    leaveProblem({ keepEditor });
    exit();
  }

  function showStats(name) {
    leaveProblem();
    setStatsName(VIEWS.includes(name.toLowerCase()) ? name.toLowerCase() : name);
    setStatsOffset(0);
    setScreen('stats');
  }

  /** `/next` and `/random` wait on LeetCode: the footer says what for, and a failure is reported. */
  async function work(label, task) {
    setWorking(label);
    try {
      await task();
    } catch (error) {
      practice.say(error.message, 'error');
    } finally {
      setWorking(null);
    }
  }

  function suggest(text) {
    const topic = text ? findTopic(ctx.db, text) : null;
    if (text && !topic) return practice.say(`No topic matches "${text}". Try one like dp, graph or binary search.`, 'error');
    return work('Finding your next problem…', async () => {
      const next = await nextProblem(ctx.db, ctx.client, { topic });
      if (!next.problem) {
        return practice.say(`No ${next.topic.name} problem you haven't started turned up. /browse ${next.topic.name.toLowerCase()} lists them all.`);
      }
      const p = next.problem;
      const accepted = p.acRate === null ? '' : ` · ${Math.round(p.acRate)}% accepted`;
      practice.say(`Next: ${p.frontendId}. ${p.title} · ${p.difficulty}${accepted}. ${next.why} Type /open ${p.frontendId} to start.`, 'success');
      setHomeVisits((n) => n + 1);
    });
  }

  function browse(text) {
    const filters = parseFilters(ctx.db, text);
    if (filters.error) return practice.say(filters.error, 'error');
    leaveProblem();
    const title = [filters.topic?.name, filters.difficulty, filters.status].filter(Boolean).join(' · ') || 'every problem';
    setList({ title, filters, problems: [], topic: null, loading: filters.topic ? `Getting ${filters.topic.name} problems…` : 'Loading…' });
    setScreen('browse');
    return showList(filters, title);
  }

  async function showList(filters, title, before = null) {
    try {
      const result = await browseProblems(ctx.db, ctx.client, filters);
      // After "Load more", the cursor goes to the first new problem.
      const initial = before ? result.problems.find((p) => !before.has(p.slug))?.slug : undefined;
      setList({ title, filters, ...result, initial, loading: null });
    } catch (error) {
      setScreen('home');
      practice.say(error.message, 'error');
    }
  }

  async function loadMoreProblems() {
    const { filters, title, problems } = list;
    setList((l) => ({ ...l, loading: `Getting more ${filters.topic.name} problems…` }));
    try {
      await loadMore(ctx.db, ctx.client, filters.topic.slug);
    } catch (error) {
      setScreen('home');
      return practice.say(error.message, 'error');
    }
    return showList(filters, title, new Set(problems.map((p) => p.slug)));
  }

  function openFromList(slug) {
    setList(null);
    setScreen('home');
    openProblem({ ref: slug });
  }

  function openRandom(text) {
    const filters = parseFilters(ctx.db, text);
    if (filters.error) return practice.say(filters.error, 'error');
    return work('Picking a problem…', async () => {
      const problem = await randomProblem(ctx.db, ctx.client, filters);
      if (!problem) return practice.say('No problem matches. /browse shows what there is.');
      await openProblem({ ref: problem.slug });
    });
  }

  function runCommand(text) {
    const [rawName, ...args] = text.slice(1).trim().split(/\s+/);
    const name = rawName.toLowerCase();
    // These record their own events.
    if (current && !current.done && !['hint', 'run', 'submit', 'done', 'quit', 'home'].includes(name)) {
      recordEvent(ctx.db, current.attemptId, 'command', { idleMs, data: { name } });
    }
    // The stats screen has no messages: anything else is answered on the home screen.
    if (screen === 'stats' && !['stats', 'quit', 'exit', 'ai', 'login'].includes(name)) setScreen('home');
    switch (name) {
      case 'today':
        return openProblem({ daily: true });
      case 'open':
        return args.length ? openProblem({ ref: args.join(' ') }) : practice.say('Which problem? For example: /open 1, /open two-sum.');
      case 'hint':
        setView('coach');
        return coach.nextHint();
      case 'run':
        setView('notifications');
        return judge.run();
      case 'submit':
        setView('notifications');
        return judge.submit();
      case 'done':
        setView('notifications');
        return practice.markDone();
      case 'next':
        setView('notifications');
        return suggest(args.join(' '));
      case 'stats':
        return showStats(args.join(' ') || 'overview');
      case 'browse':
        return browse(args.join(' '));
      case 'random':
        setView('notifications');
        return openRandom(args.join(' '));
      case 'new':
        setView('coach');
        return coach.newChat();
      case 'ai':
        upcoming.current = [screen];
        return setScreen('aiSetup');
      case 'login':
        upcoming.current = [screen];
        return setScreen('login');
      case 'logout':
        setView('notifications');
        return logout();
      case 'home':
        return goHome();
      case 'setup':
        leaveProblem();
        return setScreen('setup');
      case 'help':
        setView('notifications');
        return practice.say(`${HELP}\nbokken v${version}`);
      case 'quit':
      case 'exit':
        return quit();
      default:
        setView('notifications');
        return practice.say(`There's no /${rawName} command. Type /help to see them all.`, 'error');
    }
  }

  function submit(raw) {
    const text = raw.trim();
    if (!text) return;
    setHistory((h) => (h.at(-1) === text ? h : [...h, text].slice(-100)));
    if (practice.loading || working) return practice.say('Still working on the last command…');
    if (text.startsWith('/')) return runCommand(text);
    // The stats screen has no messages, so the answer is on the home screen.
    if (screen === 'stats') setScreen('home');
    if (coach.busy) return practice.coachSay('Still answering. Press Esc to stop it.');
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
    const length = { problem: problemLines, coach: coachLines, notifications: notificationLines }[section].length;
    setOffsets((o) => {
      const next = clampOffset(clampOffset(o[section], length, height) + direction * Math.max(1, height - 2), length, height);
      const atEnd = next >= length - height;
      return { ...o, [section]: section === 'coach' && atEnd ? null : next };
    });
  }

  // ctrl+c works on every screen. Pressed again while bokken asks, it quits and leaves the editor open.
  useInput((input, key) => {
    if (!(key.ctrl && input === 'c')) return;
    if (quitting) finishQuit({ keepEditor: true });
    else quit();
  });

  useInput(
    (input, key) => {
      if (quitting) {
        if (key.return || input === 'y' || input === 'Y') finishQuit();
        else if (input === 'n' || input === 'N' || key.escape) setQuitting(false);
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
      } else if (key.escape && judge.busy) {
        judge.stop();
      } else if (screen === 'stats' && key.tab) {
        // From a problem's attempts, tab goes back to the overview.
        setStatsName((name) => VIEWS[(VIEWS.indexOf(name) + 1) % VIEWS.length]);
        setStatsOffset(0);
      } else if (screen === 'stats' && (key.pageUp || key.pageDown)) {
        const height = statsHeight;
        setStatsOffset((o) => clampOffset(o + (key.pageUp ? -1 : 1) * Math.max(1, height - 2), statsLinesShown.length, height));
      } else if (screen === 'stats' && key.escape) {
        goHome();
      } else if (key.ctrl && input === 'e') {
        practice.openEditor();
      } else if (screen === 'problem' && key.tab) {
        setView(sections[(sections.indexOf(shown) + 1) % sections.length]);
      } else if (screen === 'problem' && (key.pageUp || key.pageDown)) {
        scroll(shown, key.pageUp ? -1 : 1);
      }
    },
    { isActive: screen === 'home' || screen === 'problem' || screen === 'stats' },
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
  const notificationLines = useMemo(
    () => (layout.notifications ? renderMessages(current.notifications, layout.notifications.width) : []),
    [current?.notifications, layout.notifications?.width],
  );
  // StatsView's header, rule and gap, under the app's own header rows.
  const statsHeight = Math.max(1, rows - 6);
  const statsLinesShown = useMemo(
    () => (screen === 'stats' ? statsLines(statsView(ctx.db, statsName, { idleMs, progress: leetcodeProgress(ctx.db, ctx.client) }), columns - 2) : []),
    [screen, statsName, columns],
  );
  const home = useMemo(() => {
    if (screen === 'setup' || current) return null;
    const latest = latestActiveAttempt(ctx.db);
    // From what bokken already has: the home screen never waits on LeetCode.
    const next = suggestNext(ctx.db, { progress: leetcodeProgress(ctx.db, ctx.client) });
    const ranked = topicStats(ctx.db).filter((topic) => topic.score !== null);
    return {
      summary: practiceSummary(ctx.db, { idleMs }),
      continueItem: latest && {
        frontendId: latest.frontend_id,
        title: latest.title,
        slug: latest.slug,
        difficulty: latest.difficulty,
        activeMs: attemptTimes(ctx.db, latest.id, { idleMs }).activeMs,
      },
      suggested: next.problem && { ...next.problem, topic: next.topic.name },
      weakest: ranked.length >= 2 ? ranked.slice(0, 3) : [],
    };
  }, [screen, homeVisits, current === null]);

  if (screen === 'setup') {
    return (
      <Box flexDirection="column" width={columns} height={rows}>
        <Setup
          ctx={ctx}
          config={config}
          firstRun={firstRun}
          onDone={(next, { setupAi, setupLogin }) => {
            setConfig(next);
            setHomeVisits((n) => n + 1);
            practice.say(`Setup saved. Solutions go in ${tildePath(next.workspace)}. Type /today to start.`, 'success');
            upcoming.current = setupAi && setupLogin ? ['login'] : [];
            setScreen(setupAi ? 'aiSetup' : setupLogin ? 'login' : 'home');
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
          onCancel={showNext}
          onDone={(next) => {
            setConfig(next);
            setCredentialsVersion((v) => v + 1);
            showNext();
            practice.say(`✓ AI ready: ${PROVIDERS[next.ai.provider].name}, ${next.ai.model}. Ask anything, or /hint.`, 'success');
          }}
        />
      </Box>
    );
  }

  if (screen === 'login') {
    return (
      <Box flexDirection="column" width={columns} height={rows}>
        <Login
          ctx={ctx}
          onCancel={showNext}
          onDone={(username) => {
            // The problem list is fetched again on next use, to bring your solved problems.
            expireCatalog(ctx.db);
            showNext();
            practice.say(`✓ Logged in to LeetCode as ${username}.`, 'success');
          }}
        />
      </Box>
    );
  }

  if (screen === 'browse' && list) {
    return (
      <Box flexDirection="column" width={columns} height={rows}>
        <Browse width={columns} height={rows} list={list} onOpen={openFromList} onLoadMore={loadMoreProblems} onCancel={goHome} />
      </Box>
    );
  }

  const inProblem = Boolean(current);
  let footer = '/today · /open 1 · /ai · /setup · /help · ctrl+c quit';
  if (coach.busy) footer = 'Esc stops the answer';
  else if (judge.busy) footer = 'Esc stops waiting for LeetCode';
  else if (inProblem && layout.wide) footer = 'ctrl+e editor · tab scroll · /hint · /run · /submit · /done · /help';
  else if (inProblem) footer = `tab ${sections[(sections.indexOf(shown) + 1) % sections.length]} · ctrl+e editor · /hint · /run · /submit`;
  else if (screen === 'stats') footer = 'tab next view · PgUp/PgDn scroll · Esc home · /next · /browse';

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {inProblem ? (
          <ProblemView
            practice={current}
            columns={columns}
            layout={layout}
            view={shown}
            unread={unread}
            problemLines={problemLines}
            coachLines={coachLines}
            notificationLines={notificationLines}
            offsets={offsets}
            getTimes={(now) => attemptTimes(ctx.db, current.attemptId, { now: new Date(now), idleMs })}
          />
        ) : screen === 'stats' ? (
          <StatsView width={columns} height={rows - 3} view={statsName} lines={statsLinesShown} offset={statsOffset} />
        ) : (
          <Home
            version={version}
            width={columns}
            height={rows - 3}
            {...home}
            today={today}
            messages={practice.messages}
            workspace={config.workspace}
            loggedIn={ctx.client.hasSession()}
            aiReady={Boolean(coach.settings && !coach.settings.keyProblem)}
          />
        )}
      </Box>
      <Rule width={columns} junctions={inProblem ? layout.dividers.map((at) => ({ at, char: '┴' })) : []} />
      <Box paddingX={1} flexShrink={0}>
        {quitting && current ? (
          <Text color="yellow">
            Quit bokken? {current.session.editor.name} closes too, so save your work there first. <Text bold>[Y/n]</Text>
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
          {practice.loading || working ? `… ${practice.loading ?? working}` : footer}
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
    if (message.kind === 'hint' || message.kind === 'ai' || message.kind === 'result') lines.push(...markdownLines(message.text, width));
    else lines.push(...textLines(message.kind === 'you' ? `> ${message.text}` : message.text, width, MESSAGE_STYLES[message.kind]));
  }
  return lines;
}
