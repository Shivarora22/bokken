// Records LeetCode's Run and Submit responses into test/fixtures/ for the tests to replay.
// It needs a login, and it makes 2 real submissions of Two Sum (one Accepted, one Wrong
// Answer) that show up in your LeetCode history. The 2 Runs don't show up anywhere.
//
//   node scripts/record-judge.js ~/.bokken/credentials.json
//
// The session is read from that file and never printed or saved.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createClient, signedInUser } from '../src/leetcode.js';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/record-judge.js <credentials.json>');
  process.exit(2);
}
const session = JSON.parse(readFileSync(file, 'utf8')).leetcode?.session;
if (!session) {
  console.error(`No LeetCode session in ${file}. Log in with: bokken login`);
  process.exit(1);
}

const dir = new URL('../test/fixtures/', import.meta.url);
mkdirSync(dir, { recursive: true });
const client = createClient({ session });
const username = await signedInUser(client);
if (!username) {
  console.error('LeetCode says that session is signed out. Log in again with: bokken login');
  process.exit(1);
}
console.log('Signed in.');

// Responses are saved with the username replaced, in case one mentions it.
function save(name, body) {
  const text = JSON.stringify(body, null, 2).split(username).join('someone').split(session).join('<session>');
  writeFileSync(new URL(name, dir), text + '\n');
  console.log(`  saved test/fixtures/${name}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const REFERER = 'https://leetcode.com/problems/two-sum/';
const EXAMPLES = '[2,7,11,15]\n9\n[3,2,4]\n6\n[3,3]\n6';
const header = '    def twoSum(self, nums: List[int], target: int) -> List[int]';
const CODE = {
  correct: `class Solution:\n${header}:\n        seen = {}\n        for i, n in enumerate(nums):\n            if target - n in seen:\n                return [seen[target - n], i]\n            seen[n] = i\n`,
  wrong: `class Solution:\n${header}:\n        return [0, 1]\n`,
  // No colon after the def. Python has no compile step, so LeetCode calls this a Runtime Error.
  broken: `class Solution:\n${header}\n        return [0, 1]\n`,
};

let savedPending = false;
async function waitForResult(id) {
  const states = [];
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const result = await client.getJson(`/submissions/detail/${id}/check/`);
    states.push(result.state);
    if (result.state === 'SUCCESS') {
      console.log(`  ${states.join(' → ')}`);
      return result;
    }
    if (!savedPending) {
      save('check-pending.json', result);
      savedPending = true;
    }
  }
  throw new Error(`no result after 30 seconds (${states.join(' → ')})`);
}

async function step(label, expected, name, send) {
  console.log(`\n${label}`);
  try {
    const result = await send();
    const verdict = result.status_msg;
    console.log(`  → ${verdict}${verdict === expected ? '' : `  (expected ${expected})`}`);
    save(name, result);
  } catch (error) {
    console.log(`  ✗ ${error.message}`);
  }
}

const submit = (code, start) => async () => {
  const started = await client.postJson('/problems/two-sum/submit/', { lang: 'python3', question_id: '1', typed_code: code }, { referer: REFERER });
  if (start) save('submit-two-sum.json', started);
  if (!started.submission_id) throw new Error(`no submission_id in ${JSON.stringify(started)}`);
  return waitForResult(started.submission_id);
};

const run = (code) => async () => {
  const started = await client.postJson(
    '/problems/two-sum/interpret_solution/',
    { lang: 'python3', question_id: '1', typed_code: code, data_input: EXAMPLES },
    { referer: REFERER },
  );
  if (!started.interpret_id) throw new Error(`no interpret_id in ${JSON.stringify(started)}`);
  return waitForResult(started.interpret_id);
};

// LeetCode may refuse code sent too quickly in a row, hence the pauses.
await step('Submit: correct code', 'Accepted', 'submit-check-accepted.json', submit(CODE.correct, true));
await sleep(5000);
await step('Submit: wrong code', 'Wrong Answer', 'submit-check-wrong-answer.json', submit(CODE.wrong));
await sleep(5000);
await step('Run: wrong code', 'Wrong Answer', 'run-check-wrong-answer.json', run(CODE.wrong));
await sleep(5000);
await step('Run: Python with a syntax error', 'Runtime Error', 'run-check-runtime-error.json', run(CODE.broken));
console.log('\nDone.');
