import type { HarnessQuestionOption } from '../../../threads/contract/wire/harness/session.js';
import type { HarnessWidgetKey, ScreenAsk, ScreenAskTyped } from '../../contract/service/adapter.js';

const CLAUDE_SELECTED = /^(\s*)❯ (\d+)\. (.+)$/;
const CLAUDE_NUMBERED = /^(\s*)(\d+)\. (.+)$/;
const CLAUDE_CANCEL = /\(esc\)$/;
const CLAUDE_CANCEL_FOOTER = /^\s*Esc to cancel\b/;
const CLAUDE_RUNS = 'Claude wants to run ';
const CLAUDE_CONFIRM_FOOTER = /^\s*Enter to (?:confirm|select) · Esc to \S+/;
const CLAUDE_POINTED = /^(\s*)❯ (\S.*)$/;
const CLAUDE_RULE = /^\s*─{3,}\s*$/;

type Numbered = { readonly value: string; label: string; readonly selected: boolean };

const promptAbove = (lines: readonly string[], above: number): string => {
  const top = lines.slice(0, above + 1).findLastIndex((line) => CLAUDE_RULE.test(line));
  return lines
    .slice(top + 1, above + 1)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !/^╌+$/.test(line))
    .join('\n');
};

const CLAUDE_FRAME = /^\s*╌{3,}\s*$/;

const framedSubject = (lines: readonly string[], above: number): string | null => {
  const top = lines.slice(0, above + 1).findLastIndex((line) => CLAUDE_RULE.test(line));
  const region = lines.slice(top + 1, above + 1);
  const opened = region.findIndex((line) => CLAUDE_FRAME.test(line));
  const closed = opened < 0 ? -1 : region.findIndex((line, index) => index > opened && CLAUDE_FRAME.test(line));
  if (closed < 0) return null;
  const framed = region
    .slice(opened + 1, closed)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join('\n');
  return framed === '' ? null : framed;
};

const numberedAsk = (lines: readonly string[]): ScreenAsk | null => {
  const pointed = lines.findLastIndex((line) => CLAUDE_SELECTED.test(line));
  if (pointed < 0) return null;
  const indent = CLAUDE_SELECTED.exec(lines[pointed]!)![1]!;
  const row = `${indent}  `;
  const optionAt = (line: string, selected: boolean): Numbered | null => {
    const drawn = selected ? CLAUDE_SELECTED.exec(line) : CLAUDE_NUMBERED.exec(line);
    if (drawn === null || drawn[1] !== (selected ? indent : row)) return null;
    return { value: drawn[2]!, label: drawn[3]!.trim(), selected };
  };
  const continues = (line: string) => line.startsWith(`${row}   `) && line.trim() !== '';
  let above = pointed - 1;
  const before: Numbered[] = [];
  let carried: string[] = [];
  for (; above >= 0; above -= 1) {
    const line = lines[above]!;
    const each = optionAt(line, false);
    if (each !== null) {
      before.unshift(carried.length === 0 ? each : { ...each, label: [each.label, ...carried].join(' ') });
      carried = [];
    } else if (continues(line)) carried.unshift(line.trim());
    else break;
  }
  if (carried.length > 0) return null;
  const options: Numbered[] = [...before, optionAt(lines[pointed]!, true)!];
  let end = pointed + 1;
  for (; end < lines.length; end += 1) {
    const line = lines[end]!;
    const each = optionAt(line, false);
    if (each !== null) options.push(each);
    else if (continues(line)) options.at(-1)!.label = `${options.at(-1)!.label} ${line.trim()}`;
    else break;
  }
  if (options.length < 2 || options.some((option, index) => option.value !== String(index + 1))) return null;
  const footer = lines.slice(end).find((line) => line.trim() !== '');
  if (!CLAUDE_CANCEL.test(options.at(-1)!.label) && (footer === undefined || !CLAUDE_CANCEL_FOOTER.test(footer))) return null;
  const prompt = promptAbove(lines, above);
  if (prompt === '') return null;
  const asked = prompt.split('\n').at(-1)!;
  return {
    kind: 'choice',
    prompt,
    header: null,
    subject: asked.startsWith(CLAUDE_RUNS) ? asked.slice(CLAUDE_RUNS.length) : framedSubject(lines, above),
    options: options.map((option): HarnessQuestionOption => ({ value: option.value, label: option.label })),
    selected: options.find((option) => option.selected)!.value,
  };
};

