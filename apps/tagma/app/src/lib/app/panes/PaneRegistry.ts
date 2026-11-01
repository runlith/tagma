import { Service } from '@runlith/layer/key';
import type { Point } from '@runlith/layer/Point';
import type { Holder } from '$lib/shared/panes/holder.js';
import { type PaneContent, type PaneKind, type PaneOffer, PaneUndeclared, type PaneRefusal, Panes } from '$lib/shared/panes/pane.js';

type ListedOffer = PaneOffer & { readonly right: PaneKind['right'] };

type PaneIndex = {
  readonly items: readonly PaneKind[];
  readonly kinds: ReadonlyMap<string, PaneKind>;
  readonly former: ReadonlyMap<string, string>;
  readonly offers: readonly ListedOffer[];
};

const indexOf = (items: readonly PaneKind[]): PaneIndex => ({
  items,
  kinds: new Map(items.map((declared) => [declared.kind, declared])),
  former: new Map(items.flatMap((declared) => (declared.formerly === undefined ? [] : [[declared.formerly, declared.kind] as const]))),
  offers: items
    .flatMap((declared) => (declared.offer === undefined ? [] : [{ ...declared.offer, right: declared.right }]))
    .toSorted((one, two) => one.order - two.order),
});

export class PaneRegistry extends Service<PaneRegistry>()('PaneRegistry', { tier: 'app' }) {
  static *make() {
    return new PaneRegistry(yield* Panes);
  }

  private readonly indexed: () => PaneIndex;

  constructor(panes: Point<PaneKind>) {
    super();
    this.indexed = panes.derive(indexOf);
  }

  private get index(): PaneIndex {
    return this.indexed();
  }

  get all(): readonly PaneKind[] {
    return this.index.items;
  }

  get offers(): readonly ListedOffer[] {
    return this.index.offers;
  }

  named(stored: string): string {
    return this.index.former.get(stored) ?? stored;
  }

  find(kind: string): PaneKind | undefined {
    return this.index.kinds.get(kind);
  }

  declared(kind: string): PaneKind {
    const found = this.find(kind);
    if (found === undefined) throw new PaneUndeclared({ kind, message: `No pane of kind "${kind}" is declared.` });
    return found;
  }

  refusal(content: PaneContent, holder: Holder): PaneRefusal | null {
    const declared = this.find(content.kind);
    if (declared === undefined) return 'undeclared';
    return (declared.admits?.(content.id, holder) ?? true) ? null : 'inadmissible';
  }
}
