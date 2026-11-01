import type { ListedBlock } from '@tagma/server/graph/contract/wire/rows';
import { SPEC } from '@tagma/server/graph/contract/wire/tags/spec';
import { WORK } from '@tagma/server/graph/contract/wire/tags/work';
import type { PlatformStorage } from '@runlith/layer/Platform';
import { SvelteSet } from 'svelte/reactivity';
import type { TagCatalog } from '$lib/features/graph/TagCatalog.svelte.js';

export type StateFilter = 'open' | 'in_work' | 'ready' | 'blocked' | 'done' | 'closed' | 'superseded';

const ALL_LENSES: readonly StateFilter[] = ['open', 'in_work', 'ready', 'blocked', 'done', 'closed', 'superseded'];

const LENS_STATUSES = ['open', 'in_work', 'done', 'closed'] as const;

function isLensStatus(word: string): word is (typeof LENS_STATUSES)[number] {
  return (LENS_STATUSES as readonly string[]).includes(word);
}

const MEASURED_LENSES: readonly StateFilter[] = ['superseded'];

export const LENS_LABEL: Record<StateFilter, string> = {
  open: 'Open',
  in_work: 'In work',
  ready: 'Ready',
  blocked: 'Blocked',
  done: 'Done',
  closed: 'Closed',
  superseded: 'Superseded',
};

export function lensesFor(catalog: TagCatalog, picked: ReadonlySet<string>): StateFilter[] {
  const union = new Set<StateFilter>(MEASURED_LENSES);
  if (picked.size === 0) return [...ALL_LENSES];
  for (const id of picked) {
    const frontier = catalog.binds(id, WORK);
    if (frontier) {
      union.add('ready');
      union.add('blocked');
    }
    if (catalog.binds(id, SPEC)) union.add('in_work');
    const born = frontier ? catalog.bornAt(id) : null;
    for (const word of catalog.statusWordsOf(id)) {
      if (word !== born && isLensStatus(word)) union.add(word);
    }
  }
  return ALL_LENSES.filter((lens) => union.has(lens));
}

export type SortMode = 'manual' | 'updated-desc' | 'updated-asc' | 'created-desc';

export const SORT_MODES: readonly SortMode[] = ['manual', 'updated-desc', 'updated-asc', 'created-desc'];

export const SORT_LABEL: Record<SortMode, string> = {
  manual: 'Manual order',
  'updated-desc': 'Recently updated',
  'updated-asc': 'Oldest updated',
  'created-desc': 'Recently created',
};

export class ReadingLens {
  readonly tags = new SvelteSet<string>();
  readonly states = new SvelteSet<StateFilter>();
  sortMode = $state<SortMode>('manual');
  readonly exempt = new SvelteSet<string>();
  private memory: string | null = null;

  constructor(
    private readonly frontier: ReadonlySet<string>,
    private readonly catalog: TagCatalog,
    private readonly storage: PlatformStorage,
  ) {}

  get active(): boolean {
    return this.tags.size > 0 || this.states.size > 0;
  }

  matches(row: ListedBlock): boolean {
    const tag = this.catalog.tagOf(row);
    if (this.tags.size > 0 && (tag === null || !this.tags.has(tag))) return false;
    if (this.states.size === 0) return true;
    const status = this.catalog.statusOf(row);
    for (const state of this.states) {
      if (state === 'ready') {
        if (this.frontier.has(row.identity)) return true;
        continue;
      }
      if (state === 'blocked') {
        if (row.blocked) return true;
        continue;
      }
      if (state === 'superseded') {
        if (row.superseded) return true;
        continue;
      }
      if (state === 'in_work' && row.building) return true;
      if (status === state) return true;
    }
    return false;
  }

  selectTag(tag: string, on: boolean): void {
    if (on) this.tags.add(tag);
    else this.tags.delete(tag);
    this.prune();
    this.exempt.clear();
    this.remember();
  }

  clearTags(): void {
    this.tags.clear();
    this.prune();
    this.exempt.clear();
    this.remember();
  }

  selectState(state: StateFilter, on: boolean): void {
    if (on) this.states.add(state);
    else this.states.delete(state);
    this.exempt.clear();
    this.remember();
  }

  clearStates(): void {
    this.states.clear();
    this.exempt.clear();
    this.remember();
  }

  setSortMode(mode: SortMode): void {
    this.sortMode = mode;
    this.remember();
  }

  clear(): void {
    this.tags.clear();
    this.states.clear();
    this.sortMode = 'manual';
    this.exempt.clear();
    this.remember();
  }

  private prune(): void {
    if (!this.catalog.served) return;
    const offered = lensesFor(this.catalog, this.tags);
    for (const state of [...this.states]) {
      if (!offered.includes(state)) this.states.delete(state);
    }
  }

  restore(key: string): void {
    this.memory = key;
    try {
      const stored = JSON.parse(this.storage.getItem(key) ?? 'null') as {
        tags?: string[];
        states?: StateFilter[];
        sort?: SortMode;
      } | null;
      if (!stored) return;
      this.tags.clear();
      for (const tag of stored.tags ?? []) {
        if (!this.catalog.served || this.catalog.declared.includes(tag)) this.tags.add(tag);
      }
      this.states.clear();
      for (const state of stored.states ?? []) {
        if (ALL_LENSES.includes(state)) this.states.add(state);
      }
      this.sortMode = stored.sort != null && SORT_MODES.includes(stored.sort) ? stored.sort : 'manual';
    } catch {}
  }

  private remember(): void {
    const key = this.memory;
    if (key === null) return;
    if (!this.active && this.sortMode === 'manual') {
      this.storage.removeItem(key);
    } else {
      this.storage.setItem(key, JSON.stringify({ tags: [...this.tags], states: [...this.states], sort: this.sortMode }));
    }
  }
}
