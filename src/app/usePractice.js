import { readFileSync } from 'node:fs';
import path from 'node:path';
import { useApp } from 'ink';
import { useEffect, useRef, useState } from 'react';
import { LEVEL_NAMES } from '../ai/prompts.js';
import { extractCode, solutionFile } from '../languages.js';
import { htmlToMarkdown } from '../markdown.js';
import { aiHints, attemptTimes, finishAttempt, recordEvent, recordHint } from '../tracking.js';
import { humanDuration, watchSaves } from '../util.js';
import { loadPractice, tildePath } from './practice.js';

export const NEED_PROBLEM = 'Open a problem first: /today, or /open 1.';

/**
 * The problem being practiced: its files, clock, editor, official hints and /done. Also the
 * messages: the Coach section's and the Notifications section's while a problem is open,
 * the home screen's otherwise.
 */
export function usePractice({ ctx, config, setConfig, idleMs }) {
  const { suspendTerminal } = useApp();
  const [practice, setPractice] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(null);
  const [asking, setAsking] = useState(false);
  const practiceRef = useRef(null);
  practiceRef.current = practice;
  const nextId = useRef(0);

  useEffect(() => {
    if (!practice?.file) return undefined;
    return watchSaves(practice.file, () => {
      const current = practiceRef.current;
      if (!current || current.done) return;
      recordEvent(ctx.db, current.attemptId, 'save', { idleMs });
      setPractice((p) => p && { ...p, lastSaveAt: new Date() });
    });
  }, [practice?.file]);

  /**
   * Everything that isn't the coach (results, errors, what a command did): the Notifications
   * section while a problem is open, the home screen otherwise. Returns the message's id,
   * for updating it later.
   */
  function say(text, kind = 'info') {
    return post('notifications', text, kind);
  }

  /** Hints, your questions and the AI's answers: the Coach section. */
  function coachSay(text, kind = 'info') {
    return post('coach', text, kind);
  }

  function post(section, text, kind) {
    const message = { id: ++nextId.current, kind, text };
    if (practiceRef.current) setPractice((p) => p && { ...p, [section]: [...p[section], message] });
    else setMessages((m) => [...m, message].slice(-30));
    return message.id;
  }

  function updateMessage(id, changes) {
    const update = (list) => list.map((m) => (m.id === id ? { ...m, ...changes } : m));
    setPractice((p) => p && { ...p, coach: update(p.coach), notifications: update(p.notifications) });
    setMessages(update);
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

  function leave() {
    const current = practiceRef.current;
    if (current && !current.done) recordEvent(ctx.db, current.attemptId, 'close', { idleMs });
    ctx.current.attemptId = null;
    practiceRef.current = null;
    setPractice(null);
    setAsking(false);
  }

  /** `/today` and `/open`. */
  async function open(target) {
    setLoading(target.daily ? "Getting today's problem…" : `Opening ${target.ref}…`);
    try {
      const loaded = await loadPractice(ctx, config, target);
      const previous = practiceRef.current;
      if (previous && previous.attemptId !== loaded.attempt.id && !previous.done) {
        recordEvent(ctx.db, previous.attemptId, 'close', { idleMs });
      }
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
        solutionShown: false,
        chat: [],
        notifications: [],
        // The latest /run or /submit, summed up for the coach.
        lastResult: null,
        done: false,
        lastSaveAt: null,
        session,
        split,
        askWindowsTerminal,
        coach: earlierHintMessages(loaded.problem, loaded.attempt.hints_seen, earlierAiHints).map((m) => ({ ...m, id: ++nextId.current })),
      };
      ctx.current.attemptId = next.attemptId;
      ctx.current.idleMs = idleMs;
      practiceRef.current = next;
      setPractice(next);
      setAsking(false);
      if (split && session.editor) await openEditor();
    } catch (error) {
      say(error.message, 'error');
    } finally {
      setLoading(null);
    }
  }

  async function openEditor(kind) {
    const current = practiceRef.current;
    if (!current) return say(NEED_PROBLEM);
    if (!current.session.editor) return say('No terminal editor found. Run /setup to choose or install one.', 'error');
    const split = kind === undefined ? current.split : kind;
    if (!split && current.askWindowsTerminal) return setAsking(true);
    try {
      const problems = await current.session.open({
        suspendTerminal,
        split,
        elapsed: () => attemptTimes(ctx.db, current.attemptId, { idleMs }).activeMs,
      });
      for (const problem of problems) say(problem, 'error');
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

  /** The next of LeetCode's own hints. False once they've all been shown. */
  function showOfficialHint() {
    const current = practiceRef.current;
    const { hints } = current.problem;
    if (current.hintsShown >= hints.length) return false;
    const n = current.hintsShown + 1;
    ifActive((attemptId) => recordHint(ctx.db, attemptId, n, { idleMs }));
    updatePractice((p) => ({ ...p, hintsShown: n }));
    coachSay(officialHintText(hints, n), 'hint');
    return true;
  }

  function markDone() {
    const current = practiceRef.current;
    if (!current) return say(NEED_PROBLEM);
    if (current.done) return say('Already marked solved. /today or /open for the next one.');
    finishAttempt(ctx.db, current.attemptId, { idleMs });
    say(afterSolved(), 'success');
  }

  /** Once /done or an Accepted submission has solved the attempt: the clock stops. Returns what to tell you. */
  function afterSolved() {
    const current = practiceRef.current;
    const { active_sec: active, wall_sec: wall } = ctx.db.prepare('SELECT active_sec, wall_sec FROM attempts WHERE id = ?').get(current.attemptId);
    ctx.current.attemptId = null;
    updatePractice((p) => ({ ...p, done: true }));
    return (
      `✓ Solved in ${humanDuration(active * 1000)} active (${humanDuration(wall * 1000)} total). ` +
      `Nicely done! Your solution is saved in ${tildePath(current.dir)}${path.sep}. Next: /today or /open.`
    );
  }

  /**
   * What the coach needs: the problem, your code, and the hints you already have.
   * `wroteCode` is false while the file still holds only LeetCode's starter code.
   */
  function coachContext() {
    const p = practiceRef.current;
    const code = currentCode(p.file);
    const squash = (text) => text.replace(/\s+/g, '');
    const starter = extractCode(solutionFile(p.problem, p.lang) ?? '') ?? '';
    return {
      problem: p.problem,
      code,
      wroteCode: Boolean(squash(code)) && squash(code) !== squash(starter),
      lang: p.lang,
      lastResult: p.lastResult,
      earlierHints: [
        ...p.problem.hints.slice(0, p.hintsShown).map((hint, i) => ({ label: `Official hint ${i + 1}`, text: htmlToMarkdown(hint) })),
        ...p.aiHints.map((hint) => ({ label: `AI hint, level ${hint.level} (${LEVEL_NAMES[hint.level]})`, text: hint.text })),
      ],
    };
  }

  return {
    practice,
    practiceRef,
    messages,
    loading,
    asking,
    cancelAsking: () => setAsking(false),
    say,
    coachSay,
    updateMessage,
    updatePractice,
    ifActive,
    open,
    leave,
    openEditor,
    answerWindowsTerminal,
    showOfficialHint,
    markDone,
    afterSolved,
    coachContext,
  };
}

export function aiHintText(level, text) {
  return `**AI hint, level ${level} (${LEVEL_NAMES[level]}):** ${text}`;
}

function officialHintText(hints, n) {
  return `**Hint ${n} of ${hints.length}:** ${htmlToMarkdown(hints[n - 1])}`;
}

// Reopening a problem brings back the hints you already got.
function earlierHintMessages(problem, hintsSeen, earlierAiHints) {
  return [
    ...problem.hints.slice(0, hintsSeen).map((_, i) => ({ kind: 'hint', text: officialHintText(problem.hints, i + 1) })),
    ...earlierAiHints.map((hint) => ({ kind: 'hint', text: aiHintText(hint.level, hint.text) })),
  ];
}

function currentCode(file) {
  try {
    const text = readFileSync(file, 'utf8');
    return extractCode(text) ?? text;
  } catch {
    return '';
  }
}
