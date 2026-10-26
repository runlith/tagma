import type { Hand } from '@tagma/server/change-record/contract/wire/holdings';
import type { DocumentFrame } from '@tagma/server/checkout-files/contract/wire/document';
import { TextDocument } from '@runlith/code-editor/document';
import { untrack } from 'svelte';
import type { Door } from '$lib/wire/Door.js';
import type { LiveConnection } from '$lib/wire/Live.js';
import type { AutoSavePolicy } from './AutoSave.svelte.js';
import { DiskText } from './DiskText.js';
import type { Differ } from './Differ.js';
import { type DocumentPlace, documentKey } from './documentKey.js';
import type { Drafts } from './Drafts.svelte.js';
import type { Gone } from './Gone.svelte.js';
import type { Holders, HoldersWatch } from './Holders.svelte.js';
import { bufferRanges, type LineEdit, lfText } from './lineDiff.js';
import { type Trigger, type WriteSource, type WriteState, Writes } from './Writes.svelte.js';

export type DocumentBody =
  | { readonly kind: 'loading' }
  | { readonly kind: 'text'; readonly readOnly: 'undecodable' | null; readonly size: number }
  | { readonly kind: 'binary'; readonly size: number }
  | { readonly kind: 'tooLarge'; readonly size: number }
  | { readonly kind: 'gone' }
  | { readonly kind: 'unreadable'; readonly reason: string };

export type DocumentNote = { readonly kind: 'rest' } | { readonly kind: 'moved'; readonly from: string; readonly to: string };

export const DRAFT_PAUSE_MS = 1500;

const NO_HANDS: readonly Hand[] = [];

export class OpenedDocument implements WriteSource {
  body = $state.raw<DocumentBody>({ kind: 'loading' });

  document = $state.raw<TextDocument | null>(null);

  revision = $state(0);

  edits = $state(0);

  path = $state('');

  disk = $state.raw<DiskText | null>(null);

  watching = $state.raw<HoldersWatch | null>(null);

  deciding = $state(false);

  readonly writes: Writes;

  private stream: { unsubscribe: () => void } | null = null;
  private release: (() => void) | null = null;
  private resolving = false;
  private epoch = 0;
  private working = false;
  private closed = false;
  private waiting: DocumentFrame[] = [];
  private draftTimer: ReturnType<typeof setTimeout> | null = null;
  private stopPolicy: (() => void) | null = null;
  private readonly notes = new Set<(note: DocumentNote) => void>();

  constructor(
    private readonly live: LiveConnection,
    door: Door,
    private readonly place: DocumentPlace,
    path: string,
    policy: () => AutoSavePolicy,
    private readonly holders: Holders,
    private readonly drafts: Drafts,
    private readonly gone: Gone,
    private readonly differ: Differ,
  ) {
    this.path = path;
    this.writes = new Writes(door, place, this, policy);
    this.subscribe();
    let last = untrack(policy);
    this.stopPolicy = $effect.root(() => {
      $effect(() => {
        const now = policy();
        if (now === last) return;
        last = now;
        untrack(() => this.writes.repolicy());
      });
    });
  }

  get key(): string {
    return documentKey(this.place, this.path);
  }

  get deleted(): boolean {
    return this.gone.has(this.key);
  }

  get saving(): WriteState {
    return this.writes.state;
  }

  get holdersNow(): readonly Hand[] {
    return this.watching?.hands(this.path) ?? NO_HANDS;
  }

  get unsettled(): boolean {
    void this.revision;
    return this.writes.state.kind !== 'idle' || this.document?.dirty === true;
  }

  get unwritable(): boolean {
    return this.writes.unwritable;
  }

  get kept(): boolean {
    return this.drafts.has(this.key);
  }

  listen(listener: (note: DocumentNote) => void): () => void {
    this.notes.add(listener);
    return () => this.notes.delete(listener);
  }

  flush(keepalive = false): Promise<void> {
    return this.writes.flush({ keepalive, command: true });
  }

