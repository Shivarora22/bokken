// What LeetCode's Run and Submit results mean: the Markdown the Notifications panel shows,
// a short summary for the coach (`lastResult`), and what a submission stores.
//
// A Run's status_msg says "Accepted" whenever the code ran without crashing, even when the
// answers are wrong. Whether they match is in correct_answer and compare_result (one digit
// per case, 1 = passed). Python reports a syntax error as a Runtime Error, since it has no
// compile step.

const NOT_GIVEN = 'N/A';
// How many failing cases the coach is told about.
const COACH_CASES = 2;

/**
 * @param {object} result  the `check` response of a Run
 * @param {{ problem: { metaData?: { params?: { name: string }[] } }, input: string }} sent
 * @returns {{ ok: boolean, text: string, forCoach: string }}
 */
export function runReport(result, { problem, input }) {
  if (!result.run_success) return errorReport('Run', result, problem);

  const total = Number(result.total_testcases) || 0;
  const passed = Number(result.total_correct) || 0;
  const ok = result.correct_answer === true;
  const inputs = splitCases(input, params(problem), total);
  // The answer lists end with an extra "".
  const yours = (result.code_answer ?? []).slice(0, total);
  const expected = (result.expected_code_answer ?? []).slice(0, total);
  const printed = (result.std_output_list ?? []).slice(0, total);
  const outcomes = String(result.compare_result ?? '');
  const cases = Array.from({ length: total }, (_, i) => ({
    n: i + 1,
    ok: outcomes[i] === '1',
    input: inputs[i],
    output: yours[i],
    expected: expected[i],
    printed: printed[i],
  }));

  const runtime = given(result.status_runtime);
  const heading = ok ? `**✓ Run: all ${total} examples passed**${runtime ? ` · ${runtime}` : ''}` : `**✗ Run: ${passed} of ${total} examples passed**`;
  const marks = cases.map((c) => `Case ${c.n} ${c.ok ? '✓' : '✗'}`).join(' · ');
  // Every failing case, and any case that printed something.
  const details = cases
    .filter((c) => !c.ok || c.printed)
    .map((c) => `Case ${c.n} ${c.ok ? '✓' : '✗'}\n\n${block([['Input', c.input], ['Output', c.output], ['Expected', c.expected], ['Printed', c.printed]])}`);
  const text = [heading, marks, ...details].join('\n\n');

  const failing = cases.filter((c) => !c.ok).slice(0, COACH_CASES);
  const forCoach = ok
    ? `Run on the examples: all ${total} passed.`
    : [
        `Run on the examples: ${passed} of ${total} passed.`,
        ...failing.map((c) => `Case ${c.n} failed. ${sentence([['Input', c.input], ['Output', c.output], ['Expected', c.expected]])}`),
      ].join(' ');
  return { ok, text, forCoach };
}

/**
 * @param {object} result  the `check` response of a Submit
 * @param {{ metaData?: { params?: { name: string }[] } }} problem
 * @returns {{ accepted: boolean, text: string, forCoach: string, row: { status: string, runtime: string | null, memory: string | null, remoteId: string } }}
 */
export function submitReport(result, problem) {
  const status = result.status_msg ?? 'Unknown result';
  const accepted = status === 'Accepted';
  const row = { status, runtime: given(result.status_runtime), memory: given(result.status_memory), remoteId: String(result.submission_id) };
  if (!accepted) return { accepted, row, ...errorReport('Submit', result, problem) };

  const total = Number(result.total_testcases) || 0;
  const speed = [
    row.runtime && `Runtime ${row.runtime}${beats(result.runtime_percentile)}`,
    row.memory && `Memory ${row.memory}${beats(result.memory_percentile)}`,
  ].filter(Boolean);
  const text = [`**✓ Accepted** · all ${total} tests passed`, ...(speed.length ? [speed.join(' · ')] : [])].join('\n\n');
  return { accepted, row, text, forCoach: `Submitted: Accepted, all ${total} tests passed.` };
}

// A Run that didn't run, or a Submit that wasn't accepted: what failed, and on which input.
function errorReport(kind, result, problem) {
  const status = result.status_msg ?? 'Unknown result';
  const total = Number(result.total_testcases) || 0;
  const passed = Number(result.total_correct) || 0;
  const tests = kind === 'Submit' && total ? ` · ${passed} of ${total} tests passed` : '';
  const error = result.full_compile_error || result.compile_error || result.full_runtime_error || result.runtime_error || '';
  const lastInput = result.last_testcase ? formatInput(result.last_testcase.split('\n'), params(problem)) : '';
  // A Submit's outputs are text; a Run's are lists, often empty.
  const rows = [
    ['Input', lastInput],
    ['Output', asText(result.code_output)],
    ['Expected', asText(result.expected_output)],
    ['Printed', asText(result.std_output) || asText(result.std_output_list)],
  ];
  const text = [`**✗ ${kind}: ${status}**${tests}`, ...(error ? [block([['', error]])] : []), ...(rows.some(([, v]) => v) ? [block(rows)] : [])].join('\n\n');

  const shortError = result.compile_error || result.runtime_error || '';
  const forCoach = [
    `${kind === 'Run' ? 'Run on the examples' : 'Submitted'}: ${status}${tests ? `, ${passed} of ${total} tests passed` : ''}.`,
    shortError && `Error: ${shortError}.`,
    sentence(rows.slice(0, 3)),
  ]
    .filter(Boolean)
    .join(' ');
  return { ok: false, text, forCoach };
}

// --- Formatting ------------------------------------------------------------

const params = (problem) => problem?.metaData?.params ?? null;

const given = (value) => (value && value !== NOT_GIVEN ? value : null);

const asText = (value) => (Array.isArray(value) ? value.filter(Boolean).join('\n') : (value ?? ''));

const beats = (percentile) => (typeof percentile === 'number' ? `, beats ${percentile.toFixed(1)}%` : '');

/** One case's input lines → "nums = [3,2,4], target = 6" (or just the values, without names). */
export function formatInput(lines, names) {
  if (names && names.length === lines.length) return names.map((p, i) => `${p.name} = ${lines[i]}`).join(', ');
  return lines.join(', ');
}

// The examples are one line per parameter, case after case. Design and SQL problems have no
// parameter list, so the lines are shared out evenly instead; [] when they don't divide.
function splitCases(input, names, total) {
  const lines = String(input ?? '').split('\n');
  const per = names?.length || (total ? lines.length / total : 0);
  if (!per || !Number.isInteger(per) || lines.length !== per * total) return [];
  return Array.from({ length: total }, (_, i) => formatInput(lines.slice(i * per, (i + 1) * per), names));
}

// Labelled values in a code block, so they keep their lines; empty values are left out.
function block(rows) {
  const filled = rows.filter(([, value]) => value);
  const width = Math.max(0, ...filled.map(([label]) => label.length));
  const lines = filled.map(([label, value]) => {
    const pad = label ? `${label.padEnd(width)}  ` : '';
    return String(value)
      .split('\n')
      .map((line, i) => (i ? ' '.repeat(pad.length) : pad) + line)
      .join('\n');
  });
  return '```\n' + lines.join('\n') + '\n```';
}

function sentence(rows) {
  return rows
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${String(value).replace(/\s*\n\s*/g, ' ')}.`)
    .join(' ');
}
