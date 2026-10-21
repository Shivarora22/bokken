// Live check against the real LeetCode API: `npm run smoke`. Uses a throwaway in-memory database.
import { openDb } from '../src/db.js';
import { createClient, getDaily, getProblem, lookupProblem } from '../src/leetcode.js';
import { htmlToMarkdown } from '../src/markdown.js';

try {
  const db = await openDb(':memory:');
  const client = createClient();

  const daily = await getDaily(client);
  console.log(`Today (${daily.date}): ${daily.frontendId}. ${daily.title} [${daily.difficulty}]`);

  const first = await lookupProblem(db, client, '1');
  const { count } = db.prepare('SELECT count(*) AS count FROM catalog').get();
  console.log(`Problem list: ${count} problems. #1 is "${first.slug}".`);

  const problem = await getProblem(db, client, first.slug);
  const topics = problem.topics.map((topic) => topic.name).join(', ');
  console.log(`${problem.frontendId}. ${problem.title} [${problem.difficulty}] · ${topics} · ${problem.hints.length} hints · ${problem.snippets.length} languages\n`);
  console.log(htmlToMarkdown(problem.content).split('\n').slice(0, 12).join('\n'));
  console.log('\nSmoke check passed.');
} catch (error) {
  console.error(`Smoke check failed: ${error.message}`);
  process.exitCode = 1;
}
