// LeetCode's langSlug → how bokken writes a solution file. `before` goes above the markers:
// what the file needs to compile or lint on your machine, which LeetCode doesn't want.
export const LANGUAGES = {
  python3: { name: 'Python 3', ext: 'py', comment: '#', before: 'from typing import List, Optional' },
  cpp: { name: 'C++', ext: 'cpp', comment: '//', before: '#include <bits/stdc++.h>\nusing namespace std;' },
  java: { name: 'Java', ext: 'java', comment: '//', before: 'import java.util.*;' },
  javascript: { name: 'JavaScript', ext: 'js', comment: '//' },
  typescript: { name: 'TypeScript', ext: 'ts', comment: '//' },
  golang: { name: 'Go', ext: 'go', comment: '//', before: 'package main' },
  rust: { name: 'Rust', ext: 'rs', comment: '//', before: 'struct Solution;' },
  csharp: { name: 'C#', ext: 'cs', comment: '//', before: 'using System;\nusing System.Collections.Generic;' },
  kotlin: { name: 'Kotlin', ext: 'kt', comment: '//' },
  swift: { name: 'Swift', ext: 'swift', comment: '//' },
  c: { name: 'C', ext: 'c', comment: '//', before: '#include <stdbool.h>\n#include <stdlib.h>' },
  ruby: { name: 'Ruby', ext: 'rb', comment: '#' },
  php: { name: 'PHP', ext: 'php', comment: '//', first: '<?php' },
  scala: { name: 'Scala', ext: 'scala', comment: '//' },
  dart: { name: 'Dart', ext: 'dart', comment: '//' },
  elixir: { name: 'Elixir', ext: 'ex', comment: '#' },
  erlang: { name: 'Erlang', ext: 'erl', comment: '%' },
  racket: { name: 'Racket', ext: 'rkt', comment: ';', first: '#lang racket' },
  python: { name: 'Python 2', ext: 'py', comment: '#' },
  mysql: { name: 'MySQL', ext: 'sql', comment: '--' },
  postgresql: { name: 'PostgreSQL', ext: 'sql', comment: '--' },
  pythondata: { name: 'Pandas', ext: 'py', comment: '#', before: 'import pandas as pd' },
  bash: { name: 'Bash', ext: 'sh', comment: '#' },
};

// The choices setup offers, most used first.
export const SETUP_LANGUAGES = ['python3', 'cpp', 'java', 'javascript', 'typescript', 'golang', 'rust', 'csharp', 'kotlin', 'swift', 'c', 'ruby', 'php', 'scala', 'dart'];

/** The starting solution file for a problem, or null when LeetCode has no starter code in that language. */
export function solutionFile(problem, langSlug) {
  const language = LANGUAGES[langSlug];
  const snippet = problem.snippets.find((s) => s.langSlug === langSlug);
  if (!language || !snippet) return null;

  let code = snippet.code.replace(/\r\n/g, '\n').trimEnd();
  if (language.ext === 'py') code = fillEmptyPythonBodies(code);
  const { comment } = language;
  const lines = [
    ...(language.first ? [language.first] : []),
    `${comment} ${problem.frontendId}. ${problem.title} [${problem.difficulty}] · ${problem.url}`,
    '',
    ...(language.before ? [language.before, ''] : []),
    `${comment} @bokken code=start`,
    code,
    `${comment} @bokken code=end`,
  ];
  return lines.join('\n') + '\n';
}

/** The code between the markers: what gets submitted. Null when a marker is missing. */
export function extractCode(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((line) => line.includes('@bokken code=start'));
  const end = lines.findIndex((line, index) => index > start && line.includes('@bokken code=end'));
  if (start === -1 || end === -1) return null;
  return lines.slice(start + 1, end).join('\n');
}

// LeetCode's Python starter code leaves method bodies empty, which isn't valid Python.
function fillEmptyPythonBodies(code) {
  const lines = code.split('\n');
  const indent = (line) => line.match(/^\s*/)[0].length;
  const result = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    result.push(line.trimEnd());
    if (!/^\s*def .*:\s*$/.test(line)) continue;
    const next = lines.slice(i + 1).find((l) => l.trim() !== '');
    if (next !== undefined && indent(next) > indent(line)) continue;
    result.push(`${' '.repeat(indent(line) + 4)}pass`);
    // LeetCode's body placeholder is an indented empty line; the pass replaces it.
    if (/^\s+$/.test(lines[i + 1] ?? '')) i++;
  }
  return result.join('\n');
}
