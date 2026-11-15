// Side by side: the source and the preview scroll together by source line.
// Pure; loaded by the canvas page from /lib/.
//
// `blocks` are the preview's top-level blocks in order: the source line each
// starts at and its top in the preview's content, ending with the end of the
// doc ({line: lineCount, y: contentHeight}). A position between two blocks
// maps by the fraction of their lines, so a block's first line is always its
// top, in both directions.

/** The preview's y for a fractional source line. */
export function lineToY(blocks, line) {
  if (!blocks.length) return 0;
  if (line <= blocks[0].line) return blocks[0].y;
  const last = blocks[blocks.length - 1];
  if (line >= last.line) return last.y;
  let i = 0;
  while (i < blocks.length - 2 && blocks[i + 1].line <= line) i++;
  const a = blocks[i], b = blocks[i + 1];
  return b.line > a.line ? a.y + ((line - a.line) / (b.line - a.line)) * (b.y - a.y) : a.y;
}

/** The fractional source line at a preview y. */
export function yToLine(blocks, y) {
  if (!blocks.length) return 0;
  if (y <= blocks[0].y) return blocks[0].line;
  const last = blocks[blocks.length - 1];
  if (y >= last.y) return last.line;
  let i = 0;
  while (i < blocks.length - 2 && blocks[i + 1].y <= y) i++;
  const a = blocks[i], b = blocks[i + 1];
  return b.y > a.y ? a.line + ((y - a.y) / (b.y - a.y)) * (b.line - a.line) : a.line;
}
