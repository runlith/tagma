import type { ToolDisplay } from '@runlith/agent/tool/display';
import { type ActivityGroup, type ActivityRow, toolOpensByDefault } from './activity';
import type { NoticeEntry } from './notices';
import type { ChatTailSlot } from './timeline';

export type Prose = { readonly columns: number; readonly line: number };

export type FeedMetrics = {
  readonly body: Prose;
  readonly bubble: Prose;
  readonly words: Prose;
  readonly document: Prose;
  readonly code: Prose;
  readonly thumbs: number;
};

export type FeedType = { readonly body: number; readonly ui: number; readonly small: number; readonly spacing: number };

export type ChatRowView = {
  readonly metrics: FeedMetrics;
  expanded(key: string, fallback: boolean): boolean;
  stretchDefault(key: string, newest: boolean): boolean;
  toolOpen(toolName: string): boolean | undefined;
};

const PROSE_EM = 0.55;
const CH_EM = 0.62;
const FEED_SHARE = 0.96;
const FEED_CH = 78;
const BUBBLE_SHARE = 0.85;
const BUBBLE_CH = 72;
const BUBBLE_PAD = 8;
const STEP_INSET = 10;
const WELL_PAD = 6;
const THUMB = 24;
const COLUMN_STEP = 4;

const columnsIn = (px: number, advance: number): number => Math.max(COLUMN_STEP, Math.floor(px / advance / COLUMN_STEP) * COLUMN_STEP);

export function feedMetrics(width: number, type: FeedType): FeedMetrics {
  const body = Math.min(width * FEED_SHARE, FEED_CH * type.body * CH_EM);
  const bubble = Math.min(width * BUBBLE_SHARE, BUBBLE_CH * type.body * CH_EM);
  const step = width - type.spacing * STEP_INSET;
  const well = step - type.spacing * WELL_PAD;
  return {
    body: { columns: columnsIn(body, type.body * PROSE_EM), line: type.spacing * 6 },
    bubble: { columns: columnsIn(bubble - type.spacing * BUBBLE_PAD, type.body * PROSE_EM), line: type.spacing * 6 },
    words: { columns: columnsIn(step, type.ui * PROSE_EM), line: type.spacing * 5 },
    document: { columns: columnsIn(well, type.small * PROSE_EM), line: type.spacing * 5 },
    code: { columns: columnsIn(well, type.small * CH_EM), line: type.spacing * 5 },
    thumbs: Math.max(1, Math.floor((bubble + type.spacing * 1.5) / (type.spacing * (THUMB + 1.5)))),
  };
}

export function sameMetrics(left: FeedMetrics, right: FeedMetrics): boolean {
  const same = (one: Prose, two: Prose) => one.columns === two.columns && one.line === two.line;
  return (
    same(left.body, right.body) &&
    same(left.bubble, right.bubble) &&
    same(left.words, right.words) &&
    same(left.document, right.document) &&
    same(left.code, right.code) &&
    left.thumbs === right.thumbs
  );
}

export const DESKTOP_METRICS: FeedMetrics = feedMetrics(768, { body: 14, ui: 13, small: 12, spacing: 4 });

export const attachmentsHeight = (count: number, metrics: FeedMetrics): number =>
  count === 0 ? 0 : Math.ceil(count / metrics.thumbs) * ATTACHMENTS_PX;

const LINE_PX = 20;
const BODY_LINE_PX = 24;
const PARAGRAPH_GAP_PX = 11;
const HEADING_PX = 48;
const HEADING_LINE_PX = 30;
const HEADING_SHARE = 0.75;
const TABLE_ROW_PX = 36;
const TABLE_PAD_PX = 14;
const LIST_GAP_PX = 4;
const BLOCK_CEILING_PX = 384;
const WELL_PAD_PX = 16;
const LIST_ROW_PX = 24;
const CLAMP_FOOT_PX = 24;
export const WELL_LINES = 8;
export const WORDS_LINES = 6;
export const META_PX = 24;
export const BUBBLE_PX = 16;
export const ATTACHMENTS_PX = 102;
export const FEED_GAP_PX = 14;
const STRETCH_PX = 24;
export const STEP_PX = 26;
const REWIND_FOLD_PX = 42;
const FOLD_GAP_PX = 4;
const STEP_BODY_PX = 18;
const BODY_GAP_PX = 8;
export const DISCLOSURE_BODY_PX = 328;
export const DISCLOSURE_PX = 20;
export const UNDERIVED_PX = LINE_PX + META_PX;
export const TOOL_VIEW_PX = 320;
const TOOL_VIEW_GAP_PX = 6;
export const TOOL_VIEW_ROW_PX = STEP_PX + TOOL_VIEW_GAP_PX + TOOL_VIEW_PX;

