// xterm's title stack: save the tab's current title, and put it back later.
// Terminals without a title stack ignore these.
export const SAVE_TITLE = '\x1b[22;0t';
export const RESTORE_TITLE = '\x1b[23;0t';

/** The escape sequence that sets the terminal tab's title. */
export function titleSequence(text) {
  return `\x1b]0;${text.replace(/[\x00-\x1f\x7f]/g, '')}\x07`;
}
