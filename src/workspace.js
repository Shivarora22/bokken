import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { LANGUAGES, solutionFile } from './languages.js';
import { htmlToMarkdown } from './markdown.js';

export function problemDir(workspace, problem) {
  return path.join(workspace, `${problem.frontendId}-${problem.slug}`);
}

/**
 * Creates the problem's folder: `.bokken.json`, `problem.md`, and a solution file in
 * `langSlug`. An existing solution file is never overwritten; another language adds a file.
 *
 * @returns {{ dir: string, file: string, created: boolean, modifiedAt: Date }}
 */
export function prepareProblem(workspace, problem, langSlug) {
  if (problem.paidOnly && !problem.content) {
    throw new Error(`${problem.frontendId}. ${problem.title} is a LeetCode Premium problem. Practicing it needs a Premium login, which comes in a later version.`);
  }
  const language = LANGUAGES[langSlug];
  const text = solutionFile(problem, langSlug);
  if (!text) {
    const available = problem.snippets.map((s) => LANGUAGES[s.langSlug]?.name ?? s.lang).join(', ');
    throw new Error(`This problem has no ${language?.name ?? langSlug} starter code. It has: ${available || 'none'}.`);
  }

  const dir = problemDir(workspace, problem);
  mkdirSync(dir, { recursive: true });
  const meta = { frontendId: problem.frontendId, questionId: problem.questionId, slug: problem.slug };
  writeFileSync(path.join(dir, '.bokken.json'), JSON.stringify(meta, null, 2) + '\n');
  writeIfMissing(path.join(dir, 'problem.md'), problemMarkdown(problem));

  const file = path.join(dir, `solution.${language.ext}`);
  const created = writeIfMissing(file, text);
  return { dir, file, created, modifiedAt: statSync(file).mtime };
}

export function problemMarkdown(problem) {
  const topics = problem.topics.map((topic) => topic.name).join(', ');
  const details = [problem.difficulty, topics, problem.url].filter(Boolean).join(' · ');
  return `# ${problem.frontendId}. ${problem.title}\n\n${details}\n\n${htmlToMarkdown(problem.content)}\n`;
}

function writeIfMissing(file, text) {
  try {
    writeFileSync(file, text, { flag: 'wx' });
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
}
