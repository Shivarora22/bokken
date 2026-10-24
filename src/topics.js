// LeetCode's topics: their names, the short names you can type, and the core ones /next
// starts you on. A topic's slug is its name in lowercase with dashes ("Heap (Priority Queue)"
// → heap-priority-queue). LeetCode adds topics now and then; ones bokken has seen on a problem
// (problem_topics) work too.

const NAMES = [
  'Array', 'String', 'Hash Table', 'Dynamic Programming', 'Math', 'Sorting', 'Greedy', 'Depth-First Search',
  'Binary Search', 'Database', 'Matrix', 'Tree', 'Breadth-First Search', 'Bit Manipulation', 'Two Pointers',
  'Prefix Sum', 'Heap (Priority Queue)', 'Simulation', 'Binary Tree', 'Graph', 'Counting', 'Sliding Window',
  'Stack', 'Enumeration', 'Design', 'Backtracking', 'Union Find', 'Number Theory', 'Linked List', 'Ordered Set',
  'Monotonic Stack', 'Segment Tree', 'Trie', 'Combinatorics', 'Bitmask', 'Divide and Conquer', 'Queue',
  'Recursion', 'Geometry', 'Binary Indexed Tree', 'Memoization', 'Hash Function', 'Binary Search Tree',
  'Shortest Path', 'String Matching', 'Topological Sort', 'Rolling Hash', 'Game Theory', 'Interactive',
  'Data Stream', 'Monotonic Queue', 'Brainteaser', 'Doubly-Linked List', 'Randomized', 'Merge Sort',
  'Counting Sort', 'Iterator', 'Concurrency', 'Probability and Statistics', 'Quickselect', 'Suffix Array',
  'Line Sweep', 'Minimum Spanning Tree', 'Bucket Sort', 'Shell', 'Reservoir Sampling',
  'Strongly Connected Component', 'Eulerian Circuit', 'Radix Sort', 'Rejection Sampling', 'Biconnected Component',
];

const ALIASES = {
  dp: 'dynamic-programming',
  hash: 'hash-table',
  hashmap: 'hash-table',
  heap: 'heap-priority-queue',
  'priority queue': 'heap-priority-queue',
  dfs: 'depth-first-search',
  bfs: 'breadth-first-search',
  bst: 'binary-search-tree',
  dsu: 'union-find',
  graphs: 'graph',
  trees: 'tree',
  strings: 'string',
  arrays: 'array',
  bits: 'bit-manipulation',
  'linked lists': 'linked-list',
};

/**
 * The topics /next works through, in order, before it has enough of your attempts to rank
 * them: the usual interview path, from arrays to dynamic programming.
 */
export const CORE_TOPICS = [
  'array', 'string', 'hash-table', 'two-pointers', 'sliding-window', 'stack', 'binary-search', 'linked-list',
  'tree', 'binary-tree', 'heap-priority-queue', 'depth-first-search', 'breadth-first-search', 'graph',
  'backtracking', 'greedy', 'dynamic-programming',
];

export function topicSlug(name) {
  return name.toLowerCase().replace(/[()]/g, '').trim().replace(/\s+/g, '-');
}

const KNOWN = new Map(NAMES.map((name) => [topicSlug(name), name]));

/** A topic's name from its slug: LeetCode's name when bokken knows it. */
export function topicName(db, slug) {
  return KNOWN.get(slug) ?? db.prepare('SELECT topic_name FROM problem_topics WHERE topic_slug = ? LIMIT 1').get(slug)?.topic_name ?? slug;
}

/**
 * The topic you meant: "dp", "Dynamic Programming", "dynamic-programming", or the start of a
 * name ("monotonic" when only one topic starts with it). Null when nothing matches.
 *
 * @returns {{ slug: string, name: string } | null}
 */
export function findTopic(db, text) {
  const wanted = text.toLowerCase().trim().replace(/\s+/g, ' ');
  if (!wanted) return null;
  const topics = new Map(KNOWN);
  for (const row of db.prepare('SELECT DISTINCT topic_slug, topic_name FROM problem_topics').all()) {
    if (!topics.has(row.topic_slug)) topics.set(row.topic_slug, row.topic_name);
  }
  const found = (slug) => ({ slug, name: topics.get(slug) });

  if (ALIASES[wanted]) return found(ALIASES[wanted]);
  const slug = topicSlug(wanted);
  if (topics.has(slug)) return found(slug);
  const starting = [...topics].filter(([, name]) => name.toLowerCase().startsWith(wanted));
  return starting.length === 1 ? found(starting[0][0]) : null;
}