const capped = (px: number): number => Math.min(px, BLOCK_CEILING_PX);

const lines = (text: string): number => text.split('\n').length;

const wrappedLines = (text: string, columns: number): number => {
  let count = 0;
  let start = 0;
  for (;;) {
    const newline = text.indexOf('\n', start);
    const end = newline < 0 ? text.length : newline;
    count += Math.max(1, Math.ceil((end - start) / columns));
    if (newline < 0) return count;
    start = newline + 1;
  }
};

const clamped = (px: number, shown: number, whole: boolean): number => {
  if (px <= shown * LINE_PX) return px;
  return (whole ? px : shown * LINE_PX) + CLAMP_FOOT_PX;
};

const wellHeight = (px: number, whole: boolean): number => WELL_PAD_PX + clamped(px, WELL_LINES, whole);

const wellText = (text: string, view: ChatRowView): number => wrappedLines(text, view.metrics.code.columns) * view.metrics.code.line;

const shownWhole = (key: string, view: ChatRowView): boolean => view.expanded(`${key}:all`, false);

export function markdownHeight(text: string, prose: Prose, fence: number = LINE_PX): number {
  let px = 0;
  let fenced = false;
  let start = 0;
  for (;;) {
    const newline = text.indexOf('\n', start);
    const end = newline < 0 ? text.length : newline;
    const height = lineHeight(text, start, end, fenced, prose, fence);
    px += height.px;
    fenced = height.fenced;
    if (newline < 0) return px;
    start = newline + 1;
  }
}

export interface RowSizing extends ChatRowView {
  markdown(key: string, text: string, prose: Prose, appendedFrom?: string): number;
}

type Growth = { prose: Prose; fence: number; text: string; settled: number; fenced: boolean; lineStart: number };

const GROWING_TEXTS = 64;

export class TextHeights {
  private readonly held = new Map<string, Growth & { px: number }>();

  markdown(key: string, text: string, prose: Prose, fence: number = LINE_PX, appendedFrom?: string): number {
    const was = this.held.get(key);
    this.held.delete(key);
    const grown =
      was !== undefined &&
      was.prose.columns === prose.columns &&
      was.prose.line === prose.line &&
      was.fence === fence &&
      text.length >= was.text.length &&
      (appendedFrom === was.text || text.slice(0, was.text.length) === was.text);
    const next = this.measure(text, prose, fence, grown ? was : undefined);
    this.held.set(key, next);
    if (this.held.size > GROWING_TEXTS) this.held.delete(this.held.keys().next().value!);
    return next.px;
  }

  private measure(text: string, prose: Prose, fence: number, from: Growth | undefined): Growth & { px: number } {
    let settled = from?.settled ?? 0;
    let fenced = from?.fenced ?? false;
    let lineStart = from?.lineStart ?? 0;
    let scanned = from?.text.length ?? 0;
    for (;;) {
      const newline = text.indexOf('\n', scanned);
      if (newline < 0) break;
      const height = lineHeight(text, lineStart, newline, fenced, prose, fence);
      settled += height.px;
      fenced = height.fenced;
      lineStart = newline + 1;
      scanned = lineStart;
    }
    const last = lineHeight(text, lineStart, text.length, fenced, prose, fence);
    return { prose, fence, text, settled, fenced, lineStart, px: settled + last.px };
  }
}

const TABLE_RULE = /^\|[\s:|-]*$/;
const LIST_ITEM = /^(?:[-*+]|\d+[.)])\s/;
const HEADING = /^#{1,6}\s/;

function lineHeight(
  text: string,
  start: number,
  end: number,
  fenced: boolean,
  prose: Prose,
  fence: number,
): { px: number; fenced: boolean } {
  if (text.startsWith('```', start) && start + 3 <= end) return { px: fence, fenced: !fenced };
  if (fenced) return { px: fence, fenced };
  let at = start;
  while (at < end && /\s/.test(text[at]!)) at += 1;
  const scale = prose.line / BODY_LINE_PX;
  if (at === end) return { px: PARAGRAPH_GAP_PX * scale, fenced };
  const head = text.slice(at, Math.min(end, at + 8));
  const wraps = (columns: number) => Math.max(1, Math.ceil((end - at) / columns));
  if (HEADING.test(head)) return { px: (HEADING_PX + (wraps(prose.columns * HEADING_SHARE) - 1) * HEADING_LINE_PX) * scale, fenced };
  if (text[at] === '|') {
    if (TABLE_RULE.test(text.slice(at, end))) return { px: 0, fenced };
    return { px: Math.max(TABLE_ROW_PX * scale, wraps(prose.columns) * prose.line + TABLE_PAD_PX * scale), fenced };
  }
  const wrapped = wraps(prose.columns) * prose.line;
  return { px: LIST_ITEM.test(head) ? wrapped + LIST_GAP_PX * scale : wrapped, fenced };
}

