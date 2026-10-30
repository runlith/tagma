const RULE = /^\s*─{3,}\s*$/;
const COMPOSER = /^❯(?: (.*))?$/;
const WORKING = /…\s\(\d+[smh]/;
const HINTS: ReadonlySet<string> = new Set(['Press up to edit queued messages']);

const composerOf = (lines: readonly string[]): string | null => {
  const below = lines.findLastIndex((line) => RULE.test(line));
  const above = below < 0 ? -1 : lines.slice(0, below).findLastIndex((line) => RULE.test(line));
  if (above < 0) return null;
  const first = COMPOSER.exec(lines[above + 1]?.trimEnd() ?? '');
  if (first === null) return null;
  return [first[1] ?? '', ...lines.slice(above + 2, below).map((line) => line.trim())].join('\n').trim();
};

export const claudePromptScreen = (lines: readonly string[]): boolean =>
  composerOf(lines) !== null && !lines.some((line) => WORKING.test(line));

export const claudeComposer = (lines: readonly string[]): string | null => {
  const text = composerOf(lines);
  if (text === null || text === '' || HINTS.has(text) || text.startsWith('Try "')) return null;
  return text;
};
