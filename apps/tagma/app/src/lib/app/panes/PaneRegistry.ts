import { clashOf } from '@runlith/chat-ui/RegistryClash';
import { Service } from '@runlith/layer/key';
import type { Holder } from '$lib/shared/panes/holder.js';
import { type PaneContent, type PaneKind, type PaneOffer, PaneUndeclared, type PaneRefusal } from '$lib/shared/panes/pane.js';

export class PaneRegistry extends Service<PaneRegistry>()('PaneRegistry', { tier: 'app' }) {
  readonly offers: readonly PaneOffer[];

  private readonly kinds = new Map<string, PaneKind>();

  constructor(readonly all: readonly PaneKind[]) {
    super();
    for (const declared of all) {
      if (this.kinds.has(declared.kind)) throw clashOf(`Pane kind "${declared.kind}"`, declared.kind, declared.kind);
      this.kinds.set(declared.kind, declared);
    }
    this.offers = all
      .flatMap((declared) => (declared.offer === undefined ? [] : [declared.offer]))
      .toSorted((one, two) => one.order - two.order);
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
