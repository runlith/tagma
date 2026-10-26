import type { PageId } from '@tagma/server/browser/contract/wire/ids';
import type { Budget, InputEvent, ScreencastEvent } from '@tagma/server/browser/contract/wire/screencast';
import type { LiveConnection } from '$lib/wire/Live.js';
import type { Size } from './input.js';

//! base64 in one socket message must stay under Bun's default 16 MiB websocket payload
const FILES_MAX_BYTES = 11 * 2 ** 20;

export type Picture = { readonly bitmap: ImageBitmap; readonly view: Size };

const merged = (last: InputEvent | undefined, next: InputEvent): InputEvent | null => {
  if (last === undefined) return null;
  if (next.kind === 'wheel' && last.kind === 'wheel' && next.modifiers === last.modifiers)
    return { ...next, dx: last.dx + next.dx, dy: last.dy + next.dy };
  if (next.kind === 'mouse' && next.type === 'move' && last.kind === 'mouse' && last.type === 'move') return next;
  if (next.kind === 'view' && last.kind === 'view') return next;
  return null;
};

export class Cast {
  picture = $state.raw<Picture | null>(null);

  chooser = $state.raw<{ readonly multiple: boolean } | null>(null);

  failure = $state<string | null>(null);

  private budget: Budget | null = null;

  private viewer: string | null = null;

  private seq = 0;

  private queued: InputEvent[] = [];

  private scheduled = false;

  private held: { unsubscribe: () => void } | null = null;

  private drawn = 0;

  private closed = false;

  constructor(
    private readonly live: LiveConnection,
    private readonly projectId: number,
    private readonly page: PageId,
  ) {}

  watch(budget: Budget): void {
    if (this.closed) return;
    this.held?.unsubscribe();
    this.budget = budget;
    this.viewer = null;
    this.queued = [];
    this.failure = null;
    this.held = this.live.hold(
      (client) =>
        client['browser.screencast']({ projectId: this.projectId, page: this.page, ...(this.budget ?? budget) }, { streamBufferSize: 1 }),
      (event) => this.take(event),
      (failure) => {
        this.failure = failure.message;
      },
      'frame',
      'again',
      'separate',
    );
  }

  pause(): void {
    this.held?.unsubscribe();
    this.held = null;
    this.viewer = null;
    this.queued = [];
  }

  resume(): void {
    if (this.held === null && this.budget !== null) this.watch(this.budget);
  }

  view(size: Size, scale: number): void {
    if (this.budget === null) return;
    this.budget = { ...this.budget, width: size.width, height: size.height, scale };
    this.send({ kind: 'view', width: size.width, height: size.height, scale });
  }

  send(event: InputEvent): void {
    const joined = merged(this.queued.at(-1), event);
    if (joined === null) this.queued.push(event);
    else this.queued[this.queued.length - 1] = joined;
    if (this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame(() => {
      this.scheduled = false;
      void this.flush();
    });
  }

  async copy(): Promise<string | null> {
    this.queued.push({ kind: 'copy' });
    return this.flush();
  }

  async choose(files: readonly File[]): Promise<void> {
    const total = files.reduce((sum, file) => sum + file.size, 0);
    if (total > FILES_MAX_BYTES) {
      this.failure = `The chosen files hold ${Math.ceil(total / 2 ** 20)} MiB; a page takes at most ${FILES_MAX_BYTES / 2 ** 20} MiB at once from this view.`;
      return;
    }
    this.chooser = null;
    const chosen = await Promise.all(files.map(async (file) => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })));
    await this.live
      .call((client) => client['browser.files']({ projectId: this.projectId, page: this.page, files: chosen }))
      .catch((error: unknown) => {
        this.failure = error instanceof Error ? error.message : String(error);
      });
  }

  close(): void {
    this.closed = true;
    this.viewer = null;
    this.queued = [];
    this.held?.unsubscribe();
    this.held = null;
    this.picture?.bitmap.close();
    this.picture = null;
  }

  private async flush(): Promise<string | null> {
    const viewer = this.viewer;
    if (viewer === null || this.queued.length === 0) return null;
    const events = this.queued;
    this.queued = [];
    const seq = this.seq;
    this.seq += 1;
    try {
      const answer = await this.live.call((client) =>
        client['browser.input']({ projectId: this.projectId, page: this.page, viewer, seq, events }),
      );
      return answer.copied;
    } catch (error) {
      if (this.viewer === viewer && this.held !== null && this.budget !== null) this.watch(this.budget);
      console.error('[tagma] the input of a page view was not delivered', error);
      return null;
    }
  }

  private async take(event: ScreencastEvent): Promise<void> {
    switch (event.type) {
      case 'viewer':
        this.viewer = event.viewer;
        this.seq = 0;
        return;
      case 'chooser':
        this.chooser = { multiple: event.multiple };
        return;
      case 'chosen':
        this.chooser = null;
        return;
      case 'frame': {
        const order = ++this.drawn;
        const bitmap = await fetch(`data:image/jpeg;base64,${event.data}`)
          .then((response) => response.blob())
          .then((blob) => createImageBitmap(blob))
          .catch((error: unknown) => {
            this.failure = `A picture of the page could not be drawn: ${error instanceof Error ? error.message : String(error)}`;
            return null;
          });
        if (bitmap === null) return;
        if (order !== this.drawn || this.held === null) {
          bitmap.close();
          return;
        }
        this.picture?.bitmap.close();
        this.picture = { bitmap, view: { width: event.width, height: event.height } };
        this.failure = null;
      }
    }
  }
}