  leave(trigger: Trigger, keepalive = false): Promise<void> {
    if (trigger === 'hide') this.saveDraft();
    return this.writes.on(trigger, keepalive);
  }

  close(): void {
    this.closed = true;
    this.epoch += 1;
    this.differ.release(this.key);
    this.stopPolicy?.();
    this.stopPolicy = null;
    this.writes.dispose();
    if (this.draftTimer !== null) clearTimeout(this.draftTimer);
    this.draftTimer = null;
    this.stream?.unsubscribe();
    this.stream = null;
    this.release?.();
    this.release = null;
    this.unwatch();
  }

  retry(): void {
    this.body = { kind: 'loading' };
    this.resync();
  }

  text(): string {
    void this.revision;
    return this.document?.read() ?? '';
  }

  rested(): void {
    this.notify({ kind: 'rest' });
  }

  written(): void {
    this.gone.clear(this.key);
  }

  resync(): void {
    this.epoch += 1;
    this.waiting = [];
    this.stream?.unsubscribe();
    this.subscribe();
  }

  saveDraft(): void {
    if (this.draftTimer !== null) clearTimeout(this.draftTimer);
    this.draftTimer = null;
    const doc = this.document;
    if (doc === null) return;
    if (doc.dirty) this.drafts.put(this.key, { digest: doc.digest, text: doc.read() });
    else this.drafts.drop(this.key);
  }

  async keepMine(): Promise<void> {
    const settled = await this.decided();
    if (settled === null) return;
    const { doc, disk, edits } = settled;
    const result = doc.keepMine(edits, disk.digest);
    this.settleConflict();
    if (result.kind !== 'applied') {
      this.resync();
      return;
    }
    void this.writes.flush({ command: true });
  }

  async takeDisk(): Promise<(() => void) | null> {
    const settled = await this.decided();
    if (settled === null) return null;
    const { doc, disk, edits } = settled;
    const mine = doc.read();
    this.resolving = true;
    doc.discard();
    const result = doc.applyRemote(edits, disk.digest);
    this.resolving = false;
    this.settleConflict();
    this.drafts.drop(this.key);
    if (result.kind !== 'applied') {
      this.resync();
      return null;
    }
    const taken = doc.read();
    let used = false;
    this.rested();
    return () => {
      if (used || this.document !== doc || doc.read() !== taken) return;
      used = true;
      doc.replaceText(mine);
    };
  }

  discardBuffer(): void {
    const doc = this.document;
    if (doc === null) return;
    this.resolving = true;
    doc.discard();
    this.resolving = false;
    this.settleConflict();
    this.writes.reset();
    this.drafts.drop(this.key);
    this.rested();
  }

  relocate(to: string): void {
    const from = this.path;
    if (to === from) return;
    const wasGone = this.deleted;
    this.drafts.drop(this.key);
    this.gone.clear(this.key);
    this.path = to;
    if (wasGone) this.gone.mark(this.key);
    if (this.document?.dirty === true) this.scheduleDraft();
    this.resync();
    this.notify({ kind: 'moved', from, to });
  }

  private settleConflict(): void {
    this.disk = null;
    this.writes.resolved();
    this.unwatch();
  }

  private unwatch(): void {
    this.watching?.release();
    this.watching = null;
  }

  private enterConflict(disk: DiskText, ranges: readonly { readonly from: number; readonly to: number }[]): void {
    this.disk = disk;
    const { projectId, rootId } = this.place;
    if (rootId !== null) this.watching ??= this.holders.watch({ projectId, rootId });
    this.writes.conflict(ranges);
  }

  private notify(note: DocumentNote): void {
    for (const listener of this.notes) listener(note);
  }

  private scheduleDraft(): void {
    if (this.draftTimer !== null) clearTimeout(this.draftTimer);
    this.draftTimer = setTimeout(() => this.saveDraft(), DRAFT_PAUSE_MS);
  }

