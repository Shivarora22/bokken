import { readFileSync } from 'node:fs';
import path from 'node:path';
import { useRef, useState } from 'react';
import { extractCode } from '../languages.js';
import { startRun, startSubmit, waitForResult } from '../leetcode.js';
import { recordRun, recordSubmission } from '../tracking.js';
import { runReport, submitReport } from '../verdicts.js';
import { tildePath } from './practice.js';
import { NEED_PROBLEM } from './usePractice.js';

/**
 * `/run` and `/submit`: the code between the markers in your attempt's file, run or judged
 * on LeetCode. Results and their errors go to Notifications, like every message that isn't
 * the coach's; the coach gets a summary as `lastResult`. `ctx.pollMs` sets how often the
 * result is asked for (tests).
 */
export function useJudge({ ctx, practice, idleMs }) {
  // 'run' | 'submit' while waiting for LeetCode.
  const [busy, setBusy] = useState(null);
  const controller = useRef(null);

  async function judge(kind) {
    const p = practice.practiceRef.current;
    if (!p) return practice.say(NEED_PROBLEM);
    if (controller.current) return practice.say('Still waiting for LeetCode. Esc stops waiting.');
    if (!ctx.client.hasSession()) return practice.say(`${kind === 'run' ? 'Running' : 'Submitting'} your code needs a LeetCode login. Type /login.`, 'error');

    let text;
    try {
      text = readFileSync(p.file, 'utf8');
    } catch (error) {
      return practice.say(`Couldn't read ${tildePath(p.file)}: ${error.message}`, 'error');
    }
    const code = extractCode(text);
    if (code === null) {
      const name = path.basename(p.file);
      return practice.say(`Couldn't find the "@bokken code=start" and "@bokken code=end" lines in ${name}. Only the code between them is sent, so put them back around your solution.`, 'error');
    }

    const id = practice.say(kind === 'run' ? 'Running your code on the examples, on LeetCode…' : 'Submitting your code to LeetCode…', 'pending');
    const abort = new AbortController();
    controller.current = abort;
    setBusy(kind);
    try {
      const sent = { problem: p.problem, lang: p.lang, code };
      const jobId = kind === 'run' ? await startRun(ctx.client, sent) : await startSubmit(ctx.client, sent);
      const result = await waitForResult(ctx.client, jobId, { signal: abort.signal, intervalMs: ctx.pollMs });
      if (kind === 'run') finishRun(p, id, result);
      else finishSubmit(p, id, result);
    } catch (error) {
      if (!abort.signal.aborted) practice.updateMessage(id, { kind: 'error', text: error.message });
      else if (kind === 'run') practice.updateMessage(id, { kind: 'info', text: 'Stopped waiting for the run.' });
      else practice.updateMessage(id, { kind: 'info', text: "Stopped waiting. The submission still counts on LeetCode, but bokken won't record its result." });
    } finally {
      controller.current = null;
      setBusy(null);
    }
  }

  // The attempt may have changed while LeetCode worked; results belong to the one they ran for.
  const sameAttempt = (p) => practice.practiceRef.current?.attemptId === p.attemptId;
  const rememberForCoach = (p, summary) => practice.updatePractice((q) => (q.attemptId === p.attemptId ? { ...q, lastResult: summary } : q));

  function finishRun(p, id, result) {
    const report = runReport(result, { problem: p.problem, input: p.problem.exampleTestcases });
    practice.updateMessage(id, { kind: 'result', text: report.text });
    rememberForCoach(p, report.forCoach);
    if (sameAttempt(p) && !practice.practiceRef.current.done) recordRun(ctx.db, p.attemptId, { passed: report.ok, idleMs });
  }

  function finishSubmit(p, id, result) {
    const report = submitReport(result, p.problem);
    practice.updateMessage(id, { kind: 'result', text: report.text });
    rememberForCoach(p, report.forCoach);
    const solved = recordSubmission(ctx.db, p.attemptId, { slug: p.problem.slug, lang: p.lang, ...report.row, idleMs });
    if (solved && sameAttempt(p)) practice.say(practice.afterSolved(), 'success');
  }

  return {
    busy,
    run: () => judge('run'),
    submit: () => judge('submit'),
    /** Stops waiting; LeetCode still finishes the job. */
    stop: () => controller.current?.abort(),
  };
}
