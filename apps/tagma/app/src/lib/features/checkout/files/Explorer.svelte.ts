import type { DirectoryEntry, TreeFrame } from '@tagma/server/checkout-files/contract/wire/directory';
import type { CheckoutEntryStatus } from '@tagma/server/workspace/contract/wire/checkout';
import type { RootId } from '@tagma/server/workspace/contract/wire/ids';
import { Failure } from '@runlith/layer/Failure';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { untrack } from 'svelte';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { GraphDoor } from '$lib/features/workspace/GraphDoor.js';
import { Checkout } from '$lib/features/checkout/Selection.svelte.js';
import { Live, type LiveConnection } from '$lib/wire/Live.js';
import { refusalOf } from '$lib/wire/refusal.js';
import { TreeDecorations } from './decorations.js';

export const DIRECTORY_PAGE = 200;

const DIRECTORY_CEILING = 500;

export type Listing = {
  readonly entries: readonly DirectoryEntry[];
  readonly total: number;
  readonly next: string | null;
  readonly ignored: boolean;
  readonly loading: boolean;
  readonly failed: string | null;
};

type ReadHow = { readonly ignored?: boolean; readonly after?: Listing; readonly again?: boolean };

export type Draft = { readonly kind: 'file' | 'folder'; readonly dir: string } | { readonly kind: 'rename'; readonly path: string };

export type TreeRow =
  | { readonly kind: 'draft'; readonly key: string; readonly depth: number; readonly mode: 'file' | 'folder' }
  | {
      readonly kind: 'entry';
      readonly renaming: boolean;
      readonly key: string;
      readonly path: string;
      readonly name: string;
      readonly depth: number;
      readonly type: DirectoryEntry['kind'];
      readonly ignored: boolean;
      readonly target: DirectoryEntry['target'];
      readonly open: boolean;
      readonly loading: boolean;
    }
  | {
      readonly kind: 'more';
      readonly key: string;
      readonly dir: string;
      readonly depth: number;
      readonly remaining: number;
      readonly loading: boolean;
    }
  | { readonly kind: 'note'; readonly key: string; readonly depth: number; readonly text: string };

const join = (dir: string, name: string): string => (dir === '' ? name : `${dir}/${name}`);

const opens = (entry: DirectoryEntry): boolean => entry.kind === 'directory' || (entry.kind === 'link' && entry.target === 'directory');

export class Explorer extends Service<Explorer>()('Explorer', { tier: 'graph' }) {
  static *make() {
    return new Explorer(yield* Live, yield* GraphDoor, yield* Checkout, yield* Scope, yield* Failure);
  }

  readonly expanded = new SvelteSet<string>();

  readonly selected = new SvelteSet<string>();

  draft = $state.raw<Draft | null>(null);

  anchor: string | null = null;

  private readonly listings = new SvelteMap<string, Listing>();
  private readonly reading = new Map<string, AbortController>();
  private readonly waiting = new Set<string>();
  private readonly settling = new Map<string, Promise<void>>();
  private holds = 0;
  private stream: { unsubscribe: () => void } | null = null;
  private closed = false;

  rootId = $state<RootId | null>(null);

  constructor(
    private readonly live: LiveConnection,
    private readonly door: GraphDoor,
    private readonly checkout: Checkout,
    scope: Scope,
    private readonly failure: Failure,
  ) {
    super();
    const standing = $derived.by(() => checkout.row?.rootId ?? null);
    const stop = $effect.root(() => {
      $effect(() => {
        const next = standing;
        untrack(() => this.follow(next));
      });
      $effect(() => {
        const entries = checkout.sections.flatMap((section) => section.entries);
        untrack(() => this.decorated.apply(entries));
      });
    });
    scope.defer(() => {
      this.closed = true;
      stop();
      this.stream?.unsubscribe();
      for (const reading of this.reading.values()) reading.abort();
    });
  }

  private readonly decorated = new TreeDecorations();

  statusOf(path: string, directory: boolean): CheckoutEntryStatus | undefined {
    return this.decorated.statusOf(path, directory);
  }

  listingOf(dir: string): Listing | undefined {
    return this.listings.get(dir);
  }

