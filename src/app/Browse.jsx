import { Box, Text, useInput } from 'ink';
import { Rule, Select } from './components.jsx';

const MORE = '\0more';
const STATUS = { solved: '✓ solved', tried: 'tried' };

/**
 * `/browse`: the problems that match, to pick from. Typing narrows the list, Enter opens one,
 * Esc goes back. With a topic that has more on LeetCode, the last item fetches its next page.
 *
 * `list` is `{ title, problems, topic, initial, loading }`.
 */
export function Browse({ width, height, list, onOpen, onLoadMore, onCancel }) {
  useInput((input, key) => {
    if (key.escape) onCancel();
  });

  const { problems, topic } = list;
  const items = problems.map((p) => ({
    value: p.slug,
    label: `${String(p.frontendId).padStart(4)}. ${p.title}`,
    hint: [p.difficulty, p.acRate === null ? null : `${Math.round(p.acRate)}% accepted`, STATUS[p.status]].filter(Boolean).join(' · '),
  }));
  if (topic && topic.nextPage !== null) {
    items.push({ value: MORE, label: '      Load more from LeetCode', hint: `${topic.fetched} of its ${topic.total} ${topic.name} problems so far` });
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Box paddingX={1}>
        <Text wrap="truncate-end">
          <Text bold>Browse</Text>
          <Text dimColor>
            {'  '}
            {list.title}
            {list.loading ? '' : ` · ${problems.length} ${problems.length === 1 ? 'problem' : 'problems'}`}
          </Text>
        </Text>
      </Box>
      <Rule width={width} />
      <Box flexDirection="column" paddingX={1} paddingTop={1} flexGrow={1}>
        {list.loading ? (
          <Text dimColor>… {list.loading}</Text>
        ) : items.length ? (
          <Select
            key={list.initial ?? ''}
            items={items}
            initial={list.initial}
            filterable
            maxVisible={Math.max(3, height - 6)}
            onSelect={(value) => (value === MORE ? onLoadMore() : onOpen(value))}
          />
        ) : (
          <Text dimColor>No problems match. Esc goes back.</Text>
        )}
      </Box>
      <Rule width={width} />
      <Box paddingX={1}>
        <Text dimColor wrap="truncate-end">
          ↑↓ move · Enter opens it · type to narrow the list · Esc back
        </Text>
      </Box>
    </Box>
  );
}
