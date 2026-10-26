import type { RootId } from '@tagma/server/workspace/contract/wire/ids';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { Checkout } from '$lib/features/checkout/Selection.svelte.js';
import { GraphDoor } from '$lib/features/workspace/GraphDoor.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import type { DocumentPlace } from './documentKey.js';
import { Documents, Unsaved } from './Documents.svelte.js';
import { Explorer } from './Explorer.svelte.js';
import { kindFor } from './tab.js';
import { Tabs } from './Tabs.svelte.js';

export type Pair = { readonly from: string; readonly to: string };

type Step = { readonly undo: () => Promise<unknown>; readonly redo: () => Promise<unknown> };

type Stacks = { done: Step[]; undone: Step[] };

const STACK_KEPT = 50;

const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

const parentOf = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

const joined = (dir: string, name: string): string => (dir === '' ? name : `${dir}/${name}`);

export function cleanName(typed: string): string | null {
  const parts = typed
    .trim()
    .split('/')
    .filter((part) => part !== '');
  if (parts.length === 0 || parts.some((part) => part === '.' || part === '..')) return null;
  return parts.join('/');
}

export class FileOps extends Service<FileOps>()('FileOps', { tier: 'graph' }) {
  static *make() {
    return new FileOps(yield* GraphDoor, yield* Checkout, yield* Explorer, yield* Tabs, yield* Documents, yield* Notices, yield* Scope);
  }

  private readonly stacks = new Map<RootId, Stacks>();
  private releaseTree: (() => void) | null = null;

  constructor(
    private readonly door: GraphDoor,
    private readonly checkout: Checkout,
    private readonly explorer: Explorer,
    private readonly tabs: Tabs,
    private readonly documents: Documents,
    private readonly notices: Notices,
    private readonly life: Scope,
  ) {
    super();
    life.defer(() => this.endDraft());
  }

  get absolute(): string | null {
    return this.checkout.row?.path ?? null;
  }

  copy(path: string, relative: boolean): void {
    const root = this.absolute;
    void navigator.clipboard.writeText(relative || root === null ? path : `${root}/${path}`);
  }

  async reveal(path: string): Promise<void> {
    const root = this.explorer.rootId;
    if (root !== null) await this.attempt(() => this.door.perform('reveal_entry', { root, path }));
  }

  beginCreate(dir: string, kind: 'file' | 'folder'): void {
    if (dir !== '') this.explorer.expand(dir);
    this.startDraft({ kind, dir });
  }

  beginRename(path: string): void {
    this.startDraft({ kind: 'rename', path });
  }

  endDraft(): void {
    this.explorer.draft = null;
    this.releaseTree?.();
    this.releaseTree = null;
  }

  holdTree(): () => void {
    return this.explorer.hold();
  }

  async commitDraft(typed: string): Promise<boolean> {
    const draft = this.explorer.draft;
    const name = cleanName(typed);
    if (draft === null) return true;
    if (name === null) {
      this.notices.error('Not a file name', `“${typed.trim()}” cannot name an entry.`);
      return false;
    }
    let done: boolean;
    if (draft.kind === 'rename') {
      const to = joined(parentOf(draft.path), name);
      done = to === draft.path || (await this.move([{ from: draft.path, to }]));
    } else {
      done = await this.create(joined(draft.dir, name), draft.kind === 'file' ? 'file' : 'directory');
    }
    if (done) this.endDraft();
    return done;
  }

  async create(path: string, kind: 'file' | 'directory'): Promise<boolean> {
    const root = this.explorer.rootId;
    if (root === null) return false;
    const made = await this.attempt(() => this.door.perform('create_entry', { root, path, kind }));
    if (made === null) return false;
    let trash: string | null = null;
    this.remember(root, {
      undo: async () => {
        trash = await this.trashOnce(root, [path]);
      },
      redo: async () => {
        if (trash !== null) await this.restoreOnce(root, trash, [path]);
      },
    });
    this.explorer.refresh([path]);
    if (kind === 'file') this.tabs.open({ rootId: root, path, kind: kindFor(path) }, 'open');
    await this.explorer.reveal(path);
    this.explorer.select(path, 'only');
    return true;
  }

