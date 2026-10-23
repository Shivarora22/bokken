import { useEffect, useMemo, useRef, useState } from 'react';
import { resolveAi } from '../ai/providers.js';
import { markViewedSolution, recordAi } from '../tracking.js';
import { aiHintText, NEED_PROBLEM } from './usePractice.js';

/**
 * The AI coach: the hint ladder past LeetCode's hints, questions (classified, then answered
 * or streamed), the solution gate, and Esc. `practice` is what usePractice returns.
 */
export function useCoach({ ctx, config, credentialsVersion, practice, showUsage, idleMs }) {
  const settings = useMemo(() => resolveAi(config, ctx.loadCredentials(), ctx.env), [config, credentialsVersion]);
  const [coach, setCoach] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const coachRef = useRef(null);
  coachRef.current = coach;
  const abortRef = useRef(null);
  const solutionQuestion = useRef(null);
  const { practiceRef, coachSay: say, updateMessage, updatePractice, ifActive } = practice;

  useEffect(() => {
    let cancelled = false;
    setCoach(null);
    if (settings && !settings.keyProblem) {
      ctx.createCoach(settings).then(
        (created) => !cancelled && setCoach(created),
        (error) => !cancelled && say(error.message, 'error'),
      );
    }
    return () => {
      cancelled = true;
    };
  }, [settings]);

  function missing() {
    if (!settings) return "AI isn't set up. Type /ai to set it up: Claude, OpenAI, Gemini, or a local model like Ollama.";
    if (settings.keyProblem) return settings.keyProblem;
    return 'The AI coach is still starting. Try again in a moment.';
  }

  async function withAi(work) {
    if (abortRef.current) return say('Still answering. Press Esc to stop it.');
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    try {
      await work(controller.signal);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
    }
  }

  function usageNote(usage) {
    if (!showUsage) return '';
    if (!usage) return '\n\n(the provider reported no token usage)';
    const n = (x) => x.toLocaleString('en-US');
    return `\n\n(${n(usage.inputTokens)} tokens in${usage.cachedTokens ? `, ${n(usage.cachedTokens)} cached` : ''} · ${n(usage.outputTokens)} out)`;
  }

  /** The next step on the ladder: LeetCode's hints first, then AI nudge → approach → outline. */
  function nextHint() {
    const current = practiceRef.current;
    if (!current) return say(NEED_PROBLEM);
    if (practice.showOfficialHint()) return;
    const lastOfficial = current.problem.hints.length ? "That was LeetCode's last official hint." : 'LeetCode has no official hints for this problem.';
    if (!coachRef.current) return say(`${lastOfficial} ${missing()}`);
    if (current.aiLevel >= 3) return say("That was the last hint level, an outline. If you're still stuck, ask for the solution.");
    withAi((signal) => aiHint(signal, { level: current.aiLevel + 1 }));
  }

  async function aiHint(signal, { level, question, pendingId }) {
    const id = pendingId ?? say('Thinking…', 'pending');
    try {
      const result = await coachRef.current.hint({ ...practice.coachContext(), level, question, signal });
      if (result.declined && !result.text) return updateMessage(id, { kind: 'error', text: `${settings.name} declined to answer that.` });
      const text = result.text || 'That hint was all code, so bokken held it back. Try /hint again.';
      updateMessage(id, { kind: 'hint', text: aiHintText(level, text) + usageNote(result.usage) });
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
    if (!coachRef.current) return say(missing());
    withAi(async (signal) => {
      const id = say('Thinking…', 'pending');
      try {
        const { wroteCode } = practice.coachContext();
        const hintsUsed = current.hintsShown + current.aiHints.length;
        const { mode, log, usage } = await coachRef.current.classify({ question, hintsUsed, hasCode: wroteCode, signal });
        ifActive((attemptId) => recordAi(ctx.db, attemptId, { log: { ...log, mode }, usage, question: true }, { idleMs }));
        if (mode === 'hint') return await aiHint(signal, { level: Math.min(3, current.aiLevel + 1), question, pendingId: id });
        if (mode === 'solution' && current.solutionShown) return await stream(signal, { mode, variant: 'asked', question, pendingId: id });
        if (mode === 'solution') {
          updateMessage(id, { kind: 'info', text: 'That sounds like a request for the full solution.' });
          solutionQuestion.current = question;
          setConfirming(true);
          return;
        }
        await stream(signal, { mode, question, pendingId: id });
      } catch (error) {
        updateMessage(id, { kind: error.code === 'aborted' ? 'info' : 'error', text: error.message });
      }
    });
  }

  async function stream(signal, { mode, variant, question, pendingId }) {
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
        ...practice.coachContext(),
        mode,
        variant,
        solutionShown: current.solutionShown,
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
        updateMessage(id, { kind: 'error', text: `${settings.name} declined to answer that.` });
      } else {
        updateMessage(id, { kind: 'ai', text: (result.text || '(no answer)') + usageNote(result.usage) });
      }
      const gaveSolution = mode === 'solution' || result.gaveSolution;
      ifActive((attemptId) => {
        recordAi(ctx.db, attemptId, { log: result.log, usage: result.usage }, { idleMs });
        if (gaveSolution) markViewedSolution(ctx.db, attemptId);
      });
      updatePractice((p) => ({
        ...p,
        solutionShown: p.solutionShown || gaveSolution,
        chat: [...p.chat, { role: 'user', text: question }, { role: 'assistant', text: result.text }].slice(-20),
      }));
    } catch (error) {
      clearTimeout(timer);
      if (error.code === 'aborted') updateMessage(id, { kind: 'ai', text: `${text}${text ? '\n\n' : ''}(stopped)` });
      else updateMessage(id, { kind: 'error', text: error.message });
    }
  }

  function chooseSolution(choice) {
    setConfirming(false);
    if (choice === 'hint') return nextHint();
    if (choice === 'cancel') return say('No solution, then. You can do this.');
    const question = solutionQuestion.current;
    withAi((signal) => stream(signal, { mode: 'solution', question }));
  }

  function newChat() {
    if (!practiceRef.current) return say(NEED_PROBLEM);
    updatePractice((p) => ({ ...p, chat: [], solutionShown: false }));
    say('Started a fresh chat. Your hints so far still count.');
  }

  function stop() {
    abortRef.current?.abort();
    setConfirming(false);
  }

  return { settings, busy, confirming, nextHint, ask, chooseSolution, newChat, stop };
}