const confirmAsk = (lines: readonly string[]): ScreenAsk | null => {
  let footer = lines.length - 1;
  while (footer >= 0 && lines[footer]!.trim() === '') footer -= 1;
  if (footer < 0 || !CLAUDE_CONFIRM_FOOTER.test(lines[footer]!)) return null;
  let end = footer - 1;
  while (end >= 0 && lines[end]!.trim() === '') end -= 1;
  const pointed = lines.slice(0, end + 1).findLastIndex((line) => CLAUDE_POINTED.test(line));
  if (pointed < 0) return null;
  const indent = CLAUDE_POINTED.exec(lines[pointed]!)![1]!;
  const unpointed = `${indent}  `;
  const option = (line: string): { readonly label: string; readonly selected: boolean } | null => {
    const marked = CLAUDE_POINTED.exec(line);
    if (marked !== null) return marked[1] === indent ? { label: marked[2]!.trim(), selected: true } : null;
    return line.startsWith(unpointed) && line[unpointed.length] !== ' ' && line.trim() !== ''
      ? { label: line.trim(), selected: false }
      : null;
  };
  const drawn: { readonly label: string; readonly selected: boolean }[] = [];
  let above = end;
  for (; above >= 0; above -= 1) {
    const each = option(lines[above]!);
    if (each === null) break;
    drawn.unshift(each);
  }
  if (above >= pointed || drawn.length < 2 || drawn.filter((each) => each.selected).length !== 1) return null;
  const top = lines.slice(0, above + 1).findLastIndex((line) => CLAUDE_RULE.test(line));
  const prompt = lines
    .slice(top + 1, above + 1)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join('\n');
  if (prompt === '') return null;
  return {
    kind: 'choice',
    prompt,
    header: null,
    subject: null,
    options: drawn.map((each) => ({ value: each.label, label: each.label })),
    selected: drawn.find((each) => each.selected)!.label,
  };
};

const QUESTION_FOOTER = /^\s*Enter to select · (?:↑\/↓|Tab\/Arrow keys) to navigate · (?:.+ · )?Esc to cancel$/;
const QUESTION_TABS = /^←\s+.*✔ Submit\s+→$/;
const QUESTION_CHIP = /^\s?[☐☒] (\S.*)$/;
const QUESTION_ROW = /^([❯ ]) (\d+)\. (.+)$/;
const QUESTION_SUBMIT = /^([❯ ]) {4}Submit$/;
const QUESTION_DETAIL = /^ {5,}\S/;
const QUESTION_BOX = /^\[([ ✔])\] (.*)$/;
const QUESTION_QUOTE = /^│ ?/;
const QUESTION_REVIEW = 'Ready to submit your answers?';
const QUESTION_PLACEHOLDERS: ReadonlySet<string> = new Set(['Type something.', 'Type something']);
const KILL_TO_END: HarnessWidgetKey = { _tag: 'char', char: '\u000b' };

type QuestionRow = {
  readonly value: string;
  readonly label: string;
  readonly details: string[];
  readonly pointed: boolean;
  readonly box: string | null;
};

const lastFilled = (lines: readonly string[], from: number): number => {
  let at = from;
  while (at >= 0 && lines[at]!.trim() === '') at -= 1;
  return at;
};

const questionTop = (lines: readonly string[], below: number): number =>
  lines.slice(0, below).findLastIndex((line) => QUESTION_TABS.test(line) || QUESTION_CHIP.test(line));

const promptBetween = (lines: readonly string[], top: number, end: number, separator: string): string =>
  lines
    .slice(top + 1, end)
    .map((line) => line.replace(QUESTION_QUOTE, '').trim())
    .filter((line) => line !== '')
    .join(separator);

