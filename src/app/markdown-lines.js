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

function parseBlocks(markdown) {
  const blocks = [];
  let paragraph = null;
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('```')) {
      paragraph = null;
      const code = [];
      while (++i < lines.length && !lines[i].startsWith('```')) code.push(lines[i]);
      blocks.push({ type: 'code', lines: code });
      continue;
    }
    if (line.trim() === '') {
      paragraph = null;
      continue;
    }
    const heading = line.match(/^#{1,6}\s+(.*)/);
    const item = line.match(/^(\s*)(-|\d+\.)\s+(.*)/);
    if (heading) {
      paragraph = null;
      blocks.push({ type: 'heading', text: heading[1] });
    } else if (item) {
      paragraph = { type: 'item', marker: item[2] === '-' ? '•' : item[2], indent: item[1].length, text: item[3] };
      blocks.push(paragraph);
    } else if (paragraph) {
      paragraph.text += ` ${line.trim()}`;
    } else {
      paragraph = { type: 'paragraph', text: line.trim() };
      blocks.push(paragraph);
    }
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

function inline(text) {
  return text
    .split(/(`[^`]+`)/)
    .map((part, index) => {
      if (index % 2 === 1) return chalk.cyan(part.slice(1, -1));
      return part
        .replace(/\*\*\*(.+?)\*\*\*/g, (_, t) => chalk.bold.italic(t))
        .replace(/\*\*(.+?)\*\*/g, (_, t) => chalk.bold(t))
        .replace(/(^|[^\\*])\*([^*\s][^*]*?)\*/g, (_, before, t) => before + chalk.italic(t))
        .replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, '$1');
    })
    .join('');
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
