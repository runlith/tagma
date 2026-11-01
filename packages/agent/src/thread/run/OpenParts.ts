import type { ToolDisplay } from '../../tool/display';
import type { ThreadInterruptedInput } from '../../transcript/entries';
import type { ThreadTranscriptEntry } from '../../transcript/rows';
import { threadMessageEntry } from '../events';
import { toJson } from '@runlith/utils/json';

export type OpenStream = 'message' | 'reasoning';

type OpenText = {
  readonly kind: OpenStream;
  readonly key: string;
  readonly mint: () => string;
  id: string | null;
  text: string;
  carriage: boolean;
  started: boolean;
  lead: number;
  trail: number;
  pending: string;
  sealed: boolean;
  readonly occurredAt: string;
};

type OpenInput = {
  readonly kind: 'input';
  readonly key: string;
  readonly id: string;
  readonly name: string;
  text: string;
  display: ToolDisplay | undefined;
  readonly occurredAt: string;
};

type Part = OpenText | OpenInput;

export type OpenInputView = {
  readonly id: string;
  readonly callId: string;
  readonly name: string;
  readonly text: string;
  readonly display: ToolDisplay | undefined;
  readonly occurredAt: string;
};

export type PartGrowth = { readonly id: string; readonly text: string; readonly opened: boolean };

export type InputShown = { readonly raw?: ThreadInterruptedInput; readonly display?: ToolDisplay };

const viewOf = (part: OpenInput): OpenInputView => ({
  id: part.id,
  callId: part.key,
  name: part.name,
  text: part.text,
  display: part.display,
  occurredAt: part.occurredAt,
});

const shownInput = (input: OpenInputView): InputShown => ({
  raw: input.text.length > 0 ? { kind: 'text', text: input.text, complete: false } : undefined,
  display: input.display,
});

export class OpenParts {
  private readonly parts: Part[] = [];

  constructor(
    private readonly runId: string,
    private readonly now: () => string,
  ) {}

  idle(): boolean {
    return this.parts.length === 0;
  }

  open(kind: OpenStream, key: string, mint: () => string): void {
    if (this.text(key) !== undefined) return;
    this.parts.push({
      kind,
      key,
      mint,
      id: null,
      text: '',
      carriage: false,
      started: false,
      lead: 0,
      trail: 0,
      pending: '',
      sealed: false,
      occurredAt: this.now(),
    });
  }

  opened(kind: OpenStream): string | undefined {
    for (const part of this.parts) if (part.kind === kind && !part.sealed) return part.key;
    return undefined;
  }

  append(key: string, delta: string): PartGrowth | null {
    const part = this.text(key);
    if (part === undefined || part.sealed) return null;
    const shown = appendClean(part, delta);
    if (shown.length === 0) return null;
    const opened = part.id === null;
    part.id ??= part.mint();
    return { id: part.id, text: shown, opened };
  }

  seal(key: string): ThreadTranscriptEntry | null {
    const part = this.text(key);
    if (part === undefined || part.sealed) return null;
    part.sealed = true;
    if (part.id === null) {
      this.parts.splice(this.parts.indexOf(part), 1);
      return null;
    }
    return this.textEntry(part, 'done');
  }

  openInput(callId: string, name: string, id: string): void {
    if (this.inputPart(callId) !== undefined) return;
    this.parts.push({ kind: 'input', key: callId, id, name, text: '', display: undefined, occurredAt: this.now() });
  }

  appendInput(callId: string, name: string, id: string, delta: string): PartGrowth | null {
    let part = this.inputPart(callId);
    let opened = false;
    if (part === undefined) {
      this.openInput(callId, name, id);
      part = this.inputPart(callId)!;
      opened = true;
    }
    if (part.text.length === 0) opened = true;
    part.text += delta;
    return delta.length === 0 ? null : { id: part.id, text: delta, opened };
  }

  showInput(callId: string, display: ToolDisplay | undefined): void {
    const part = this.inputPart(callId);
    if (part !== undefined) part.display = display === undefined ? undefined : (toJson(display) as ToolDisplay);
  }

