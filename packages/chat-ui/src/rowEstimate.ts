import type { ToolDisplay } from '@runlith/agent/tool/display';
import { type ActivityGroup, type ActivityRow, toolOpensByDefault } from './activity';
import type { ChatTailSlot } from './timeline';

export type ChatRowView = {
  expanded(key: string, fallback: boolean): boolean;
  stretchDefault(key: string, newest: boolean): boolean;
  toolOpen(toolName: string): boolean | undefined;
};

const LINE_PX = 20;
const BODY_LINE_PX = 24;
const PARAGRAPH_GAP_PX = 11;
const HEADING_PX = 48;
const FENCE_LINE_PX = 20;
const BLOCK_CEILING_PX = 384;
const CLAMPED_LINES = 3;
const CLAMP_ACTIONS_PX = 24;
export const BODY_COLUMNS = 78;
export const USER_COLUMNS = 72;
const PROSE_PER_CH = 1.31;
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

export function markdownHeight(text: string, columns: number): number {
  let px = 0;
  let fenced = false;
  for (const line of text.split('\n')) {
    if (line.startsWith('```')) {
      fenced = !fenced;
      px += FENCE_LINE_PX;
      continue;
    }
    if (fenced) {
      px += FENCE_LINE_PX;
      continue;
    }
    if (line.trim() === '') {
      px += PARAGRAPH_GAP_PX;
      continue;
    }
    if (/^#{1,6}\s/.test(line)) {
      px += HEADING_PX;
      continue;
    }
    px += Math.max(1, Math.ceil(line.length / (columns * PROSE_PER_CH))) * BODY_LINE_PX;
  }
  return px;
}

export interface RowSizing extends ChatRowView {
  markdown(key: string, text: string, columns: number, appendedFrom?: string): number;
}

type Growth = { columns: number; text: string; settled: number; fenced: boolean; lineStart: number };

const GROWING_TEXTS = 64;

export class TextHeights {
  private readonly held = new Map<string, Growth & { px: number }>();

  markdown(key: string, text: string, columns: number, appendedFrom?: string): number {
    const was = this.held.get(key);
    this.held.delete(key);
    const grown =
      was !== undefined &&
      was.columns === columns &&
      text.length >= was.text.length &&
      (appendedFrom === was.text || text.slice(0, was.text.length) === was.text);
    const next = this.measure(text, columns, grown ? was : undefined);
    this.held.set(key, next);
    if (this.held.size > GROWING_TEXTS) this.held.delete(this.held.keys().next().value!);
    return next.px;
  }

  private measure(text: string, columns: number, from: Growth | undefined): Growth & { px: number } {
    let settled = from?.settled ?? 0;
    let fenced = from?.fenced ?? false;
    let lineStart = from?.lineStart ?? 0;
    let scanned = from?.text.length ?? 0;
    for (;;) {
      const newline = text.indexOf('\n', scanned);
      if (newline < 0) break;
      const height = lineHeight(text, lineStart, newline, fenced, columns);
      settled += height.px;
      fenced = height.fenced;
      lineStart = newline + 1;
      scanned = lineStart;
    }
    const last = lineHeight(text, lineStart, text.length, fenced, columns);
    return {
      columns,
      text,
      settled,
      fenced,
      lineStart,
      px: settled + last.px,
    };
  }
}

function lineHeight(text: string, start: number, end: number, fenced: boolean, columns: number): { px: number; fenced: boolean } {
  if (text.startsWith('```', start) && start + 3 <= end) return { px: FENCE_LINE_PX, fenced: !fenced };
  if (fenced) return { px: FENCE_LINE_PX, fenced };
  let at = start;
  while (at < end && /\s/.test(text[at]!)) at += 1;
  if (at === end) return { px: PARAGRAPH_GAP_PX, fenced };
  if (/^#{1,6}\s/.test(text.slice(start, Math.min(end, start + 8)))) return { px: HEADING_PX, fenced };
  return { px: Math.max(1, Math.ceil((end - start) / (columns * PROSE_PER_CH))) * BODY_LINE_PX, fenced };
}

function toolBodyHeight(key: string, display: ToolDisplay | undefined, view: RowSizing): number {
  if (display === undefined) return 0;
  return formBodyHeight(key, display, view) + (display.images?.length ? STEP_BODY_PX + ATTACHMENTS_PX : 0);
}

function formBodyHeight(key: string, display: ToolDisplay, view: RowSizing): number {
  switch (display.form) {
    case 'code':
      return STEP_BODY_PX + capped(lines(display.text) * FENCE_LINE_PX);
    case 'command':
      return (
        STEP_BODY_PX +
        Math.min(lines(display.command), CLAMPED_LINES) * FENCE_LINE_PX +
        CLAMP_ACTIONS_PX +
        (display.output ? capped(lines(display.output) * FENCE_LINE_PX) : 0)
      );
    case 'diff': {
      const shown = display.files.filter((file) => file.patch !== '');
      return (
        STEP_BODY_PX + shown.reduce((height, file) => height + patchBodyHeight(file.patch), 0) + Math.max(0, shown.length - 1) * BODY_GAP_PX
      );
    }
    case 'list':
      return STEP_BODY_PX + capped(display.items.length * LINE_PX);
    case 'markdown':
    case 'message':
      return STEP_BODY_PX + capped(view.markdown(`${key}:display`, display.text, BODY_COLUMNS));
    case 'text':
      return STEP_BODY_PX + capped(lines(display.text) * FENCE_LINE_PX);
    default:
      return 0;
  }
}

export function patchBodyHeight(patch: string): number {
  return capped(lines(patch) * FENCE_LINE_PX);
}

export function stretchEstimate(_group: ActivityGroup): number {
  return STRETCH_PX;
}

export function rowOpen(row: ActivityRow, stretchOpen: boolean, view: ChatRowView): boolean {
  if (row.kind !== 'step') return view.expanded(row.key, false);
  const entry = row.entry;
  return view.expanded(entry.id, entry.kind === 'tool' && stretchOpen ? toolOpensByDefault(entry, view.toolOpen(entry.toolName)) : false);
}

export function stepEstimate(row: ActivityRow, stretchOpen: boolean, view: RowSizing): number {
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

  expanded(key: string, fallback: boolean): boolean {
    return this.view.expanded(key, fallback);
  }

  stretchDefault(key: string, newest: boolean): boolean {
    return this.view.stretchDefault(key, newest);
  }

  toolOpen(toolName: string): boolean | undefined {
    return this.view.toolOpen(toolName);
  }

  markdown(key: string, text: string, columns: number, appendedFrom?: string): number {
    return this.heights.markdown(key, text, columns, appendedFrom);
  }
}
