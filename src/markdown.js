import TurndownService from 'turndown';

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*' });

turndown.addRule('listItem', {
  filter: 'li',
  replacement: (content, node) => {
    const list = node.parentNode;
    const index = Array.prototype.indexOf.call(list.children, node);
    const marker = list.nodeName === 'OL' ? `${Number(list.getAttribute('start') ?? 1) + index}. ` : '- ';
    const body = content.replace(/^\n+/, '').replace(/\n+$/, '\n').replace(/\n/gm, `\n${' '.repeat(marker.length)}`);
    return marker + body + (node.nextSibling && !body.endsWith('\n') ? '\n' : '');
  },
});

turndown.addRule('superscript', { filter: 'sup', replacement: (content) => `^${content}` });
turndown.addRule('subscript', { filter: 'sub', replacement: (content) => `_${content}` });

// Older problems put each example in a bare <pre> with <strong> labels inside.
turndown.addRule('example', {
  filter: (node) => node.nodeName === 'PRE' && node.firstChild?.nodeName !== 'CODE',
  replacement: (_content, node) => `\n\n\`\`\`\n${node.textContent.replace(/^\n+|\n+$/g, '')}\n\`\`\`\n\n`,
});

// Newer problems mark example values with <span class="example-io">.
turndown.addRule('exampleValue', {
  filter: (node) => node.nodeName === 'SPAN' && node.classList.contains('example-io'),
  replacement: (_content, node) => `\`${node.textContent}\``,
});

/** LeetCode's problem and hint HTML → Markdown. */
export function htmlToMarkdown(html) {
  if (!html) return '';
  return turndown
    .turndown(html.replace(/​/g, ''))
    .replace(/ /g, ' ')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