  private subscribe(): void {
    const { projectId, rootId } = this.place;
    const path = this.path;
    this.stream = this.live.hold(
      (client) =>
        rootId === null ? client['file.subscribe']({ projectId, path }) : client['document.subscribe']({ projectId, root: rootId, path }),
      (frame) => this.apply(frame),
      (reason) => {
        if (reason.kind === 'subscription') this.body = { kind: 'unreadable', reason: reason.message };
      },
    );
  }

  private adopt(document: TextDocument | null): void {
    this.release?.();
    this.release = null;
    this.epoch += 1;
    this.document = document;
    this.settleConflict();
    this.revision += 1;
    if (document === null) return;
    this.release = document.subscribe((event) => {
      this.revision += 1;
      if (event === 'edit' && !this.resolving) {
        this.edits += 1;
        if (this.disk !== null && !document.dirty) void this.takeDisk();
        this.writes.edited();
      }
      if (this.resolving) return;
      if (document.dirty) this.scheduleDraft();
      else this.drafts.drop(this.key);
    });
  }

  private apply(frame: DocumentFrame): void {
    if (this.closed) return;
    if (this.working) {
      this.waiting.push(frame);
      return;
    }
    this.run(frame);
  }

  private run(frame: DocumentFrame): void {
    const done = this.process(frame);
    if (done === undefined) return;
    this.working = true;
    const epoch = this.epoch;
    void done.then(
      () => this.next(),
      (failure: unknown) => {
        this.report(failure, epoch);
        this.next();
      },
    );
  }

  private next(): void {
    this.working = false;
    for (let frame = this.waiting.shift(); frame !== undefined && !this.working; frame = this.working ? undefined : this.waiting.shift()) {
      this.run(frame);
    }
  }

  private report(failure: unknown, epoch: number): void {
    if (epoch !== this.epoch) return;
    const reason = failure instanceof Error ? failure.message : String(failure);
    if (this.document === null) this.body = { kind: 'unreadable', reason };
    else this.writes.refuse(reason);
  }

  private process(frame: DocumentFrame): Promise<void> | undefined {
    if (frame.kind === 'whole') return this.whole(frame);
    if (frame.kind === 'change') this.change(frame);
    else if (frame.kind === 'moved') this.relocate(frame.path);
    else if (frame.kind === 'gone') this.vanished();
    else this.unreadable(frame);
    return undefined;
  }

  private async decided(): Promise<{ doc: TextDocument; disk: DiskText; edits: readonly LineEdit[] } | null> {
    if (this.deciding) return null;
    this.deciding = true;
    try {
      const epoch = this.epoch;
      for (;;) {
        const doc = this.document;
        const disk = this.disk;
        const text = disk?.read() ?? null;
        if (doc === null || disk === null) return null;
        if (text === null) {
          this.resync();
          return null;
        }
        const generation = doc.baseGeneration;
        let edits: readonly LineEdit[] | null;
        try {
          edits = await this.differ.edits(doc.baseText, text, `${this.key}#decide`);
        } catch (failure) {
          this.report(failure, epoch);
          return null;
        }
        if (epoch !== this.epoch || this.document !== doc) return null;
        if (edits !== null && this.disk === disk && doc.baseGeneration === generation) return { doc, disk, edits };
      }
    } finally {
      this.deciding = false;
    }
  }

  private vanished(): void {
    if (this.document === null) {
      if (!this.deleted) {
        this.body = { kind: 'gone' };
        return;
      }
      this.body = { kind: 'text', readOnly: null, size: 0 };
      this.adopt(new TextDocument('', ''));
      return;
    }
    this.gone.mark(this.key);
    this.writes.gone();
  }

