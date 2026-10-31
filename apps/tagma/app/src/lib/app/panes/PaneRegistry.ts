import { clashOf } from '@runlith/roster/RegistryClash';
import { Service } from '@runlith/layer/key';
import type { Holder } from '$lib/shared/panes/holder.js';
import { type PaneContent, type PaneKind, type PaneOffer, PaneUndeclared, type PaneRefusal } from '$lib/shared/panes/pane.js';

export class PaneRegistry extends Service<PaneRegistry>()('PaneRegistry', { tier: 'app' }) {
  readonly offers: readonly PaneOffer[];

  private readonly kinds = new Map<string, PaneKind>();

  private readonly former = new Map<string, string>();

  constructor(readonly all: readonly PaneKind[]) {
    super();
    for (const declared of all) {
      if (this.kinds.has(declared.kind)) throw clashOf(`Pane kind "${declared.kind}"`, declared.kind, declared.kind);
      this.kinds.set(declared.kind, declared);
    }
    for (const declared of all) {
      if (declared.formerly === undefined) continue;
      const holder = this.kinds.get(declared.formerly)?.kind ?? this.former.get(declared.formerly);
      if (holder !== undefined) throw clashOf(`Pane kind "${declared.formerly}"`, holder, declared.kind);
      this.former.set(declared.formerly, declared.kind);
    }
    this.offers = all
      .flatMap((declared) => (declared.offer === undefined ? [] : [declared.offer]))
      .toSorted((one, two) => one.order - two.order);
  }

  named(stored: string): string {
    return this.former.get(stored) ?? stored;
  }

  find(kind: string): PaneKind | undefined {
    return this.kinds.get(kind);
  }

  declared(kind: string): PaneKind {
    const found = this.kinds.get(kind);
    if (found === undefined) throw new PaneUndeclared({ kind, message: `No pane of kind "${kind}" is declared.` });
    return found;
  }

  refusal(content: PaneContent, holder: Holder): PaneRefusal | null {
    const declared = this.kinds.get(content.kind);
    if (declared === undefined) return 'undeclared';
    return (declared.admits?.(content.id, holder) ?? true) ? null : 'inadmissible';
  }
}
