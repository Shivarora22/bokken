// Records real LeetCode responses into test/fixtures/ for the tests to replay.
// Run it when the API changes: `npm run record`. It sends eight requests.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createClient, DAILY, PROBLEM_LIST_PATH, QUESTION, SEARCH, TOPIC_PAGE_SIZE, TOPIC_PROBLEMS, USER_STATUS } from '../src/leetcode.js';

const dir = new URL('../test/fixtures/', import.meta.url);
mkdirSync(dir, { recursive: true });

let lastBody;
const client = createClient({
  fetch: async (url, init) => {
    const response = await fetch(url, init);
    lastBody = await response.clone().json();
    return response;
  },
});

function save(name, body) {
  writeFileSync(new URL(name, dir), JSON.stringify(body, null, 2) + '\n');
  console.log(`saved test/fixtures/${name}`);
}

// The full list is about 2 MB; keep a few problems with different shapes.
const KEEP = new Set([1, 2, 4, 253]);
await client.getJson(PROBLEM_LIST_PATH);
save('problem-list.json', { ...lastBody, stat_status_pairs: lastBody.stat_status_pairs.filter((pair) => KEEP.has(pair.stat.frontend_question_id)) });
console.log(`  (kept ${KEEP.size} of ${lastBody.stat_status_pairs.length} problems)`);

const { activeDailyCodingChallengeQuestion: daily } = await client.graphql('daily', DAILY);
save('daily.json', lastBody);

await client.graphql('question', QUESTION, { titleSlug: 'two-sum' });
save('question-two-sum.json', lastBody);

await client.graphql('question', QUESTION, { titleSlug: daily.question.titleSlug });
save('question-daily.json', lastBody);

await client.graphql('question', QUESTION, { titleSlug: 'meeting-rooms' });
save('question-paid.json', lastBody);

await client.graphql('search', SEARCH, { keywords: 'two sum' });
save('search-two-sum.json', lastBody);

await client.graphql('userStatus', USER_STATUS);
save('user-status-anonymous.json', lastBody);

// The first page of a topic; keep a few problems with different topics.
const IN_TOPIC = new Set(['longest-palindromic-substring', 'climbing-stairs', 'house-robber', 'coin-change']);
await client.graphql('topicProblems', TOPIC_PROBLEMS, { tags: ['dynamic-programming'], limit: TOPIC_PAGE_SIZE, skip: 0 });
const { questionList } = lastBody.data;
save('topic-dynamic-programming.json', { data: { questionList: { ...questionList, data: questionList.data.filter((q) => IN_TOPIC.has(q.titleSlug)) } } });
