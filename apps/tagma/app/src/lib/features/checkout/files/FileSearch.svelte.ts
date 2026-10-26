import type { SearchFrame, SearchMatch } from '@tagma/server/checkout-files/contract/wire/search';
import type { RootId } from '@tagma/server/workspace/contract/wire/ids';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { untrack } from 'svelte';
import { SvelteSet } from 'svelte/reactivity';
import { Checkout } from '$lib/features/checkout/Selection.svelte.js';
import { GraphDoor } from '$lib/features/workspace/GraphDoor.js';
import { Live, type LiveConnection } from '$lib/wire/Live.js';

export type SearchDone = Extract<SearchFrame, { readonly kind: 'done' }>;

export type SearchRow =
  | { readonly kind: 'file'; readonly file: string; readonly count: number; readonly folded: boolean }
  | { readonly kind: 'match'; readonly file: string; readonly match: SearchMatch };

type Found = { readonly file: string; readonly matches: readonly SearchMatch[] };

const globs = (text: string): readonly string[] =>
  text
    .split(',')
    .map((one) => one.trim())
    .filter((one) => one !== '');

export class FileSearch extends Service<FileSearch>()('FileSearch', { tier: 'graph' }) {
  static *make() {
    return new FileSearch(yield* Live, yield* GraphDoor, yield* Checkout, yield* Scope);
  }

  pattern = $state('');
  regex = $state(false);
  caseSensitive = $state(false);
  wholeWord = $state(false);
  include = $state('');
  exclude = $state('');

  readonly folded = new SvelteSet<string>();

  searching = $state(false);
  done = $state.raw<SearchDone | null>(null);
  failure = $state<string | null>(null);

  private found: Found[] = [];
  private arrivals = $state(0);
  private stream: { unsubscribe: () => void } | null = null;

  constructor(
    private readonly live: LiveConnection,
    private readonly door: GraphDoor,
    private readonly checkout: Checkout,
    scope: Scope,
  ) {
    super();
    const standing = $derived.by(() => checkout.row?.rootId ?? null);
    const stop = $effect.root(() => {
      $effect(() => {
        const root = standing;
        const ask = {
          pattern: this.pattern,
          regex: this.regex,
          caseSensitive: this.caseSensitive,
          wholeWord: this.wholeWord,
          include: this.include,
          exclude: this.exclude,
        };
        untrack(() => this.restart(root, ask));
      });
    });
    scope.defer(() => {
      stop();
      this.stream?.unsubscribe();
    });
  }

  get files(): number {
    void this.arrivals;
    return this.found.length;
  }

  rows(limit: number): { readonly rows: readonly SearchRow[]; readonly more: boolean } {
    void this.arrivals;
    const rows: SearchRow[] = [];
    for (const { file, matches } of this.found) {
      if (rows.length >= limit) return { rows, more: true };
      const folded = this.folded.has(file);
      rows.push({ kind: 'file', file, count: matches.length, folded });
      if (folded) continue;
      for (const match of matches) {
        if (rows.length >= limit) return { rows, more: true };
        rows.push({ kind: 'match', file, match });
      }
    }
    return { rows, more: false };
  }

  fold(file: string): void {
    if (!this.folded.delete(file)) this.folded.add(file);
  }

  private restart(
    root: RootId | null,
    ask: {
      readonly pattern: string;
      readonly regex: boolean;
      readonly caseSensitive: boolean;
      readonly wholeWord: boolean;
      readonly include: string;
      readonly exclude: string;
    },
  ): void {
    this.stream?.unsubscribe();
    this.stream = null;
    this.found = [];
    this.arrivals += 1;
    this.folded.clear();
    this.done = null;
    this.failure = null;
    this.searching = false;
    if (root === null || ask.pattern === '') return;
    const include = globs(ask.include);
    const exclude = globs(ask.exclude);
    this.searching = true;
    this.stream = this.live.hold(
      (client) =>
        client['search.subscribe']({
          projectId: this.door.aim.projectId,
          root,
          pattern: ask.pattern,
          regex: ask.regex,
          caseSensitive: ask.caseSensitive,
          wholeWord: ask.wholeWord,
          include: include.length === 0 ? undefined : include,
          exclude: exclude.length === 0 ? undefined : exclude,
        }),
      (frame) => {
        if (frame.kind === 'file') {
          this.found.push({ file: frame.file, matches: frame.matches });
          this.arrivals += 1;
          return;
        }
        this.found.sort((one, other) => one.file.localeCompare(other.file));
        this.arrivals += 1;
        this.done = frame;
        this.searching = false;
      },
      (reason) => {
        if (reason.kind === 'subscription' && reason.code === 'search-superseded') return;
        this.failure = reason.message;
        this.searching = false;
      },
      'feed',
      'once',
    );
  }
}
