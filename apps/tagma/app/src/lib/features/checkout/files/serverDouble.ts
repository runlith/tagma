import type { DocumentFrame } from '@tagma/server/checkout-files/contract/wire/document';
import { Refusal } from '$lib/wire/refusal.js';
import { Differ, engineOver } from './Differ.js';
import { applyEdits, diffLines, type LineEdit } from './lineDiff.js';

type Subscriber = { path: string; send: (frame: DocumentFrame) => void; held: DocumentFrame[] | null };

const digestOf = (text: string): string => `d:${text.length}:${text}`;

const refuse = (code: string): never => {
  throw new Refusal({ gate: true, code, reason: code, unblock: [] });
};

const under = (path: string, dir: string): boolean => path === dir || path.startsWith(`${dir}/`);

export class ServerDouble {
  readonly files = new Map<string, string>();
  readonly trashed = new Map<string, Map<string, string>>();
  readonly writes: { path: string; base: string | null; write: string }[] = [];

  private readonly subscribers = new Set<Subscriber>();
  private trashes = 0;

  constructor(files: Readonly<Record<string, string>> = {}) {
    for (const [path, text] of Object.entries(files)) this.files.set(path, text);
  }

  digest = (path: string): string | null => {
    const text = this.files.get(path);
    return text === undefined ? null : digestOf(text);
  };

  live = {
    hold: (open: (client: never) => unknown, frame: (value: DocumentFrame) => void) => {
      let subscriber: Subscriber | null = null;
      const client = {
        'document.subscribe': (input: { path: string }) => {
          subscriber = { path: input.path, send: frame, held: null };
          this.subscribers.add(subscriber);
          const text = this.files.get(input.path);
          frame(text === undefined ? { kind: 'gone' } : { kind: 'whole', digest: digestOf(text), text, readOnly: null, size: text.length });
        },
      };
      open(client as never);
      return {
        unsubscribe: () => {
          if (subscriber !== null) this.subscribers.delete(subscriber);
        },
      };
    },
  };

  holdFrames(path: string): () => void {
    const mine = [...this.subscribers].filter((one) => one.path === path);
    for (const one of mine) one.held = [];
    return () => {
      for (const one of mine) {
        const kept = one.held ?? [];
        one.held = null;
        for (const frame of kept) one.send(frame);
      }
    };
  }

  send(path: string, frame: DocumentFrame): void {
    this.tell(path, frame);
  }

  external(path: string, edits: readonly LineEdit[]): void {
    const next = applyEdits(this.files.get(path) ?? '', edits);
    if (next === null) throw new Error('the double was given edits that do not apply');
    this.files.set(path, next);
    this.tell(path, { kind: 'change', digest: digestOf(next), edits: [...edits] });
  }

  perform = async (id: string, input: Record<string, unknown>): Promise<Record<string, unknown>> => {
    if (id === 'write_document') return this.write(input as never);
    if (id === 'create_entry') return this.create(input as never);
    if (id === 'move_entries') return this.move(input as never);
    if (id === 'trash_entries') return this.trash(input as never);
    if (id === 'restore_entries') return this.restore(input as never);
    return refuse(`the double does not answer ${id}`);
  };

  private tell(path: string, frame: DocumentFrame): void {
    for (const one of this.subscribers) {
      if (one.path !== path) continue;
      if (one.held !== null) one.held.push(frame);
      else one.send(frame);
    }
  }

  private whole(path: string): void {
    const text = this.files.get(path) ?? '';
    this.tell(path, { kind: 'whole', digest: digestOf(text), text, readOnly: null, size: text.length });
  }

  private write(input: { path: string; base: string | null; write: string; edits?: LineEdit[]; text?: string }): Record<string, unknown> {
    this.writes.push({ path: input.path, base: input.base, write: input.write });
    const now = this.files.get(input.path);
    const standing = now === undefined ? null : digestOf(now);
    if (input.base !== standing) return { status: 'moved', digest: standing };
    const next = input.text ?? applyEdits(now ?? '', input.edits ?? []);
    if (next === null) return refuse('edits-invalid');
    this.files.set(input.path, next);
    const digest = digestOf(next);
    if (now === undefined) this.whole(input.path);
    else this.tell(input.path, { kind: 'change', digest, edits: input.edits ?? [], write: input.write });
    return { status: 'ok', digest, kept: true, unconfirmed: null };
  }

  private create(input: { path: string; kind: 'file' | 'directory' }): Record<string, unknown> {
    if (this.files.has(input.path)) return refuse('target-exists');
    if (input.kind === 'file') {
      this.files.set(input.path, '');
      this.whole(input.path);
    }
    return { status: 'ok', path: input.path, unconfirmed: null };
  }

  private move(input: { pairs: { from: string; to: string }[] }): Record<string, unknown> {
    for (const { from, to } of input.pairs) {
      if (![...this.files.keys()].some((path) => under(path, from))) refuse('source-moved');
      if ([...this.files.keys()].some((path) => under(path, to))) refuse('target-exists');
    }
    for (const { from, to } of input.pairs) {
      for (const path of [...this.files.keys()].filter((one) => under(one, from))) {
        const next = to + path.slice(from.length);
        this.files.set(next, this.files.get(path) as string);
        this.files.delete(path);
        this.tell(path, { kind: 'moved', path: next });
      }
    }
    return { status: 'ok', moved: input.pairs, unconfirmed: null };
  }

  private trash(input: { paths: string[] }): Record<string, unknown> {
    const id = `trash-${(this.trashes += 1)}`;
    const kept = new Map<string, string>();
    for (const dir of input.paths) {
      for (const path of [...this.files.keys()].filter((one) => under(one, dir))) {
        kept.set(path, this.files.get(path) as string);
        this.files.delete(path);
        this.tell(path, { kind: 'gone' });
      }
    }
    this.trashed.set(id, kept);
    return { status: 'ok', trash: id, unconfirmed: null };
  }

  private restore(input: { trash: string }): Record<string, unknown> {
    const kept = this.trashed.get(input.trash);
    if (kept === undefined) return refuse('source-moved');
    if ([...kept.keys()].some((path) => this.files.has(path))) refuse('target-exists');
    for (const [path, text] of kept) {
      this.files.set(path, text);
      this.whole(path);
    }
    this.trashed.delete(input.trash);
    return { status: 'ok', paths: [...kept.keys()], unconfirmed: null };
  }
}

export const inProcessDiffer = (): Differ => new Differ(async (before, after) => diffLines(before, after));

export const workerDiffer = (): Differ =>
  new Differ(engineOver(() => new Worker(`${process.cwd()}/src/lib/features/checkout/files/lineDiff.worker.ts`, { type: 'module' })));