  rows = $derived.by<readonly TreeRow[]>(() => {
    const out: TreeRow[] = [];
    const walk = (dir: string, depth: number): void => {
      const listing = this.listings.get(dir);
      if (listing === undefined) return;
      const draft = this.draft;
      if (draft !== null && draft.kind !== 'rename' && draft.dir === dir) {
        out.push({ kind: 'draft', key: '\u0000draft', depth, mode: draft.kind });
      }
      for (const entry of listing.entries) {
        const path = join(dir, entry.name);
        const directory = opens(entry);
        const open = directory && this.expanded.has(path);
        out.push({
          kind: 'entry',
          renaming: this.draft?.kind === 'rename' && this.draft.path === path,
          key: path,
          path,
          name: entry.name,
          depth,
          type: entry.kind,
          ignored: entry.ignored,
          target: entry.target,
          open,
          loading: open && (this.listings.get(path)?.loading ?? true),
        });
        if (open) walk(path, depth + 1);
      }
      if (listing.next !== null) {
        out.push({
          kind: 'more',
          key: `${dir}\u0000more`,
          dir,
          depth,
          remaining: listing.total - listing.entries.length,
          loading: listing.loading,
        });
      } else if (listing.failed !== null) {
        out.push({ kind: 'note', key: `${dir}\u0000failed`, depth, text: listing.failed });
      } else if (dir !== '' && listing.entries.length === 0 && !listing.loading) {
        out.push({ kind: 'note', key: `${dir}\u0000empty`, depth, text: 'Empty' });
      }
    };
    walk('', 0);
    return out;
  });

  toggle(path: string, ignored = false): void {
    if (this.expanded.has(path)) this.collapse(path);
    else this.expand(path, ignored);
  }

  expand(path: string, ignored = false): void {
    this.expanded.add(path);
    if (!this.listings.has(path)) void this.read(path, { ignored });
  }

  collapse(path: string): void {
    this.expanded.delete(path);
    for (const open of [...this.expanded]) if (open.startsWith(`${path}/`)) this.expanded.delete(open);
  }

  select(path: string, how: 'only' | 'toggle' | 'range'): void {
    const order = this.rows.flatMap((row) => (row.kind === 'entry' ? [row.path] : []));
    const from = this.anchor === null ? -1 : order.indexOf(this.anchor);
    const to = order.indexOf(path);
    if (how === 'range' && from !== -1 && to !== -1) {
      this.selected.clear();
      for (const one of order.slice(Math.min(from, to), Math.max(from, to) + 1)) this.selected.add(one);
      return;
    }
    if (how === 'toggle') {
      if (!this.selected.delete(path)) this.selected.add(path);
    } else {
      this.selected.clear();
      this.selected.add(path);
    }
    this.anchor = path;
  }

  moved(pairs: readonly { readonly from: string; readonly to: string }[]): void {
    const inside = (path: string, dir: string): boolean => path === dir || path.startsWith(`${dir}/`);
    for (const { from, to } of pairs) {
      for (const open of [...this.expanded]) {
        if (!inside(open, from)) continue;
        this.expanded.delete(open);
        this.expanded.add(to + open.slice(from.length));
      }
      for (const dir of [...this.listings.keys()]) if (inside(dir, from)) this.listings.delete(dir);
    }
    this.selected.clear();
  }