const questionBlock = (lines: readonly string[], last: number): number => {
  let start = -1;
  for (let at = last; at >= 0; at -= 1) {
    const line = lines[at]!;
    if (QUESTION_ROW.test(line)) start = at;
    else if (!CLAUDE_RULE.test(line) && !QUESTION_SUBMIT.test(line) && !QUESTION_DETAIL.test(line)) break;
  }
  return start;
};

const questionAsk = (lines: readonly string[]): ScreenAsk | null => {
  const footer = lastFilled(lines, lines.length - 1);
  if (footer < 0 || !QUESTION_FOOTER.test(lines[footer]!)) return null;
  const last = lastFilled(lines, footer - 1);
  const start = last < 0 ? -1 : questionBlock(lines, last);
  if (start < 0) return null;
  const top = questionTop(lines, start);
  if (top < 0) return null;
  const rows: QuestionRow[] = [];
  let typed: QuestionRow | null = null;
  let submit: { readonly pointed: boolean } | null = null;
  let picks = false;
  for (const line of lines.slice(start, last + 1)) {
    const drawn = QUESTION_ROW.exec(line);
    if (CLAUDE_RULE.test(line)) {
      typed ??= rows.at(-1) ?? null;
    } else if (picks && QUESTION_SUBMIT.test(line)) {
      typed ??= rows.at(-1) ?? null;
      submit = { pointed: QUESTION_SUBMIT.exec(line)![1] === '❯' };
    } else if (drawn !== null) {
      const box = QUESTION_BOX.exec(drawn[3]!);
      if (rows.length === 0) picks = box !== null;
      if (picks !== (box !== null) && typed === null) return null;
      rows.push({ value: drawn[2]!, label: (box?.[2] ?? drawn[3]!).trim(), details: [], pointed: drawn[1] === '❯', box: box?.[1] ?? null });
    } else if (rows.length > 0) {
      rows.at(-1)!.details.push(line.trim());
    } else return null;
  }
  typed ??= rows.at(-1) ?? null;
  if (typed === null || rows.some((row, index) => row.value !== String(index + 1))) return null;
  if (picks && submit === null) return null;
  const pointed = [...rows.filter((row) => row.pointed), ...(submit?.pointed === true ? [submit] : [])];
  if (pointed.length !== 1 || rows.indexOf(typed) < 1) return null;
  const prompt = promptBetween(lines, top, start, ' ');
  if (prompt === '') return null;
  const chip = QUESTION_CHIP.exec(lines[top]!);
  const options = rows.filter((row) => row !== typed);
  return {
    kind: 'choice',
    prompt,
    header: chip?.[1]?.trim() ?? null,
    subject: null,
    options: options.map((row): HarnessQuestionOption => ({
      value: row.value,
      label: row.label,
      description: row.details.length === 0 ? undefined : row.details.join(' '),
    })),
    selected: rows.find((row) => row.pointed)?.value ?? null,
    freeform: { value: typed.value, draft: QUESTION_PLACEHOLDERS.has(typed.label) ? '' : [typed.label, ...typed.details].join(' ') },
    picks: picks ? { checked: rows.filter((row) => row.box === '✔').map((row) => row.value) } : undefined,
  };
};

const reviewAsk = (lines: readonly string[]): ScreenAsk | null => {
  const last = lastFilled(lines, lines.length - 1);
  if (last < 0 || !QUESTION_ROW.test(lines[last]!)) return null;
  let start = last;
  while (start > 0 && QUESTION_ROW.test(lines[start - 1]!)) start -= 1;
  const asked = lastFilled(lines, start - 1);
  if (asked < 0 || lines[asked]!.trim() !== QUESTION_REVIEW) return null;
  const top = lines.slice(0, asked).findLastIndex((line) => QUESTION_TABS.test(line));
  if (top < 0) return null;
  const rows = lines.slice(start, last + 1).map((line) => QUESTION_ROW.exec(line)!);
  if (rows.length < 2 || rows.some((row, index) => row[2] !== String(index + 1))) return null;
  if (rows.filter((row) => row[1] === '❯').length !== 1) return null;
  return {
    kind: 'choice',
    prompt: promptBetween(lines, top, start, '\n'),
    header: null,
    subject: null,
    options: rows.map((row) => ({ value: row[2]!, label: row[3]!.trim() })),
    selected: rows.find((row) => row[1] === '❯')![2]!,
  };
};

