import type { AuthorshipSide, PathAuthorship } from '@tagma/server/change-record/contract/wire/authorship';
import { type NamedHolder, holderKey } from '@tagma/server/workspace/contract/wire/checkout';
import type { RootId } from '@tagma/server/workspace/contract/wire/ids';
import { SvelteMap } from 'svelte/reactivity';
import { Refusal } from '$lib/wire/refusal.js';
import { CheckoutRepo, type OpenRun } from './Repo.js';
import { contextOf, type DiffWidth } from './diffWidth.js';
import { handHues } from './handHues.js';

export type Hand = { readonly author: NamedHolder; readonly key: string; readonly hue: string; readonly lines: number };

export const handName = (hand: Hand): string =>
  hand.author.holder.kind === 'operator' ? 'You' : (hand.author.agentName ?? hand.author.holder.thread.slice(0, 8));

export type PathInRoot = {
  readonly projectId: number;
  readonly rootId: RootId;
  readonly path: string;
  readonly commit?: string;
  readonly base?: string;
  readonly side?: AuthorshipSide;
};

const placeOf = (at: PathInRoot | null): string => (at === null ? '' : `${at.base ?? ''}..${at.commit ?? ''}:${at.side ?? ''}:${at.path}`);

export class DiffReading {
  private opened = $state<{ readonly place: string; readonly runs: readonly OpenRun[] }>({ place: '', runs: [] });

  private readonly beyond = new SvelteMap<string, string>();

  constructor(
    private readonly repo: CheckoutRepo,
    private readonly at: () => PathInRoot | null,
    private readonly wanted: () => DiffWidth = () => 'whole',
  ) {}

  tooWide = $derived.by(() => this.beyond.has(placeOf(this.at())));

  narrowSaid = $derived.by(() => this.beyond.get(placeOf(this.at())) ?? null);

  width = $derived.by<DiffWidth>(() => (this.tooWide ? 'patch' : this.wanted()));

  private query = $derived.by(() => {
    const at = this.at();
    if (at === null) return null;
    return this.repo.authorship.key({ ...at, context: contextOf(this.width) });
  });

  answer = $derived<PathAuthorship | null>(this.query?.data ?? null);

  submodule = $derived(this.answer?.submodule ?? null);
  binary = $derived(this.answer?.binary ?? false);
  timedOut = $derived(this.answer?.timedOut ?? false);
  sides = $derived(this.answer?.sides ?? { before: null, after: null });

  failed = $derived(this.query?.error);

  private wideRefusal = $derived.by<Refusal | null>(() => {
    const failed = this.failed;
    return failed instanceof Refusal && failed.code === 'context-too-wide' ? failed : null;
  });

  refusedWide = $derived(this.wideRefusal !== null && !this.tooWide);

  said = $derived.by<string | undefined>(() => {
    const failed = this.failed;
    if (failed === undefined || failed === null) return undefined;
    if (failed instanceof Refusal) return failed.code === 'context-too-wide' ? undefined : failed.reason;
    return failed instanceof Error ? failed.message : String(failed);
  });

  private held = $derived.by<ReadonlyMap<string, { readonly author: NamedHolder; readonly lines: number }>>(() => {
    const held = new Map<string, { readonly author: NamedHolder; readonly lines: number }>();
    for (const line of this.answer?.lines ?? []) {
      if (line.author === null) continue;
      const key = holderKey(line.author.holder);
      held.set(key, { author: line.author, lines: (held.get(key)?.lines ?? 0) + 1 });
    }
    return held;
  });

  hands(mine: string | null): readonly Hand[] {
    const others = [...this.held].filter(([key]) => key !== mine);
    const hues = handHues(others.map(([key]) => ({ threadId: key })));
    return others.map(([key, one]) => ({ author: one.author, key, hue: hues.get(key) ?? '', lines: one.lines }));
  }

  async expand(ask: OpenRun): Promise<void> {
    const at = this.at();
    if (at === null) return;
    const context = contextOf(this.width);
    const place = placeOf(at);
    const standing = this.opened.place === place ? this.opened.runs : [];
    const open = [...standing.filter((run) => run.at !== ask.at), ask];
    const answer = await this.repo.openRuns.run({ ...at, context, open }, { throwOnError: true });
    if (answer === undefined) return;
    this.repo.authorship.key({ ...at, context }).setCache(answer);
    this.opened = { place, runs: open };
  }

  narrowToPatch(): void {
    const at = this.at();
    const refused = this.wideRefusal;
    if (at === null || refused === null) return;
    this.beyond.set(placeOf(at), refused.reason);
  }

  narrow(): void {
    this.opened = { place: '', runs: [] };
  }

  refresh(): void {
    void this.query?.refresh().catch(() => undefined);
  }
}
