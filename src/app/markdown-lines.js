import chalk from 'chalk';
import wrapAnsi from 'wrap-ansi';

/** Markdown (as `htmlToMarkdown` writes it) → styled terminal lines, wrapped to `width`. */
export function markdownLines(markdown, width) {
  width = Math.max(10, width);
  const lines = [];
  for (const block of parseBlocks(markdown ?? '')) {
    if (lines.length) lines.push('');
    lines.push(...renderBlock(block, width));
  }
  return lines;
}

/** Plain text wrapped to `width`, with an optional style for the whole thing. */
export function textLines(text, width, style = (s) => s) {
  return wrap(style(text), Math.max(10, width));
}

// AI answers put code fences where Markdown allows them: indented under a list item, with
// ~~~ instead of ```, or at the end of a sentence ("Here's the code: ```cpp").
const FENCE = /^(\s*)(`{3,}|~{3,})[\w+#.-]*\s*$/;
const FENCE_AFTER_TEXT = /^(.*\S)\s*(`{3,}|~{3,})[\w+#.-]*\s*$/;

function parseBlocks(markdown) {
  const blocks = [];
  let paragraph = null;

  const addLine = (line) => {
    if (line.trim() === '') {
      paragraph = null;
      return;
    }
    const heading = line.match(/^#{1,6}\s+(.*)/);
    const item = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)/);
    if (heading) {
      paragraph = null;
      blocks.push({ type: 'heading', text: heading[1] });
    } else if (item) {
      paragraph = { type: 'item', marker: /\d/.test(item[2]) ? item[2] : '•', indent: item[1].length, text: item[3] };
      blocks.push(paragraph);
    } else if (paragraph) {
      paragraph.text += ` ${line.trim()}`;
    } else {
      paragraph = { type: 'paragraph', text: line.trim() };
      blocks.push(paragraph);
    }
  };

  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    let fence = lines[i].match(FENCE);
    const afterText = !fence && lines[i].match(FENCE_AFTER_TEXT);
    if (afterText) {
      addLine(afterText[1]);
      fence = ['', '', afterText[2]];
    }
    if (!fence) {
      addLine(lines[i]);
      continue;
    }
    // Code lines lose the fence's indentation and keep their own. The block ends at a
    // matching fence, even one stuck to the last line of code; while an answer is still
    // streaming in, everything so far is code.
    paragraph = null;
    const [, indent, marker] = fence;
    const closer = new RegExp(`^(.*?)${marker[0] === '~' ? '~' : '`'}{${marker.length},}\\s*$`);
    const dedent = (line) => (line.startsWith(indent) ? line.slice(indent.length) : line.trimStart());
    const code = [];
    while (++i < lines.length) {
      const end = lines[i].match(closer);
      if (end) {
        if (end[1].trim()) code.push(dedent(end[1]));
        break;
      }
      code.push(dedent(lines[i]));
    }
    blocks.push({ type: 'code', lines: code });
  }
  // List items follow each other without blank lines between them.
  return blocks.map((block, index) => ({ ...block, tight: block.type === 'item' && blocks[index - 1]?.type === 'item' }));
}

function renderBlock(block, width) {
  switch (block.type) {
    case 'code':
      return block.lines.flatMap((line) => wrap(chalk.cyan(line), width - 2).map((part) => `  ${part}`));
    case 'heading':
      return wrap(chalk.bold(inline(block.text)), width);
    case 'item': {
      const prefix = `${' '.repeat(block.indent)}${block.marker} `;
      const [first, ...rest] = wrap(inline(block.text), width - prefix.length);
      return [prefix + first, ...rest.map((line) => ' '.repeat(prefix.length) + line)];
    }
    default:
      return wrap(inline(block.text), width);
  }
}

// Code spans are set aside while emphasis is found, so *a phrase with `code` in it* still works.
function inline(text) {
  const codes = [];
  return text
    .replace(/`([^`]+)`/g, (_, code) => `\u0000${codes.push(code) - 1}\u0000`)
    .replace(/\*\*\*(.+?)\*\*\*/g, (_, t) => chalk.bold.italic(t))
    .replace(/\*\*(.+?)\*\*/g, (_, t) => chalk.bold(t))
    .replace(/(^|[^\\*])\*([^*\s][^*]*?)\*/g, (_, before, t) => before + chalk.italic(t))
    .replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, '$1')
    .replace(/\u0000(\d+)\u0000/g, (_, i) => chalk.cyan(codes[Number(i)]));
}

// trim: false keeps the indentation inside code blocks, so the spaces left at each break
// go by hand, around any color codes.
function wrap(text, width) {
  return wrapAnsi(text, width, { hard: true, trim: false })
    .split('\n')
    .map((line, index) => {
      const trimmed = line.replace(/[ \t]+((?:\x1b\[[0-9;]*m)*)$/, '$1');
      return index === 0 ? trimmed : trimmed.replace(/^((?:\x1b\[[0-9;]*m)*)[ \t]+/, '$1');
    });
}
