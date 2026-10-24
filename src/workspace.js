import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { LANGUAGES, solutionFile } from './languages.js';

export function problemDir(workspace, problem) {
  return path.join(workspace, `${problem.frontendId}-${problem.slug}`);
}

/**
 * Creates the problem's folder: `.bokken.json` and a solution file in `langSlug`. An existing
 * solution file is never overwritten; another language adds a file. The problem text isn't
 * written: it's LeetCode's copyrighted content, and the folder is meant to be pushed to GitHub.
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

  const file = path.join(dir, `solution.${language.ext}`);
  const created = writeIfMissing(file, text);
  return { dir, file, created, modifiedAt: statSync(file).mtime };
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