  async move(pairs: readonly Pair[]): Promise<boolean> {
    const root = this.explorer.rootId;
    if (root === null || pairs.length === 0) return false;
    if ((await this.attempt(() => this.moveOnce(root, pairs))) === null) return false;
    this.remember(root, {
      undo: () =>
        this.moveOnce(
          root,
          pairs.map(({ from, to }) => ({ from: to, to: from })),
        ),
      redo: () => this.moveOnce(root, pairs),
    });
    return true;
  }

  async trash(paths: readonly string[]): Promise<void> {
    const root = this.explorer.rootId;
    if (root === null || paths.length === 0) return;
    let trash = await this.attempt(() => this.trashOnce(root, paths));
    if (trash === null) return;
    const step: Step = {
      undo: async () => {
        if (trash !== null) await this.restoreOnce(root, trash, paths);
      },
      redo: async () => {
        trash = await this.trashOnce(root, paths);
      },
    };
    this.remember(root, step);
    const name = paths.length === 1 ? baseName(paths[0] as string) : `${paths.length} entries`;
    this.notices.undoable(`Deleted ${name}`, () => void this.revert(root, step), this.life);
  }

  async undo(): Promise<void> {
    const root = this.explorer.rootId;
    const stack = root === null ? undefined : this.stacks.get(root);
    const step = stack?.done.at(-1);
    if (root === null || step === undefined) return;
    await this.revert(root, step);
  }

  async redo(): Promise<void> {
    const root = this.explorer.rootId;
    const stack = root === null ? undefined : this.stacks.get(root);
    const step = stack?.undone.at(-1);
    if (stack === undefined || step === undefined) return;
    stack.undone.pop();
    if ((await this.attempt(step.redo)) !== null) stack.done.push(step);
  }

  private async revert(root: RootId, step: Step): Promise<void> {
    const stack = this.stacks.get(root);
    const at = stack?.done.indexOf(step) ?? -1;
    if (stack === undefined || at === -1) return;
    stack.done.splice(at, 1);
    if ((await this.attempt(step.undo)) !== null) stack.undone.push(step);
  }

  private remember(root: RootId, step: Step): void {
    const stack = this.stacks.get(root) ?? { done: [], undone: [] };
    this.stacks.set(root, stack);
    stack.done = [...stack.done, step].slice(-STACK_KEPT);
    stack.undone = [];
  }

  private startDraft(draft: NonNullable<Explorer['draft']>): void {
    this.endDraft();
    this.releaseTree = this.explorer.hold();
    this.explorer.draft = draft;
  }

  private async attempt<T>(work: () => Promise<T>): Promise<T | null> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof Unsaved) this.notices.error('Not saved', error.message);
      else this.notices.refusal(error);
      return null;
    }
  }

  private async moveOnce(root: RootId, pairs: readonly Pair[]): Promise<true> {
    const place = this.placeOf(root);
    const release = await this.documents.settle(
      place,
      pairs.map((pair) => pair.from),
    );
    try {
      await this.door.perform('move_entries', { root, pairs: [...pairs] });
      this.documents.relocate(place, pairs);
      this.tabs.retarget(root, pairs);
      this.explorer.moved(pairs);
      this.explorer.refresh([...pairs.map((pair) => pair.from), ...pairs.map((pair) => pair.to)]);
    } finally {
      release();
    }
    return true;
  }

  private placeOf(root: RootId): DocumentPlace {
    return { projectId: this.door.aim.projectId, rootId: root };
  }

  private async trashOnce(root: RootId, paths: readonly string[]): Promise<string> {
    const release = await this.documents.settle(this.placeOf(root), paths);
    try {
      const answer = await this.door.perform('trash_entries', { root, paths: [...paths] });
      this.tabs.markDeleted(root, paths, true);
      this.explorer.selected.clear();
      this.explorer.refresh(paths);
      return answer.trash;
    } finally {
      release();
    }
  }

  private async restoreOnce(root: RootId, trash: string, paths: readonly string[]): Promise<void> {
    await this.door.perform('restore_entries', { root, trash });
    this.tabs.markDeleted(root, paths, false);
    this.explorer.refresh(paths);
  }
}
