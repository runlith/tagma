import type { CheckoutTotals, Holding, HoldingsFrame, HoldingsState } from '@tagma/server/change-record/contract/wire/holdings';
import { SvelteMap } from 'svelte/reactivity';
import type { LiveConnection } from '$lib/wire/Live.js';
import { refusalOf } from '$lib/wire/refusal.js';

export type CheckoutTarget = { readonly root?: string };

export type HoldingsHead = {
  readonly checkout: string;
  readonly revision: number;
  readonly head: string | null;
  readonly row: number | null;
  readonly state: HoldingsState;
  readonly totals: CheckoutTotals;
};

export class HoldingsReading {
  view = $state.raw<HoldingsHead | null>(null);

  unread = $state<string | null>(null);

  readonly paths = new SvelteMap<string, Holding>();

  private held: { unsubscribe: () => void } | null = null;

  private aimed: CheckoutTarget | null = null;

  constructor(
    private readonly live: LiveConnection,
    private readonly projectId: number,
  ) {}

  of(path: string): Holding | undefined {
    return this.paths.get(path);
  }

  behind(row: { readonly rootId: string; readonly revision: number } | null): boolean {
    const view = this.view;
    if (view === null || row === null) return true;
    return view.checkout !== row.rootId || view.row === null || view.row < row.revision;
  }

  aim(reading: CheckoutTarget | null): void {
    this.close();
    this.aimed = reading;
    if (reading === null) return;
    this.held = this.live.hold(
      (client) => client['holdings.subscribe']({ projectId: this.projectId, ...reading }),
      (frame) => this.apply(frame),
      (reason) => {
        if (reason.kind !== 'subscription') return;
        this.unread = refusalOf({ code: reason.code ?? 'http', reason: reason.message, unblock: reason.unblock ?? [] }).reason;
      },
    );
  }

  retry(): void {
    this.aim(this.aimed);
  }

  close(): void {
    this.held?.unsubscribe();
    this.held = null;
    this.view = null;
    this.unread = null;
    this.paths.clear();
  }

  private apply(frame: HoldingsFrame): void {
    if (frame.kind === 'whole') {
      this.paths.clear();
      for (const holding of frame.paths) this.paths.set(holding.path, holding);
    } else {
      for (const path of frame.gone) this.paths.delete(path);
      for (const holding of frame.changed) this.paths.set(holding.path, holding);
    }
    const { checkout, revision, head, row, state, totals } = frame;
    this.view = { checkout, revision, head, row, state, totals };
    this.unread = null;
  }
}