  refresh(paths: readonly string[]): void {
    const dirs = new Set(paths.map((path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')));
    for (const dir of dirs) if (this.listings.has(dir)) void this.read(dir, { again: true });
    for (const open of this.expanded) if (!this.listings.has(open) && this.shown(open)) void this.read(open, {});
  }

  more(dir: string): void {
    const listing = this.listings.get(dir);
    if (listing === undefined || listing.next === null || listing.loading) return;
    void this.read(dir, { after: listing });
  }

  async reveal(path: string): Promise<boolean> {
    const parts = path.split('/');
    let dir = '';
    for (const [at, name] of parts.entries()) {
      if (!(await this.ensure(dir, name))) return false;
      if (at === parts.length - 1) return true;
      dir = dir === '' ? name : `${dir}/${name}`;
      this.expanded.add(dir);
    }
    return false;
  }

  unfold(path: string): void {
    this.expand(path, this.ignoredIn(path));
    this.select(path, 'only');
  }

  private async ensure(dir: string, name: string): Promise<boolean> {
    for (;;) {
      const listing = this.listings.get(dir);
      if (listing === undefined) await (this.settling.get(dir) ?? this.read(dir, { ignored: dir === '' ? false : this.ignoredIn(dir) }));
      else if (listing.loading) await this.settling.get(dir);
      else if (listing.entries.some((entry) => entry.name === name)) return true;
      else if (listing.next !== null) await this.read(dir, { after: listing });
      else return false;
      if (this.listings.get(dir)?.failed) return false;
    }
  }

  hold(): () => void {
    this.holds += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.holds -= 1;
      if (this.holds === 0) this.catchUp();
    };
  }

  private ignoredIn(dir: string): boolean {
    const cut = dir.lastIndexOf('/');
    const parent = cut === -1 ? '' : dir.slice(0, cut);
    const name = cut === -1 ? dir : dir.slice(cut + 1);
    const listing = this.listings.get(parent);
    return listing?.ignored === true || listing?.entries.find((entry) => entry.name === name)?.ignored === true;
  }

  private follow(next: RootId | null): void {
    if (next === this.rootId) return;
    this.stream?.unsubscribe();
    this.stream = null;
    for (const reading of this.reading.values()) reading.abort();
    this.reading.clear();
    this.listings.clear();
    this.expanded.clear();
    this.waiting.clear();
    this.settling.clear();
    this.rootId = next;
    if (next === null) return;
    void this.read('', {});
    this.stream = this.live.hold(
      (client) => client['tree.subscribe']({ projectId: this.door.aim.projectId, root: next }),
      (frame) => this.frame(frame),
      (reason) => {
        if (reason.kind !== 'subscription' || this.closed) return;
        this.failure.report(
          reason.code === undefined
            ? new Error(reason.message)
            : refusalOf({ code: reason.code, reason: reason.message, unblock: reason.unblock ?? [] }),
        );
      },
    );
  }

  private frame(frame: TreeFrame): void {
    const dirs = frame.kind === 'rescan' ? ['', ...this.expanded] : frame.dirs;
    for (const dir of dirs) {
      if (!this.listings.has(dir)) continue;
      if (!this.shown(dir)) {
        this.listings.delete(dir);
        continue;
      }
      if (this.holds > 0) this.waiting.add(dir);
      else void this.read(dir, { again: true });
    }
  }

  private shown(dir: string): boolean {
    for (let at = dir; at !== ''; at = at.includes('/') ? at.slice(0, at.lastIndexOf('/')) : '') {
      if (!this.expanded.has(at)) return false;
    }
    return true;
  }

  private catchUp(): void {
    const dirs = [...this.waiting];
    this.waiting.clear();
    for (const dir of dirs) if (this.listings.has(dir)) void this.read(dir, { again: true });
  }

  private read(dir: string, how: ReadHow): Promise<void> {
    const run = this.load(dir, how);
    this.settling.set(dir, run);
    void run.then(() => {
      if (this.settling.get(dir) === run) this.settling.delete(dir);
    });
    return run;
  }

  private async load(dir: string, how: ReadHow): Promise<void> {
    const rootId = this.rootId;
    if (rootId === null) return;
    this.reading.get(dir)?.abort();
    const reading = new AbortController();
    this.reading.set(dir, reading);
    const before = this.listings.get(dir);
    const ignored = how.ignored ?? before?.ignored ?? false;
    const keep = how.after?.entries ?? [];
    this.listings.set(dir, {
      entries: how.again === true ? (before?.entries ?? []) : keep,
      total: before?.total ?? 0,
      next: how.after?.next ?? null,
      ignored,
      loading: true,
      failed: null,
    });
    const want = how.again === true ? Math.min(Math.max(before?.entries.length ?? 0, DIRECTORY_PAGE), DIRECTORY_CEILING) : DIRECTORY_PAGE;
    try {
      let entries: readonly DirectoryEntry[] = keep;
      let cursor: string | null = how.after?.next ?? null;
      let total = before?.total ?? 0;
      do {
        const page = await this.door.perform(
          'read_directory',
          {
            root: rootId,
            path: dir === '' ? undefined : dir,
            ignored: ignored ? true : undefined,
            limit: want,
            cursor: cursor ?? undefined,
          },
          { signal: reading.signal },
        );
        entries = [...entries, ...page.entries];
        cursor = page.next;
        total = page.total;
      } while (how.again === true && cursor !== null && entries.length < (before?.entries.length ?? 0));
      if (reading.signal.aborted) return;
      this.listings.set(dir, { entries, total, next: cursor, ignored, loading: false, failed: null });
    } catch (error) {
      if (reading.signal.aborted || this.closed) return;
      this.listings.set(dir, {
        entries: how.again === true ? (before?.entries ?? []) : keep,
        total: before?.total ?? 0,
        next: how.after?.next ?? null,
        ignored,
        loading: false,
        failed: refusalOf(error).reason,
      });
    } finally {
      if (this.reading.get(dir) === reading) this.reading.delete(dir);
    }
  }
}