  input(callId: string): OpenInputView | undefined {
    const part = this.inputPart(callId);
    return part === undefined ? undefined : viewOf(part);
  }

  inputs(): readonly OpenInputView[] {
    return this.parts.flatMap((part) => (part.kind === 'input' ? [viewOf(part)] : []));
  }

  dropInput(callId: string): OpenInputView | undefined {
    const part = this.inputPart(callId);
    if (part === undefined) return undefined;
    this.parts.splice(this.parts.indexOf(part), 1);
    return viewOf(part);
  }

  landed(ids: ReadonlySet<string>): readonly string[] {
    const gone: string[] = [];
    for (const part of [...this.parts]) {
      if (part.id === null || !ids.has(part.id)) continue;
      gone.push(part.id);
      this.parts.splice(this.parts.indexOf(part), 1);
    }
    return gone;
  }

  ids(): readonly string[] {
    return this.parts.flatMap((part) => (part.id === null ? [] : [part.id]));
  }

  end(): readonly string[] {
    const ids = this.ids();
    this.parts.length = 0;
    return ids;
  }

  tail(shown: (input: OpenInputView) => InputShown = shownInput): readonly ThreadTranscriptEntry[] {
    const entries: ThreadTranscriptEntry[] = [];
    for (const part of this.parts) {
      if (part.kind !== 'input') {
        if (part.id !== null) entries.push(this.textEntry(part, part.sealed ? 'done' : 'streaming'));
        continue;
      }
      const view = shown(viewOf(part));
      entries.push({
        type: 'tool',
        id: part.id,
        runId: this.runId,
        toolName: part.name,
        toolCallId: part.key,
        toolState: 'input-streaming',
        toolInputRaw: view.raw,
        toolDisplay: view.display,
        occurredAt: part.occurredAt,
      });
    }
    return toJson(entries) as unknown as readonly ThreadTranscriptEntry[];
  }

  private textEntry(part: OpenText, state: 'streaming' | 'done'): ThreadTranscriptEntry {
    const text = cleaned(part);
    return part.kind === 'message'
      ? threadMessageEntry(part.id!, 'assistant', this.runId, text, part.occurredAt)
      : { type: 'reasoning', id: part.id!, runId: this.runId, text, state, occurredAt: part.occurredAt };
  }

  private text(key: string): OpenText | undefined {
    for (const part of this.parts) if (part.kind !== 'input' && part.key === key) return part;
    return undefined;
  }

  private inputPart(callId: string): OpenInput | undefined {
    for (const part of this.parts) if (part.kind === 'input' && part.key === callId) return part;
    return undefined;
  }
}

function appendClean(open: OpenText, delta: string): string {
  if (delta.length === 0) return '';
  let piece = delta;
  let prefix = '';
  if (open.carriage) {
    prefix = '\n';
    open.carriage = false;
    if (piece.startsWith('\n')) piece = piece.slice(1);
  }
  if (piece.endsWith('\r')) {
    open.carriage = true;
    piece = piece.slice(0, -1);
  }
  const normalized = prefix + piece.replace(/\r\n?/g, '\n');
  if (normalized.length === 0) return '';
  open.text += normalized;
  let visible: string;
  if (!open.started) {
    const first = normalized.search(/\S/);
    if (first < 0) {
      open.lead += normalized.length;
      open.trail += normalized.length;
      return '';
    }
    open.started = true;
    open.lead += first;
    visible = normalized.slice(first);
  } else {
    visible = open.pending + normalized;
  }
  const last = visible.search(/\S\s*$/);
  if (last < 0) {
    open.pending = visible;
    open.trail = visible.length;
    return '';
  }
  open.pending = visible.slice(last + 1);
  open.trail = open.pending.length;
  return visible.slice(0, last + 1);
}

function cleaned(open: OpenText): string {
  return open.started ? open.text.slice(open.lead, open.text.length - open.trail) : '';
}