  private unreadable(frame: Extract<DocumentFrame, { readonly kind: 'binary' | 'tooLarge' | 'unreadable' }>): void {
    const doc = this.document;
    if (doc?.dirty === true) {
      this.writes.refuse(
        frame.kind === 'unreadable'
          ? `The file can no longer be read: ${frame.reason}`
          : `The file on the disk is now ${frame.kind === 'binary' ? 'binary' : 'too large to edit'}.`,
      );
      return;
    }
    this.adopt(null);
    this.gone.clear(this.key);
    if (frame.kind === 'unreadable') this.body = { kind: 'unreadable', reason: frame.reason };
    else this.body = { kind: frame.kind, size: frame.size };
  }

  private whole(frame: Extract<DocumentFrame, { readonly kind: 'whole' }>): Promise<void> | undefined {
    this.body = { kind: 'text', readOnly: frame.readOnly, size: frame.size };
    const doc = this.document;
    if (doc === null) return this.opened(frame);
    if (frame.write !== undefined && this.writes.echoed(frame.write, frame.digest)) return undefined;
    if (this.writes.echoedText(frame.text, frame.digest)) return undefined;
    if (frame.digest === (this.disk?.digest ?? doc.digest)) {
      this.gone.clear(this.key);
      this.writes.caughtUp();
      return undefined;
    }
    this.gone.clear(this.key);
    if (this.disk !== null) {
      this.disk = DiskText.of(lfText(frame.text), frame.digest);
      return undefined;
    }
    return this.rebased(frame, doc);
  }

  private async rebased(frame: Extract<DocumentFrame, { readonly kind: 'whole' }>, doc: TextDocument): Promise<void> {
    const epoch = this.epoch;
    for (;;) {
      const generation = doc.baseGeneration;
      const edits = await this.differ.edits(doc.baseText, frame.text, `${this.key}#frames`);
      if (epoch !== this.epoch || this.document !== doc || this.disk !== null) return;
      if (edits !== null && doc.baseGeneration === generation) {
        this.foreign(edits, frame.digest, frame.text);
        return;
      }
    }
  }

  private opened(frame: Extract<DocumentFrame, { readonly kind: 'whole' }>): Promise<void> | undefined {
    const doc = new TextDocument(frame.text, frame.digest);
    this.adopt(doc);
    this.gone.clear(this.key);
    const draft = this.drafts.get(this.key);
    if (draft === null) return undefined;
    if (draft.digest === frame.digest) {
      doc.replaceText(draft.text);
      return undefined;
    }
    return this.restored(frame, doc, draft.text);
  }

  private async restored(frame: Extract<DocumentFrame, { readonly kind: 'whole' }>, doc: TextDocument, text: string): Promise<void> {
    const epoch = this.epoch;
    const edits = await this.differ.edits(frame.text, text, `${this.key}#frames`);
    if (edits === null || epoch !== this.epoch || this.document !== doc) return;
    this.enterConflict(DiskText.of(lfText(frame.text), frame.digest), bufferRanges(edits));
    doc.replaceText(text);
  }

  private change(frame: Extract<DocumentFrame, { readonly kind: 'change' }>): void {
    const doc = this.document;
    if (doc === null) {
      this.resync();
      return;
    }
    if (frame.write !== undefined && this.writes.echoed(frame.write, frame.digest)) return;
    if (frame.digest === (this.disk?.digest ?? doc.digest)) return;
    this.gone.clear(this.key);
    this.foreign(frame.edits, frame.digest, null);
  }

  private foreign(edits: readonly LineEdit[], digest: string, text: string | null): void {
    const doc = this.document;
    if (doc === null) return;
    if (this.disk !== null) {
      this.disk = text === null ? this.disk.after(edits, digest) : DiskText.of(lfText(text), digest);
      return;
    }
    const result = doc.applyRemote(edits, digest);
    if (result.kind === 'applied') {
      this.writes.caughtUp();
      return;
    }
    if (result.kind === 'refused') {
      this.resync();
      return;
    }
    const base = doc.baseText;
    this.enterConflict(
      text === null ? DiskText.of(base, doc.digest).after(edits, digest) : DiskText.of(lfText(text), digest),
      result.ranges,
    );
  }
}