function toolBodyHeight(key: string, display: ToolDisplay | undefined, view: RowSizing): number {
  if (display === undefined) return 0;
  const images = display.images?.length ?? 0;
  return formBodyHeight(key, display, view) + (images > 0 ? STEP_BODY_PX + attachmentsHeight(images, view.metrics) : 0);
}

function formBodyHeight(key: string, display: ToolDisplay, view: RowSizing): number {
  const whole = shownWhole(key, view);
  switch (display.form) {
    case 'code':
      return STEP_BODY_PX + wellHeight(wellText(display.text, view), whole);
    case 'command':
      return STEP_BODY_PX + wellHeight(wellText(display.command, view) + (display.output ? wellText(display.output, view) : 0), whole);
    case 'diff': {
      const shown = display.files.filter((file) => file.patch !== '');
      return (
        STEP_BODY_PX + shown.reduce((height, file) => height + patchBodyHeight(file.patch), 0) + Math.max(0, shown.length - 1) * BODY_GAP_PX
      );
    }
    case 'list':
      return STEP_BODY_PX + wellHeight(display.items.length * LIST_ROW_PX, whole);
    case 'markdown':
      return STEP_BODY_PX + wellHeight(view.markdown(`${key}:display`, display.text, view.metrics.document), whole);
    case 'message':
      return STEP_BODY_PX + view.markdown(`${key}:display`, display.text, view.metrics.words);
    case 'text':
      return STEP_BODY_PX + wellHeight(wellText(display.text, view), whole);
    default:
      return 0;
  }
}

export function patchBodyHeight(patch: string): number {
  return capped(lines(patch) * LINE_PX);
}

export function stretchEstimate(_group: ActivityGroup): number {
  return STRETCH_PX;
}

export function rowOpen(row: ActivityRow, stretchOpen: boolean, view: ChatRowView): boolean {
  if (row.kind !== 'step') return view.expanded(row.key, false);
  const entry = row.entry;
  return view.expanded(entry.id, entry.kind === 'tool' && stretchOpen ? toolOpensByDefault(entry, view.toolOpen(entry.toolName)) : false);
}

function noticeHeight(entry: NoticeEntry, view: ChatRowView): number {
  if (!view.expanded(`${entry.id}:notice`, false)) return STEP_PX;
  const notice = entry.notice;
  const text =
    notice.kind === 'command-ending'
      ? [notice.command, notice.tail].filter((part) => part !== null && part.trim() !== '').join('\n')
      : entry.text.trim();
  if (text === '') return STEP_PX + STEP_BODY_PX;
  return STEP_PX + STEP_BODY_PX + wellHeight(wellText(text, view), shownWhole(entry.id, view));
}

export function stepEstimate(row: ActivityRow, stretchOpen: boolean, view: RowSizing): number {
  if (row.kind === 'notices') {
    const [only] = row.entries;
    if (row.entries.length === 1 && only !== undefined) return noticeHeight(only, view);
    if (!view.expanded(row.key, false)) return STEP_PX;
    return STEP_PX + FOLD_GAP_PX + row.entries.reduce((height, entry) => height + noticeHeight(entry, view), 0);
  }
  if (row.kind !== 'step') {
    return rowOpen(row, stretchOpen, view) ? STEP_PX + FOLD_GAP_PX + row.entries.length * STEP_PX : STEP_PX;
  }
  const entry = row.entry;
  if (entry.kind !== 'tool') return STEP_PX;
  return rowOpen(row, stretchOpen, view) ? STEP_PX + toolBodyHeight(entry.id, entry.display, view) : STEP_PX;
}

export function rewindEstimate(scope: 'from' | 'turn'): number {
  return scope === 'from' ? REWIND_FOLD_PX : STEP_PX;
}

export function liveStatusEstimate(): number {
  return STEP_PX;
}

export function tailEstimate(slot: ChatTailSlot): number {
  return slot === 'ready-answers' ? STEP_PX + LINE_PX : LINE_PX;
}

export class ViewSizing implements RowSizing {
  constructor(
    private readonly view: ChatRowView,
    private readonly heights: TextHeights,
  ) {}

  get metrics(): FeedMetrics {
    return this.view.metrics;
  }

  expanded(key: string, fallback: boolean): boolean {
    return this.view.expanded(key, fallback);
  }

  stretchDefault(key: string, newest: boolean): boolean {
    return this.view.stretchDefault(key, newest);
  }

  toolOpen(toolName: string): boolean | undefined {
    return this.view.toolOpen(toolName);
  }

  markdown(key: string, text: string, prose: Prose, appendedFrom?: string): number {
    return this.heights.markdown(key, text, prose, this.view.metrics.code.line, appendedFrom);
  }
}
