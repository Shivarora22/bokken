import { Box, Text, useInput, usePaste } from 'ink';
import { useReducer, useRef, useState } from 'react';

export function Rule({ width, title, focused = false }) {
  if (!title) return <Text dimColor>{'─'.repeat(Math.max(0, width))}</Text>;
  const label = ` ${title} `;
  return (
    <Text>
      <Text dimColor>─</Text>
      <Text bold={focused} color={focused ? 'cyan' : undefined} dimColor={!focused}>
        {label}
      </Text>
      <Text dimColor>{'─'.repeat(Math.max(0, width - label.length - 1))}</Text>
    </Text>
  );
}

/** A window of `height` lines starting at `offset`. */
export function ScrollBox({ lines, height, offset }) {
  const start = clampOffset(offset, lines.length, height);
  const visible = lines.slice(start, start + height);
  return (
    <Box flexDirection="column" height={height} overflow="hidden">
      {visible.map((line, index) => (
        <Text key={start + index} wrap="truncate-end">
          {line || ' '}
        </Text>
      ))}
    </Box>
  );
}

/** `null` means "stick to the end", for chat-like sections. */
export function clampOffset(offset, length, height) {
  const max = Math.max(0, length - height);
  return offset === null ? max : Math.min(Math.max(0, offset), max);
}

/**
 * The input line. It keeps its own state in a ref, so fast typing and pastes never lose
 * characters between renders. Up and down walk through `history`.
 */
export function TextInput({ onSubmit, onType, history = [], placeholder = '', initialValue = '', isActive = true, prompt = '> ' }) {
  const state = useRef({ value: initialValue, cursor: initialValue.length, back: 0 });
  const [, rerender] = useReducer((n) => n + 1, 0);

  const set = (value, cursor = value.length) => {
    state.current.value = value;
    state.current.cursor = cursor;
    rerender();
  };
  const insert = (text) => {
    const { value, cursor } = state.current;
    set(value.slice(0, cursor) + text + value.slice(cursor), cursor + text.length);
    onType?.();
  };
  const walkHistory = (step) => {
    const back = Math.min(history.length, Math.max(0, state.current.back + step));
    state.current.back = back;
    set(back === 0 ? '' : history[history.length - back]);
  };

  useInput(
    (input, key) => {
      const { value, cursor } = state.current;
      if (key.return) {
        state.current.back = 0;
        set('');
        onSubmit(value);
      } else if (key.leftArrow) {
        set(value, Math.max(0, cursor - 1));
      } else if (key.rightArrow) {
        set(value, Math.min(value.length, cursor + 1));
      } else if (key.home) {
        set(value, 0);
      } else if (key.end) {
        set(value, value.length);
      } else if (key.upArrow) {
        walkHistory(1);
      } else if (key.downArrow) {
        walkHistory(-1);
      } else if (key.backspace || key.delete) {
        if (cursor > 0) set(value.slice(0, cursor - 1) + value.slice(cursor), cursor - 1);
      } else if (key.ctrl && input === 'u') {
        set('');
      } else if (input && !key.ctrl && !key.meta && !key.tab && !key.escape && !key.pageUp && !key.pageDown) {
        insert(input.replace(/[\r\n]+/g, ' '));
      }
    },
    { isActive },
  );
  usePaste((text) => insert(text.replace(/[\r\n]+/g, ' ')), { isActive });

  const { value, cursor } = state.current;
  return (
    <Text>
      <Text color="cyan">{prompt}</Text>
      {value.length === 0 ? (
        <>
          {isActive && <Text inverse> </Text>}
          <Text dimColor>{placeholder}</Text>
        </>
      ) : (
        <>
          {value.slice(0, cursor)}
          {isActive ? <Text inverse>{value[cursor] ?? ' '}</Text> : value[cursor]}
          {value.slice(cursor + 1)}
        </>
      )}
    </Text>
  );
}

/** A list to pick from with the arrow keys and Enter. */
export function Select({ items, initial, onSelect, isActive = true, maxVisible = 8 }) {
  const [index, setIndex] = useState(() => Math.max(0, items.findIndex((item) => item.value === initial)));
  useInput(
    (_input, key) => {
      if (key.upArrow) setIndex((i) => (i - 1 + items.length) % items.length);
      else if (key.downArrow) setIndex((i) => (i + 1) % items.length);
      else if (key.return) onSelect(items[index].value);
    },
    { isActive },
  );

  const start = Math.min(Math.max(0, index - Math.floor(maxVisible / 2)), Math.max(0, items.length - maxVisible));
  return (
    <Box flexDirection="column">
      {items.slice(start, start + maxVisible).map((item, offset) => {
        const selected = start + offset === index;
        return (
          <Text key={item.value}>
            <Text color={selected ? 'cyan' : undefined}>{selected ? '› ' : '  '}</Text>
            <Text bold={selected}>{item.label}</Text>
            {item.hint && <Text dimColor>  {item.hint}</Text>}
          </Text>
        );
      })}
    </Box>
  );
}