export const claudeScreenAsk = (lines: readonly string[]): ScreenAsk | null =>
  questionAsk(lines) ?? reviewAsk(lines) ?? confirmAsk(lines) ?? numberedAsk(lines);

const numbered = (ask: ScreenAsk): boolean => ask.options.every((option, index) => option.value === String(index + 1));

const digits = (value: string): HarnessWidgetKey[] => [...value].map((char): HarnessWidgetKey => ({ _tag: 'char', char }));

const typing = (text: string): HarnessWidgetKey | null => {
  const line = text.replace(/\s+/g, ' ').trim();
  return line === '' ? null : { _tag: 'text', text: line };
};

const walk = (from: number, to: number): HarnessWidgetKey[] =>
  Array.from<HarnessWidgetKey>({ length: Math.abs(to - from) }).fill(to > from ? 'down' : 'up');

const intoTyped = (from: number, row: number, draft: string): HarnessWidgetKey[] => [
  ...(from === row ? (['up', 'down'] as const) : walk(from, row)),
  ...(draft === '' ? [] : [KILL_TO_END]),
];

const answerKeys = (ask: ScreenAsk, typed: ScreenAskTyped, value: string): readonly HarnessWidgetKey[] | null => {
  const standing = ask.selected === typed.value;
  if (ask.options.some((option) => option.value === value)) return [...(standing ? ['up' as const] : []), ...digits(value)];
  const text = typing(value);
  if (text === null) return null;
  if (typed.draft === '') return [...(standing ? [] : digits(typed.value)), text, 'enter'];
  if (ask.selected === null) return null;
  return [...intoTyped(Number(ask.selected), Number(typed.value), typed.draft), text, 'enter'];
};

const pickKeys = (
  ask: ScreenAsk,
  typed: ScreenAskTyped,
  checked: readonly string[],
  values: readonly string[],
): readonly HarnessWidgetKey[] | null => {
  const row = Number(typed.value);
  const listed = ask.options.filter((option) => Number(option.value) < row).map((option) => option.value);
  const after = ask.options.filter((option) => Number(option.value) > row).map((option) => option.value);
  let at = ask.selected === null ? row + 1 : Number(ask.selected);
  const keys: HarnessWidgetKey[] = [];
  const onList = () => {
    if (at < row) return;
    keys.push(...walk(at, row - 1));
    at = row - 1;
  };
  if (values.some((value) => after.includes(value))) {
    if (values.length !== 1) return null;
    onList();
    return [...keys, ...digits(values[0]!)];
  }
  const words = values.filter((value) => !listed.includes(value));
  if (words.length > 1) return null;
  const text = words.length === 1 ? typing(words[0]!) : null;
  if (words.length === 1 && text === null) return null;
  const flipped = [
    ...listed.filter((value) => values.includes(value) !== checked.includes(value)),
    ...((text !== null) !== checked.includes(typed.value) ? [typed.value] : []),
  ];
  if (flipped.length > 0) onList();
  keys.push(...flipped.flatMap(digits));
  if (text !== null) {
    keys.push(...intoTyped(at, row, typed.draft), text);
    at = row;
  }
  return [...keys, ...walk(at, row + 1), 'enter'];
};

export const claudeWidgetKeys = (ask: ScreenAsk, values: readonly string[]): readonly HarnessWidgetKey[] | null => {
  if (ask.freeform !== undefined && ask.picks !== undefined) return pickKeys(ask, ask.freeform, ask.picks.checked, values);
  if (values.length !== 1) return null;
  const value = values[0]!;
  if (ask.freeform !== undefined) return answerKeys(ask, ask.freeform, value);
  if (ask.options.every((option) => option.value !== value)) return null;
  if (numbered(ask)) return digits(value);
  if (ask.selected === null) return null;
  const from = ask.options.findIndex((option) => option.value === ask.selected);
  const to = ask.options.findIndex((option) => option.value === value);
  if (from < 0) return null;
  return [...walk(from, to), 'enter'];
};
