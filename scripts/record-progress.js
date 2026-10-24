// Records the problem list as LeetCode sends it to a logged-in user, with your solved and
// tried problems marked, into test/fixtures/problem-list-signed-in.json. One request.
//
//   node scripts/record-progress.js ~/.bokken/credentials.json
//
// The session is read from that file and never printed or saved; your username is replaced.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createClient, PROBLEM_LIST_PATH } from '../src/leetcode.js';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/record-progress.js <credentials.json>');
  process.exit(2);
}
const session = JSON.parse(readFileSync(file, 'utf8')).leetcode?.session;
if (!session) {
  console.error(`No LeetCode session in ${file}. Log in with: bokken login`);
  process.exit(1);
}

const list = await createClient({ session }).getJson(PROBLEM_LIST_PATH);
if (!list.user_name) {
  console.error('LeetCode sent the list logged out: that session has expired. Log in again with: bokken login');
  process.exit(1);
}

// The full list is about 2 MB. Keep the ones the tests use, plus a couple you solved and tried.
const keep = new Set([1, 2, 4, 253]);
for (const status of ['ac', 'notac']) {
  for (const pair of list.stat_status_pairs.filter((p) => p.status === status).slice(0, 2)) keep.add(pair.stat.frontend_question_id);
}
const trimmed = { ...list, stat_status_pairs: list.stat_status_pairs.filter((p) => keep.has(p.stat.frontend_question_id)) };
const text = JSON.stringify(trimmed, null, 2).split(session).join('<session>').split(list.user_name).join('someone');

const dir = new URL('../test/fixtures/', import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL('problem-list-signed-in.json', dir), text + '\n');
console.log(`Saved test/fixtures/problem-list-signed-in.json (${trimmed.stat_status_pairs.length} of ${list.stat_status_pairs.length} problems).`);
